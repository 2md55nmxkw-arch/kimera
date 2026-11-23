// 03 · SKETCH
// Карандашный набросок, как в скетчбуке: без цвета, тонким грифелем.
// Линия не одна, а три лёгких прохода дрожащей рукой — где они совпали, там
// темнее. Силуэт обведён с нажимом, тени намечены редкой штриховкой, построение
// (круг головы, осевые) не стёрто, на щеках штрихи румянца.
// Всё «кипит» — перерисовывается 8 раз в секунду.
import {
  abs,
  atan,
  float,
  floor,
  fract,
  length,
  luminance,
  max,
  mix,
  mx_noise_float,
  saturate,
  smoothstep,
  step,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import type { Frame, Part } from '../core/contracts';
import { clamp, smooth } from '../core/math';
import { hash21, paint, rot, srgb, toLinear, type N, type SkinContext } from './context';

/** Униформы, нужные только наброску. */
export const sketchU = {
  draw: uniform(1), // ход рисования: 0 — чистый лист, 1 — готов
};

/**
 * Ход рисования. Набросок рисуется, пока ты в его главе. На подходе к ней линза
 * заливает экран чистым листом; в остальных главах под линзой он показан готовым.
 * Первый раз рисуется не спеша, потом быстрее.
 * @param index  номер главы с наброском
 * @param freeze подмена для отладки: draw ≥ 0 останавливает ход на этом месте
 */
export function createSketchDraw(index: number, freeze: { draw: number }): Part {
  let draw = 1;
  let drawnBefore = false;
  return {
    reset() {
      draw = 1;
      drawnBefore = false;
    },
    step({ dt, still, chapter, q }: Frame) {
      if (still) {
        draw = 1;
      } else if (chapter === index) {
        draw = Math.min(1, draw + dt / (drawnBefore ? 1.6 : 3.8));
        if (draw >= 1) drawnBefore = true;
      } else if (chapter === index - 1 && q > 0.62) {
        draw = Math.min(draw, 1 - smooth(clamp((q - 0.62) / 0.1, 0, 1)));
      } else {
        draw = Math.min(1, draw + dt * 2.5);
      }
      sketchU.draw.value = freeze.draw >= 0 ? freeze.draw : draw;
    },
  };
}

export function sketchSkin(c: SkinContext): N {
  const { u, uv, css, pxUV, pxH, asp, colorAt, normalAt, viewDist, cross, lin, fg, fromHead, heads } = c;

  const boil: N = floor(u.clock.mul(8.0)).div(8.0).mul(3.1);
  /** Дрожание руки: смещение в CSS-пикселях. */
  const jitter = (scale: number, amp: number, salt: number): N =>
    vec2(
      mx_noise_float(vec3(css.mul(scale), boil.add(salt))),
      mx_noise_float(vec3(css.mul(scale).add(41.3), boil.add(salt + 9.1))),
    ).mul(amp);
  const lum = (p: N): N => luminance(srgb(colorAt(p).rgb));

  // Ход рисования. Набросок появляется не весь сразу и не ровной волной:
  // от головы наружу, пятнами и вытянутыми вдоль штриха полосами — как идёт рука.
  // order — «когда дойдёт очередь до этой точки», 0 у лица … 1 на краях.
  const patches: N = mx_noise_float(vec3(css.mul(0.011), 31.0)).mul(0.5).add(0.5);
  const streaks3: N = mx_noise_float(vec3(rot(css, 0.6).mul(vec2(0.0035, 0.045)), 47.0)).mul(0.5).add(0.5);
  const order: N = saturate(heads.mul(0.075).add(patches.mul(0.28)).add(streaks3.mul(0.22))).toVar();
  /** Доля общего хода, отведённая этапу [from, to], 0…1. */
  const phase = (from: number, to: number): N => saturate(sketchU.draw.sub(from).div(to - from));
  /** Нарисован ли в этой точке слой, который рисуют на этапе [from, to]. */
  const drawn = (from: number, to: number): N =>
    smoothstep(order.mul(0.82), order.mul(0.82).add(0.1), phase(from, to));

  /**
   * Что карандаш обвёл бы в этой точке: края формы (глубина, нормали) и края
   * рисунка на самой модели (глаза, рот, пуговицы — у модели это текстура,
   * геометрии там нет, поэтому ищем перепады яркости).
   */
  const drawnAt = (p: N, radius: number): N => {
    const d0: N = viewDist(p).toVar();
    const n0: N = normalAt(p).xyz.toVar();
    const l0: N = lum(p).toVar();
    let dz: N = float(0);
    let dn: N = float(0);
    let dl: N = float(0);
    for (const t of cross(pxUV.mul(radius))) {
      dz = dz.add(abs(viewDist(p.add(t)).sub(d0)));
      dn = dn.add(length(normalAt(p.add(t)).xyz.sub(n0)));
      dl = dl.add(abs(lum(p.add(t)).sub(l0)));
    }
    return max(
      max(smoothstep(0.004, 0.012, dz.div(d0)), smoothstep(0.3, 0.7, dn)),
      smoothstep(0.1, 0.34, dl).mul(0.85),
    );
  };
  /** Только внешний контур: разрыв глубины. */
  const silhouetteAt = (p: N, radius: number): N => {
    const d0: N = viewDist(p).toVar();
    let dz: N = float(0);
    for (const t of cross(pxUV.mul(radius))) dz = dz.add(abs(viewDist(p.add(t)).sub(d0)));
    return smoothstep(0.02, 0.06, dz.div(d0));
  };

  // Бумага: кремовая, с лёгким зерном и волокнами, к краям чуть темнее.
  const fibre: N = mx_noise_float(vec3(css.x.mul(0.9), css.y.mul(0.11), 3.0))
    .mul(0.6)
    .add(mx_noise_float(vec3(css.mul(0.55), 8.0)).mul(0.4));
  const tooth: N = hash21(floor(css))
    .mul(0.5)
    .add(mx_noise_float(vec3(css.mul(0.45), 1.0)).mul(0.25).add(0.5))
    .toVar();
  const paper: N = paint('#f1ebdb')
    .mul(fibre.mul(0.022).add(1.0))
    .mul(mx_noise_float(vec3(css.mul(0.005), 5.0)).mul(0.03).add(1.0))
    .mul(float(1).sub(length(uv.sub(0.5)).mul(0.17)));

  // Три прохода. Второй и третий — «ищущие»: сдвинуты, бледнее и с разрывами.
  const j1: N = jitter(0.02, 1.5, 0.0);
  const lineA: N = drawnAt(uv.add(j1.mul(pxUV)), 0.85);
  const lineB: N = drawnAt(uv.add(jitter(0.011, 3.2, 5.0).add(vec2(1.8, -1.2)).mul(pxUV)), 0.8);
  const lineC: N = drawnAt(uv.add(jitter(0.007, 4.6, 11.0).add(vec2(-2.1, 1.6)).mul(pxUV)), 0.8);
  const contour: N = silhouetteAt(uv.add(j1.mul(pxUV)), 1.5);
  // Нажим меняется вдоль линии; местами штрих совсем отрывается от бумаги.
  const press = (salt: number): N => mx_noise_float(vec3(css.mul(0.012), boil.add(salt))).mul(0.5).add(0.5);
  // Сначала идут бледные «ищущие» проходы, потом по ним — уверенная линия и силуэт.
  const searching: N = drawn(0.1, 0.55).toVar();
  const confident: N = drawn(0.32, 0.82).toVar();
  const inkA: N = lineA.mul(press(1.0).mul(0.35).add(0.52)).mul(confident);
  const inkB: N = lineB.mul(smoothstep(0.3, 0.62, press(2.0))).mul(0.42).mul(searching);
  const inkC: N = lineC.mul(smoothstep(0.42, 0.7, press(3.0))).mul(0.3).mul(searching);
  const inkOuter: N = contour.mul(press(4.0).mul(0.25).add(0.34)).mul(confident);

  // Штриховка: редкая и лёгкая, только чтобы наметить тень. Штрихи короткие,
  // у каждого своя толщина, линии слегка гуляют.
  const tone: N = luminance(srgb(lin)).toVar();
  const hatchAt: N = css.add(jitter(0.006, 5.0, 2.0));
  const hatch = (angle: number, spacing: number, width: number, salt: number, gaps: number): N => {
    const r: N = rot(hatchAt, angle);
    const across: N = r.y.div(spacing);
    const id: N = floor(across);
    const off: N = abs(fract(across).sub(0.5)).mul(spacing);
    const w: N = hash21(vec2(id, salt)).mul(0.7).add(0.5).mul(width);
    const broken: N = step(
      gaps,
      mx_noise_float(vec3(r.x.mul(0.03).add(hash21(vec2(id, salt + 3.0)).mul(60.0)), id.mul(0.37), boil.add(salt))),
    );
    // Каждый штрих начинают в свой момент и ведут от начала к концу.
    const turn: N = hash21(vec2(id, salt + 7.0)).mul(0.6)
      .add(fract(r.x.div(700.0).add(hash21(vec2(id, salt + 5.0)))).mul(0.25))
      .add(order.mul(0.15));
    return float(1).sub(smoothstep(w, w.add(0.8), off)).mul(broken).mul(step(turn, phase(0.6, 1.0)));
  };
  const shading: N = max(
    max(
      // полутень: совсем редкие штрихи
      hatch(0.75, 8.5, 0.4, 1, 0.05).mul(float(1).sub(smoothstep(0.5, 0.7, tone))).mul(0.3),
      // тень
      hatch(0.6, 5.0, 0.42, 2, -0.15).mul(float(1).sub(smoothstep(0.24, 0.42, tone))).mul(0.42),
    ),
    // самое тёмное — перекрёстно и плотнее
    hatch(-0.55, 4.0, 0.45, 3, -0.3).mul(float(1).sub(smoothstep(0.08, 0.2, tone))).mul(0.5),
  ).mul(fg);

  // Самое тёмное на модели — ресницы, зрачки, чёрные манжеты — закрашено плотно,
  // с нажимом: в наброске это те места, где грифель прошёлся несколько раз.
  const finishing: N = drawn(0.72, 1.0).toVar(); // последние штрихи: заливки и румянец
  const solid: N = float(1)
    .sub(smoothstep(0.1, 0.24, tone))
    .mul(fg)
    .mul(press(6.0).mul(0.2).add(0.5))
    .mul(finishing);

  // Румянец: по три-четыре коротких косых штриха на каждой щеке.
  const blushAt = (cheek: N): N => {
    const q: N = uv.sub(cheek).mul(asp).div(u.headSize).add(jitter(0.03, 0.012, 15.0));
    const inside: N = float(1).sub(smoothstep(0.55, 1.0, length(q.div(vec2(0.24, 0.12)))));
    const lines: N = abs(fract(q.x.mul(0.5).add(q.y.mul(0.87)).div(0.075)).sub(0.5));
    return float(1).sub(smoothstep(0.08, 0.2, lines)).mul(inside);
  };
  const blush: N = max(blushAt(u.cheekL), blushAt(u.cheekR)).mul(0.5).mul(finishing);

  // Построение: круг головы и две осевые. С него рисунок начинается: круг обводят
  // по часовой от макушки, потом проводят вертикаль сверху вниз и горизонталь слева направо.
  const guide: N = fromHead.add(jitter(0.015, 1.5, 7.0).mul(pxH));
  const thin = (dd: N): N => float(1).sub(smoothstep(pxH.mul(0.35), pxH.mul(1.5), abs(dd)));
  const setup: N = phase(0.0, 0.16);
  const aroundHead: N = fract(atan(guide.x, guide.y.negate()).div(6.2832).add(1.0));
  const axisV: N = u.headSize.mul(1.75);
  const axisH: N = u.headSize.mul(1.6);
  const construction: N = max(
    thin(length(guide).sub(u.headSize.mul(1.14))).mul(step(aroundHead, setup.div(0.6))),
    max(
      thin(guide.x.add(guide.y.mul(0.06)))
        .mul(step(abs(guide.y), axisV))
        .mul(step(guide.y.add(axisV).div(axisV.mul(2.0)), setup.sub(0.55).div(0.22))),
      thin(guide.y.add(u.headSize.mul(0.1)).sub(guide.x.mul(0.05)))
        .mul(step(abs(guide.x), axisH))
        .mul(step(guide.x.add(axisH).div(axisH.mul(2.0)), setup.sub(0.78).div(0.22))),
    ),
  ).mul(0.2);

  // Графит ложится на зерно бумаги. Слои не складываются, а перекрывают друг
  // друга: два штриха в одном месте темнее одного, но не чёрные.
  const grain: N = tooth.mul(0.5).add(0.62);
  let bare: N = float(1); // сколько бумаги осталось видно
  for (const layer of [inkA, inkB, inkC, inkOuter, shading, solid, blush, construction]) {
    bare = bare.mul(float(1).sub(saturate(layer.mul(grain))));
  }
  // Лёгкая растушёвка в тенях, чтобы форма не была плоской.
  const smudge: N = float(1).sub(smoothstep(0.15, 0.6, tone)).mul(fg).mul(0.07).mul(finishing);
  return toLinear(mix(paint('#2e2e36'), paper.mul(float(1).sub(smudge)), bare));
}
