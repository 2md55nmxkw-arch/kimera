// Три «шкуры» — три способа показать одну и ту же сцену:
//   Default — модель как есть, в студийном свете;
//   Mosaic  — витражная роза: фигура из мелких осколков, стекло за ней из крупных;
//   Sketch  — карандашный набросок на бумаге, перерисованный восемь раз в секунду.
// Сцена рендерится один раз в G-буфер, дальше каждый пиксель считается всеми
// шкурами; линза под курсором сшивает две из них в одном кадре.
//
// Каждая шкура живёт в своём файле и не знает о соседних. Здесь только список и сшивка.
import { Fn, If, abs, atan, float, fract, fwidth, length, max, mix, mx_noise_float, saturate, smoothstep, step, vec3, vec4 } from 'three/tsl';
import { createContext, pick, type N, type SkinContext, type SkinUniforms } from './context';
import { defaultSkin } from './default';
import { mosaicSkin } from './mosaic';
import { sketchSkin } from './sketch';
import { setSketchIndex } from './sketch-prep';

export { createUniforms, type SkinUniforms } from './context';

/** Шкуры в порядке глав. Имя показывается в углу экрана. */
const LIST: { name: string; build(c: SkinContext): N }[] = [
  { name: 'Default', build: defaultSkin },
  { name: 'Mosaic', build: mosaicSkin },
  { name: 'Sketch', build: sketchSkin },
];

export const SKINS = LIST.map((s) => s.name);
// Заготовки наброска считаются только в главах, где он виден.
setSketchIndex(SKINS.indexOf('Sketch'));

/**
 * @param scenePass проход сцены с G-буфером (core/gbuffer.ts)
 * @param trail     текстура чернильного следа (fx/trail.ts)
 */
export function buildComposite(scenePass: N, u: SkinUniforms, trail: N): N {
  return Fn(() => {
    const c = createContext(scenePass, u);
    const { uv, css, pxH, asp, lin, idAt } = c;

    // ── линза и след: какой из двух шкур принадлежит пиксель ─────────────
    const p: N = uv.sub(u.pointer).mul(asp).toVar();
    const wobble: N = mx_noise_float(vec3(p.mul(3.5), u.clock.mul(0.4)))
      .mul(0.03)
      .mul(smoothstep(0.0, 0.25, u.lens));
    const d: N = length(p).add(wobble).toVar();
    const inside: N = float(1).sub(smoothstep(u.lens.sub(pxH.mul(1.5)), u.lens, d));

    // Чернильный след: там, где линза недавно прошла, вторая шкура держится ещё секунду.
    // Край следа рваный (шум) и обведён той же инверсной линией, что и шов.
    const ink: N = trail
      .sample(uv)
      .r.add(mx_noise_float(vec3(css.mul(0.014), u.clock.mul(0.3))).mul(0.1))
      .toVar();
    const inkMask: N = smoothstep(0.33, 0.37, ink).mul(u.trailGain);
    const inkWidth: N = max(fwidth(ink), 1e-4);
    const inkEdge: N = float(1)
      .sub(smoothstep(inkWidth.mul(0.7), inkWidth.mul(2.0), abs(ink.sub(0.35))))
      .mul(u.trailGain)
      .mul(float(1).sub(inside));
    const toB: N = max(inside, inkMask).toVar(); // 0 — шкура A, 1 — шкура B

    // ── шкуры ───────────────────────────────────────────────────────────
    // Шкура дорогая, поэтому считается только там, где она видна: снаружи линзы
    // одна, внутри другая, обе сразу — лишь на узкой кромке между ними.
    const colA: N = vec3(0).toVar();
    const colB: N = vec3(0).toVar();
    LIST.forEach((skin, i) => {
      const isA: N = pick(u.skinA, i);
      const isB: N = pick(u.skinB, i);
      const seen: N = isA.mul(float(1).sub(toB)).add(isB.mul(toB));
      If(seen.greaterThan(0), () => {
        const col: N = skin.build(c).toVar();
        colA.addAssign(col.mul(isA));
        colB.addAssign(col.mul(isB));
      });
    });
    const stitched: N = mix(colA, colB, toB).toVar();

    // Шов: тонкое кольцо и стежки поперёк. Рисуется инверсией, поэтому виден на любой шкуре.
    const seamOn: N = smoothstep(0.0, 0.03, u.lens).mul(float(1).sub(smoothstep(0.9, 1.6, u.lens)));
    const off: N = abs(d.sub(u.lens));
    const ringLine: N = float(1).sub(smoothstep(pxH.mul(0.6), pxH.mul(1.8), off));
    const around: N = atan(p.y, p.x).mul(44 / (Math.PI * 2));
    const ticks: N = step(abs(fract(around).sub(0.5)), 0.07).mul(float(1).sub(step(pxH.mul(8), off)));
    const seam: N = saturate(ringLine.add(ticks).mul(seamOn).add(inkEdge.mul(0.85)));

    const final: N = mix(stitched, vec3(1).sub(stitched), seam);
    // Отладка: raw = 1 — сцена без шкур, raw = 2 — слой меток
    // (красный — номер предмета, зелёный — ярус тела, синий — рука).
    const id: N = idAt(uv);
    const idView: N = vec3(fract(id.r.mul(0.37)), id.g, abs(id.b));
    const plain: N = mix(lin, idView, saturate(u.raw.sub(1)));
    return vec4(mix(final, plain, saturate(u.raw)), 1);
  })();
}
