// Заготовки наброска: всё, что в нём случайно, но не зависит от сцены.
//
// Раньше каждый пиксель наброска каждый кадр считал 28 значений трёхмерного шума
// Перлина — три четверти времени кадра (на GTX 1060 около 1 мс на вызов в 1920×1080;
// 50 чтений G-буфера рядом с этим стоят меньше полумиллисекунды). Но шум этот
// меняется редко и плавно, поэтому считается заранее, в текстуры, теми же
// формулами — рисунок остаётся тем же самым, штрих в штрих:
//
//   лист    — бумага, зерно и очерёдность рисования. Не меняется вовсе; размером
//             с экран, пересчитывается только при смене размера;
//   рука    — дрожание линий и нажим. Меняется 8 раз в секунду, вместе с «кипением»,
//             и плавно от точки к точке, поэтому хватает одной точки на 8×8 пикселей;
//   разрывы — где штрих штриховки отрывается от бумаги: шум вдоль каждого штриха.
//             Маленькая плитка, тоже 8 раз в секунду.
//
// Шкура читает готовое: шесть чтений текстур вместо 28 вызовов шума.
import * as THREE from 'three/webgpu';
import { Fn, float, floor, mx_noise_float, nodeObject, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { hash21, pick, rot, type N, type SkinUniforms } from './context';

/** Одна точка текстуры «руки» накрывает квадрат с такой стороной, CSS-пиксели. */
export const HAND_CELL = 8;
/** Сколько клеток шума укладывается в плитку разрывов по каждой стороне. */
export const GAP_CELLS = 16;
const GAP_SIZE = 128; // сторона плитки в точках: 8 на клетку шума

// Рука: четыре полосы одной текстуры, в каждой по четыре канала. Канал — одно поле
// шума: [масштаб, сдвиг, соль]. Все поля считаются одной формулой, меняются только
// числа, поэтому полоса выбирается арифметикой, без ветвления.
type Field = [scale: number, offset: number, salt: number];
/** Смещение штриха: два независимых поля, по x и по y. */
const jitter = (scale: number, salt: number): Field[] => [
  [scale, 0, salt],
  [scale, 41.3, salt + 9.1],
];
/** Нажим: одно поле. */
const press = (salt: number): Field => [0.012, 0, salt];
/** Что лежит в полосах; шкура читает их по этим же номерам (sketch.ts). */
const HAND: Field[][] = [
  [...jitter(0.02, 0), ...jitter(0.011, 5)], // уверенная линия · первый ищущий проход
  [...jitter(0.007, 11), ...jitter(0.006, 2)], // второй ищущий проход · штриховка
  [...jitter(0.015, 7), press(1), press(2)], // построение · нажим линий A и B
  [press(3), press(4), press(6), press(6)], // нажим линии C, силуэта и заливок · запас
];
export const HAND_ROWS = HAND.length;

/**
 * Текстура, которую кто-то готовит перед кадром. Как PassTextureNode из three:
 * попав в шейдер, тянет за собой узел-хозяина, а тот получает вызов перед кадром.
 * Свой класс нужен потому, что у PassTextureNode в r180 clone() теряет uv и
 * уровень, и .sample(uv).level(0) с ним не работает.
 */
class PreparedTextureNode extends THREE.TextureNode {
  owner: THREE.Node | null = null;

  setup(builder: THREE.NodeBuilder) {
    this.owner?.build(builder);
    return super.setup(builder);
  }

  clone(): this {
    const copy = super.clone();
    copy.owner = this.owner;
    return copy;
  }
}

/** Узел без кода в шейдере: нужен ради вызова перед кадром, в котором есть рендер. */
class BeforeFrameNode extends THREE.Node {
  constructor(private readonly run: (renderer: THREE.Renderer) => void) {
    super('void');
    this.updateBeforeType = THREE.NodeUpdateType.FRAME;
  }

  setup() {
    return null;
  }

  updateBefore(frame: THREE.NodeFrame) {
    if (frame.renderer) this.run(frame.renderer);
  }
}

export interface SketchPrep {
  /** Лист: r — тон бумаги, g — зерно, b — очерёдность рисования (как упакованы — см. ниже). */
  sheet: N;
  /** Размер текстуры листа в пикселях буфера: она бывает больше экрана. */
  sheetSize: N;
  /** Рука: HAND_ROWS полос одна под другой, значения шума как есть, −1…1. */
  hand: N;
  /** Размер одной полосы руки в точках. */
  handSize: N;
  /** Разрывы штрихов: r, g, b — три слоя штриховки, значения шума как есть. */
  gaps: N;
  /** Пересчитать всё к следующему кадру. */
  invalidate(): void;
}

// Номер шкуры «набросок» в списке шкур. Пока он неизвестен, заготовки считаются всегда.
let sketchIndex = -1;
/** Сообщить номер шкуры: в главах, где наброска нет ни снаружи линзы, ни внутри, заготовки не считаются. */
export function setSketchIndex(index: number): void {
  sketchIndex = index;
}

const made = new Map<SkinUniforms, SketchPrep>();
/** Пересчитать заготовки к следующему кадру (после сброса состояния). */
export function invalidateSketchPrep(): void {
  for (const prep of made.values()) prep.invalidate();
}

/** Заготовки для набора униформ: одни на страницу, создаются при первом обращении. */
export function sketchPrep(u: SkinUniforms): SketchPrep {
  let prep = made.get(u);
  if (!prep) {
    prep = createPrep(u);
    made.set(u, prep);
  }
  return prep;
}

function createPrep(u: SkinUniforms): SketchPrep {
  const linear = { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  // Листу хватает восьми бит на канал: он размером с экран, и память здесь важнее.
  const sheetTarget = new THREE.RenderTarget(1, 1, linear);
  const handTarget = new THREE.RenderTarget(1, 1, { ...linear, type: THREE.HalfFloatType });
  const gapTarget = new THREE.RenderTarget(GAP_SIZE, GAP_SIZE, {
    ...linear,
    type: THREE.HalfFloatType,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
  });

  const sheetSize = uniform(new THREE.Vector2(1, 1));
  const handSize = uniform(new THREE.Vector2(1, 1));
  // «Кипение»: третья координата шума, одна на все поля. Шагает 8 раз в секунду.
  const boil = uniform(0);

  // ── лист ───────────────────────────────────────────────────────────────
  const sheetMaterial = new THREE.NodeMaterial();
  sheetMaterial.fragmentNode = Fn(() => {
    const css: N = uv().mul(sheetSize).div(u.dpr).toVar();
    // Бумага: лёгкое зерно и волокна.
    const fibre: N = mx_noise_float(vec3(css.x.mul(0.9), css.y.mul(0.11), 3.0))
      .mul(0.6)
      .add(mx_noise_float(vec3(css.mul(0.55), 8.0)).mul(0.4));
    const tone: N = fibre.mul(0.022).add(1.0).mul(mx_noise_float(vec3(css.mul(0.005), 5.0)).mul(0.03).add(1.0));
    const tooth: N = hash21(floor(css))
      .mul(0.5)
      .add(mx_noise_float(vec3(css.mul(0.45), 1.0)).mul(0.25).add(0.5));
    // Очерёдность рисования: пятнами и вытянутыми вдоль штриха полосами — как идёт рука.
    const patches: N = mx_noise_float(vec3(css.mul(0.011), 31.0)).mul(0.5).add(0.5);
    const streaks: N = mx_noise_float(vec3(rot(css, 0.6).mul(vec2(0.0035, 0.045)), 47.0)).mul(0.5).add(0.5);
    // Упаковка в 0…1: тон бумаги гуляет в пределах 0.95…1.05, зерно — 0.25…1.25,
    // очерёдность — 0…0.5. Распаковывает шкура (sketch.ts).
    return vec4(tone.sub(0.94).mul(8.0), tooth.div(1.3), patches.mul(0.28).add(streaks.mul(0.22)).mul(2.0), 1);
  })();

  // ── рука ───────────────────────────────────────────────────────────────
  const handMaterial = new THREE.NodeMaterial();
  handMaterial.fragmentNode = Fn(() => {
    const p: N = uv().mul(vec2(handSize.x, handSize.y.mul(HAND_ROWS)));
    const row: N = floor(p.y.div(handSize.y)).toVar();
    // Центр клетки в CSS-пикселях экрана: поле то же самое, что считал бы пиксель.
    const css: N = vec2(p.x, p.y.sub(row.mul(handSize.y))).mul(HAND_CELL).toVar();
    const channel = (index: number): N => {
      /** Число из таблицы для этой полосы. */
      const of = (k: number): N => {
        const values = HAND.map((fields) => fields[index][k]);
        if (values.every((v) => v === values[0])) return float(values[0]);
        return values.reduce((sum: N, v, i) => sum.add(pick(row, i).mul(v)), float(0));
      };
      return mx_noise_float(vec3(css.mul(of(0)).add(of(1)), boil.add(of(2))));
    };
    return vec4(channel(0), channel(1), channel(2), channel(3));
  })();

  // ── разрывы ────────────────────────────────────────────────────────────
  const gapMaterial = new THREE.NodeMaterial();
  gapMaterial.fragmentNode = Fn(() => {
    const p: N = uv().mul(GAP_CELLS);
    const layer = (salt: number): N => mx_noise_float(vec3(p, boil.add(salt)));
    return vec4(layer(1), layer(2), layer(3), 1);
  })();

  const quad = new THREE.QuadMesh();
  const buffer = new THREE.Vector2();
  let state: unknown;
  let primed = false; // первый раз считаем всё, даже если наброска не видно: шейдеры собираются под заставкой
  let sheetDirty = true;
  let handDirty = true;
  let bakedDpr = 0;
  let bakedStep = NaN;
  let bakedW = 0; // размер экрана в CSS-пикселях, под который посчитана рука
  let bakedH = 0;

  const render = (renderer: THREE.Renderer, material: THREE.NodeMaterial, target: THREE.RenderTarget) => {
    quad.material = material;
    renderer.setRenderTarget(target);
    quad.render(renderer);
  };

  const owner = new BeforeFrameNode((renderer) => {
    const seen = sketchIndex < 0 || u.skinA.value === sketchIndex || u.skinB.value === sketchIndex;
    if (primed && !seen) return;

    renderer.getDrawingBufferSize(buffer);
    const dpr = u.dpr.value;
    // Шаг «кипения» считается так же, как его считал шейдер: в одинарной точности.
    const step = Math.floor(Math.fround(u.clock.value) * 8);
    const w = buffer.x / dpr;
    const h = buffer.y / dpr;

    // Лист привязан к CSS-пикселям, поэтому лист большего размера годится и для
    // меньшего экрана: пересчитываем, только когда экран вырос или сменилась плотность.
    // Иначе на телефоне он пересчитывался бы на каждое появление адресной строки.
    const sheetStale = sheetDirty || dpr !== bakedDpr || buffer.x > sheetTarget.width || buffer.y > sheetTarget.height;
    const handStale = handDirty || step !== bakedStep || w !== bakedW || h !== bakedH;
    if (!sheetStale && !handStale) return;

    state = THREE.RendererUtils.resetRendererState(renderer, state as never);
    if (sheetStale) {
      const keep = dpr === bakedDpr;
      sheetTarget.setSize(
        Math.max(buffer.x, keep ? sheetTarget.width : 0),
        Math.max(buffer.y, keep ? sheetTarget.height : 0),
      );
      sheetSize.value.set(sheetTarget.width, sheetTarget.height);
      render(renderer, sheetMaterial, sheetTarget);
      bakedDpr = dpr;
      sheetDirty = false;
    }
    if (handStale) {
      const cols = Math.max(1, Math.ceil(w / HAND_CELL));
      const rows = Math.max(1, Math.ceil(h / HAND_CELL));
      handTarget.setSize(cols, rows * HAND_ROWS);
      handSize.value.set(cols, rows);
      boil.value = (step / 8) * 3.1;
      render(renderer, handMaterial, handTarget);
      render(renderer, gapMaterial, gapTarget);
      bakedStep = step;
      bakedW = w;
      bakedH = h;
      handDirty = false;
    }
    THREE.RendererUtils.restoreRendererState(renderer, state as never);
    primed = true;
  });

  const prepared = (target: THREE.RenderTarget): N => {
    const node = new PreparedTextureNode(target.texture);
    node.owner = owner;
    return nodeObject(node);
  };

  return {
    sheet: prepared(sheetTarget),
    sheetSize,
    hand: prepared(handTarget),
    handSize,
    gaps: prepared(gapTarget),
    invalidate() {
      sheetDirty = true;
      handDirty = true;
    },
  };
}
