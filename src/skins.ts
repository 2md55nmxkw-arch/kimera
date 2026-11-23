// Три «шкуры» — три способа показать одну и ту же сцену:
//   Default — модель как есть, в студийном свете;
//   Mosaic  — витражная роза: фигура из мелких осколков, стекло за ней из крупных;
//   Sketch  — карандашный набросок на бумаге, перерисованный восемь раз в секунду.
// Сцена рендерится один раз (цвет + нормали + глубина), дальше каждый пиксель
// считается тремя способами; линза под курсором сшивает две шкуры в одном кадре.
import * as THREE from 'three/webgpu';
import {
  Fn,
  abs,
  atan,
  dot,
  exp,
  float,
  floor,
  fract,
  fwidth,
  length,
  luminance,
  max,
  mix,
  mod,
  mx_noise_float,
  normalize,
  perspectiveDepthToViewZ,
  pow,
  saturate,
  screenSize,
  screenUV,
  sin,
  smoothstep,
  step,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

// Граф шейдера собирается динамически, типы узлов TSL здесь только мешают.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

export const SKINS = ['Default', 'Mosaic', 'Sketch'] as const;

export function createUniforms(camera: THREE.PerspectiveCamera) {
  return {
    pointer: uniform(new THREE.Vector2(0.5, 0.5)), // центр линзы, uv от левого верхнего угла
    aspect: uniform(1),
    dpr: uniform(1),
    lens: uniform(0.2), // радиус линзы в долях высоты экрана
    skinA: uniform(0), // шкура снаружи линзы
    skinB: uniform(1), // шкура внутри линзы
    near: uniform(camera.near),
    far: uniform(camera.far),
    clock: uniform(0), // своё время: замирает при prefers-reduced-motion
    raw: uniform(0), // отладка: 1 показывает сцену без шкур
    trailGain: uniform(0), // насколько виден чернильный след за линзой
    head: uniform(new THREE.Vector2(0.6, 0.35)), // центр лица на экране, uv
    headSize: uniform(0.12), // радиус головы в долях высоты экрана
    cheekL: uniform(new THREE.Vector2(0.62, 0.38)), // щёки на экране — для штрихов румянца
    cheekR: uniform(new THREE.Vector2(0.58, 0.38)),
    draw: uniform(1), // ход рисования наброска: 0 — чистый лист, 1 — готов
  };
}

export type SkinUniforms = ReturnType<typeof createUniforms>;

/** Цвет из #rrggbb как он выглядит на экране (sRGB), без перевода в линейное пространство. */
const paint = (hex: string): N => {
  const c = parseInt(hex.slice(1), 16);
  return vec3(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);
};

// Стёкла витражной розы.
const JEWELS = ['#b01e3c', '#1d409c', '#0f7a5c', '#e09a22', '#5a3192', '#14808c'];

export function buildComposite(scenePass: N, u: SkinUniforms, trail: N): N {
  const colorTex: N = scenePass.getTextureNode('output');
  const normalTex: N = scenePass.getTextureNode('normal');
  const depthTex: N = scenePass.getTextureNode('depth');

  // Шкуры считаются в «экранных» значениях (как видит глаз), в конце переводятся в линейные.
  const srgb = (c: N): N => pow(saturate(c), vec3(1 / 2.2));
  const toLinear = (c: N): N => pow(saturate(c), vec3(2.2));
  const viewDist = (uv: N): N =>
    (perspectiveDepthToViewZ(depthTex.sample(uv).r, u.near, u.far) as N).negate();
  const isFg = (d: N): N => float(1).sub(step(u.far.mul(0.9), d));
  const hash21 = (p: N): N => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
  const hash22 = (p: N): N =>
    fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))).mul(43758.5453));
  const rot = (p: N, a: number): N => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return vec2(p.x.mul(c).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(c)));
  };
  const pick = (sel: N, i: number): N => saturate(float(1).sub(abs(sel.sub(i))));

  return Fn(() => {
    const uv: N = screenUV;
    const res: N = screenSize;
    const css: N = uv.mul(res).div(u.dpr).toVar(); // CSS-пиксели, начало слева сверху
    const toUV = (p: N): N => p.mul(u.dpr).div(res);
    const pxUV: N = vec2(u.dpr).div(res).toVar(); // один CSS-пиксель в uv
    const pxH: N = u.dpr.div(res.y); // он же в долях высоты экрана
    const asp = vec2(u.aspect, 1);

    const cross = (r: N): N[] => [vec2(r.x, 0), vec2(r.x.negate(), 0), vec2(0, r.y), vec2(0, r.y.negate())];
    const diag = (r: N): N[] => [
      vec2(r.x, r.y),
      vec2(r.x.negate(), r.y),
      vec2(r.x, r.y.negate()),
      vec2(r.x.negate(), r.y.negate()),
    ];

    /** Контур в точке: разрывы глубины и изломы нормалей в радиусе radius CSS-пикселей. */
    const edgeAt = (c: N, radius: number): N => {
      const d0: N = viewDist(c).toVar();
      const n0: N = normalTex.sample(c).xyz.toVar();
      let dz: N = float(0);
      let dn: N = float(0);
      for (const t of cross(pxUV.mul(radius))) {
        dz = dz.add(abs(viewDist(c.add(t)).sub(d0)));
        dn = dn.add(length(normalTex.sample(c.add(t)).xyz.sub(n0)));
      }
      return max(smoothstep(0.004, 0.012, dz.div(d0)), smoothstep(0.3, 0.7, dn));
    };

    // ── общее ───────────────────────────────────────────────────────────
    const lin: N = colorTex.sample(uv).rgb.toVar();
    const dist: N = viewDist(uv).toVar();
    const fg: N = isFg(dist).toVar();
    const edge: N = edgeAt(uv, 1.25).toVar();
    // Положение пикселя относительно лица: в долях высоты экрана и в «головах».
    const fromHead: N = uv.sub(u.head).mul(asp).toVar();
    const heads: N = length(fromHead).div(u.headSize).toVar();

    // ── 01 · DEFAULT ────────────────────────────────────────────────────
    // Модель как есть. Вся работа здесь — подать её чисто: мягкий студийный фон
    // со светом за головой, падающая тень на фоне, затенение в складках и ручное
    // сглаживание контуров (сама сцена рендерится без него).
    let blurred: N = vec3(0);
    let cover: N = fg;
    for (const t of diag(pxUV.mul(0.75))) {
      blurred = blurred.add(colorTex.sample(uv.add(t)).rgb);
      cover = cover.add(isFg(viewDist(uv.add(t))));
    }
    cover = cover.div(5.0);

    // Затенение: насколько соседи вокруг ближе к камере, чем эта точка.
    let occluded: N = float(0);
    for (const t of diag(pxUV.mul(7.0))) {
      const gap: N = dist.sub(viewDist(uv.add(t)));
      occluded = occluded.add(smoothstep(0.004, 0.04, gap).mul(float(1).sub(smoothstep(0.08, 0.3, gap))));
    }
    const shade: N = float(1).sub(occluded.mul(0.085));

    // Тень фигуры на фоне: силуэт, сдвинутый вниз-вправо и размытый.
    const cast: N = vec2(-0.011, -0.014);
    let shadow: N = float(0);
    for (const t of cross(pxUV.mul(9.0))) shadow = shadow.add(isFg(viewDist(uv.add(cast).add(t))));
    shadow = shadow.add(isFg(viewDist(uv.add(cast)))).div(5.0);

    const light: N = exp(heads.mul(heads).mul(-0.11)); // пятно света за головой
    const wall: N = mix(paint('#aeb2c0'), paint('#f6f1e8'), saturate(light.mul(0.85).add(float(1).sub(uv.y).mul(0.3))));
    const backdrop: N = toLinear(
      wall
        .mul(float(1).sub(shadow.mul(0.16)))
        .mul(float(1).sub(length(uv.sub(0.5)).mul(0.25)))
        .add(hash21(floor(css)).sub(0.5).mul(0.012)),
    );
    const model: N = mix(lin, blurred.div(4.0), edge.mul(0.7)).mul(shade);
    const plain: N = mix(backdrop, model, cover);

    // ── 02 · MOSAIC ─────────────────────────────────────────────────────
    // Витраж в два масштаба. Фигура набрана мелкими осколками, чтобы читались лицо
    // и руки; стекло за ней — крупными, и раскрашено как готическая роза вокруг
    // головы: кольца и лепестки. Осколок берёт один цвет из точки под своим центром.
    // У каждого свой наклон, и те, что повёрнуты к курсору, ловят блик.
    const voronoi = (tile: number, salt: number) => {
      const g: N = css.div(tile);
      const gi: N = floor(g);
      const gf: N = fract(g);
      let near: N = float(8); // до ближайшего центра
      let next: N = float(8); // до второго по близости
      let p1: N = vec2(0);
      let p2: N = vec2(0);
      let h1: N = vec2(0);
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const h: N = hash22(gi.add(vec2(i + salt, j + salt)));
          // Центры медленно дышат.
          const pt: N = vec2(i, j).add(sin(h.mul(6.2832).add(u.clock.mul(0.45))).mul(0.3).add(0.5));
          const dd: N = length(pt.sub(gf));
          const closer: N = step(dd, near);
          const second: N = step(dd, next).mul(float(1).sub(closer));
          p2 = mix(mix(p2, gi.add(pt), second), p1, closer).toVar();
          next = mix(mix(next, dd, second), near, closer).toVar();
          p1 = mix(p1, gi.add(pt), closer).toVar();
          h1 = mix(h1, h, closer).toVar();
          near = mix(near, dd, closer).toVar();
        }
      }
      return { near, gap: next.sub(near), at: toUV(p1.mul(tile)), beside: toUV(p2.mul(tile)), hash: h1 };
    };
    const fine = voronoi(12, 0);
    const coarse = voronoi(34, 7.5);
    const onFigure: N = isFg(viewDist(fine.at)).toVar(); // этот мелкий осколок лежит на фигуре
    const besideFigure: N = isFg(viewDist(fine.beside)); // соседний мелкий — на фигуре

    // Стекло фигуры: цвет модели, насыщеннее и в несколько ступеней.
    const fc: N = srgb(colorTex.sample(fine.at).rgb);
    const vivid: N = mix(vec3(luminance(fc)), fc, 1.45);
    const figureGlass: N = floor(saturate(vivid).mul(6.0).add(0.5))
      .div(6.0)
      .mul(fine.hash.x.mul(0.2).add(0.9));

    // Стекло розы: кольца шириной в голову, двенадцать лепестков, шесть цветов по кругу.
    const rel: N = coarse.at.sub(u.head).mul(asp);
    const ring: N = floor(length(rel).div(u.headSize.mul(1.05)));
    const petal: N = floor(atan(rel.y, rel.x).div(6.2832 / 12).add(ring.mul(0.5)));
    const jewelIndex: N = mod(ring.mul(2.0).add(petal), 6.0);
    let jewel: N = vec3(0);
    JEWELS.forEach((hex, i) => {
      jewel = jewel.add(paint(hex).mul(pick(jewelIndex, i)));
    });
    // Второе кольцо — золотой нимб; чем дальше от головы, тем темнее стекло.
    jewel = mix(jewel, paint('#f2b53a'), pick(ring, 1).mul(0.8));
    const flicker: N = sin(u.clock.mul(0.7).add(coarse.hash.x.mul(6.2832))).mul(0.07).add(1.0);
    const roseGlass: N = jewel
      .mul(mix(1.2, 0.42, smoothstep(0.0, 6.5, length(rel).div(u.headSize))))
      .mul(coarse.hash.y.mul(0.3).add(0.85))
      .mul(flicker);

    const near: N = mix(coarse.near, fine.near, onFigure);
    const shardAt: N = mix(coarse.at, fine.at, onFigure);
    const shardHash: N = mix(coarse.hash, fine.hash, onFigure);
    // Свинцовая оправа: границы своих осколков, а у фона ещё и кромка вдоль фигуры.
    const leadFine: N = float(1).sub(smoothstep(0.05, 0.13, fine.gap));
    const leadCoarse: N = float(1).sub(smoothstep(0.022, 0.055, coarse.gap));
    const lead: N = max(
      mix(leadCoarse, leadFine, onFigure),
      leadFine.mul(besideFigure).mul(float(1).sub(onFigure)),
    );
    // Блик: курсор — источник света, осколок блестит, если его нормаль смотрит между светом и зрителем.
    const tilt: N = normalize(vec3(shardHash.sub(0.5).mul(0.95), 1.0));
    const toLight: N = u.pointer.sub(shardAt).mul(asp);
    const halfway: N = normalize(normalize(vec3(toLight.mul(2.4), 0.55)).add(vec3(0, 0, 1)));
    const glint: N = pow(saturate(dot(tilt, halfway)), 56.0).mul(
      float(1).sub(smoothstep(0.12, 0.75, length(toLight))),
    );
    // Стекло светлее к середине осколка, по нему идут лёгкие разводы.
    const streaks: N = mx_noise_float(vec3(css.x.mul(0.05), css.y.mul(0.5), 2.0)).mul(0.035);
    // Роспись по стеклу: черты лица, пряди и складки прорисованы тёмной краской
    // поверх осколков, как лица на настоящих витражах. Без неё фигура — просто пятна.
    const painted: N = float(1).sub(edgeAt(uv, 1.6).mul(onFigure).mul(0.8));
    const glass: N = mix(roseGlass, figureGlass, onFigure)
      .mul(float(1.13).sub(near.mul(0.42)).add(streaks))
      .mul(painted);
    const mosaic: N = mix(toLinear(glass).add(glint.mul(0.95)), toLinear(paint('#100e16')), lead);

    // ── 03 · SKETCH ─────────────────────────────────────────────────────
    // Карандашный набросок, как в скетчбуке: без цвета, тонким грифелем.
    // Линия не одна, а три лёгких прохода дрожащей рукой — где они совпали, там
    // темнее. Силуэт обведён с нажимом, тени намечены редкой штриховкой, построение
    // (круг головы, осевые) не стёрто, на щеках штрихи румянца.
    // Всё «кипит» — перерисовывается 8 раз в секунду.
    const boil: N = floor(u.clock.mul(8.0)).div(8.0).mul(3.1);
    /** Дрожание руки: смещение в CSS-пикселях. */
    const jitter = (scale: number, amp: number, salt: number): N =>
      vec2(
        mx_noise_float(vec3(css.mul(scale), boil.add(salt))),
        mx_noise_float(vec3(css.mul(scale).add(41.3), boil.add(salt + 9.1))),
      ).mul(amp);
    const lum = (c: N): N => luminance(srgb(colorTex.sample(c).rgb));

    // Ход рисования. Набросок появляется не весь сразу и не ровной волной:
    // от головы наружу, пятнами и вытянутыми вдоль штриха полосами — как идёт рука.
    // order — «когда дойдёт очередь до этой точки», 0 у лица … 1 на краях.
    const patches: N = mx_noise_float(vec3(css.mul(0.011), 31.0)).mul(0.5).add(0.5);
    const streaks3: N = mx_noise_float(vec3(rot(css, 0.6).mul(vec2(0.0035, 0.045)), 47.0)).mul(0.5).add(0.5);
    const order: N = saturate(heads.mul(0.075).add(patches.mul(0.28)).add(streaks3.mul(0.22))).toVar();
    /** Доля общего хода, отведённая этапу [from, to], 0…1. */
    const phase = (from: number, to: number): N => saturate(u.draw.sub(from).div(to - from));
    /** Нарисован ли в этой точке слой, который рисуют на этапе [from, to]. */
    const drawn = (from: number, to: number): N =>
      smoothstep(order.mul(0.82), order.mul(0.82).add(0.1), phase(from, to));

    /**
     * Что карандаш обвёл бы в этой точке: края формы (глубина, нормали) и края
     * рисунка на самой модели (глаза, рот, пуговицы — у модели это текстура,
     * геометрии там нет, поэтому ищем перепады яркости).
     */
    const drawnAt = (c: N, radius: number): N => {
      const d0: N = viewDist(c).toVar();
      const n0: N = normalTex.sample(c).xyz.toVar();
      const l0: N = lum(c).toVar();
      let dz: N = float(0);
      let dn: N = float(0);
      let dl: N = float(0);
      for (const t of cross(pxUV.mul(radius))) {
        dz = dz.add(abs(viewDist(c.add(t)).sub(d0)));
        dn = dn.add(length(normalTex.sample(c.add(t)).xyz.sub(n0)));
        dl = dl.add(abs(lum(c.add(t)).sub(l0)));
      }
      return max(
        max(smoothstep(0.004, 0.012, dz.div(d0)), smoothstep(0.3, 0.7, dn)),
        smoothstep(0.1, 0.34, dl).mul(0.85),
      );
    };
    /** Только внешний контур: разрыв глубины. */
    const silhouetteAt = (c: N, radius: number): N => {
      const d0: N = viewDist(c).toVar();
      let dz: N = float(0);
      for (const t of cross(pxUV.mul(radius))) dz = dz.add(abs(viewDist(c.add(t)).sub(d0)));
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
    const sketch: N = toLinear(mix(paint('#2e2e36'), paper.mul(float(1).sub(smudge)), bare));

    // ── сшивка ──────────────────────────────────────────────────────────
    const skins: N[] = [plain, mosaic, sketch];
    let colA: N = vec3(0);
    let colB: N = vec3(0);
    skins.forEach((s, i) => {
      colA = colA.add(s.mul(pick(u.skinA, i)));
      colB = colB.add(s.mul(pick(u.skinB, i)));
    });

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

    const stitched: N = mix(colA, colB, max(inside, inkMask)).toVar();

    // Шов: тонкое кольцо и стежки поперёк. Рисуется инверсией, поэтому виден на любой шкуре.
    const seamOn: N = smoothstep(0.0, 0.03, u.lens).mul(float(1).sub(smoothstep(0.9, 1.6, u.lens)));
    const off: N = abs(d.sub(u.lens));
    const ringLine: N = float(1).sub(smoothstep(pxH.mul(0.6), pxH.mul(1.8), off));
    const around: N = atan(p.y, p.x).mul(44 / (Math.PI * 2));
    const ticks: N = step(abs(fract(around).sub(0.5)), 0.07).mul(float(1).sub(step(pxH.mul(8), off)));
    const seam: N = saturate(ringLine.add(ticks).mul(seamOn).add(inkEdge.mul(0.85)));

    const final: N = mix(stitched, vec3(1).sub(stitched), seam);
    return vec4(mix(final, lin, u.raw), 1);
  })();
}
