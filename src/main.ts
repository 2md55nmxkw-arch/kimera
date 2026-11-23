import '@fontsource/dela-gothic-one';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource-variable/martian-mono';
import './style.css';

import * as THREE from 'three/webgpu';
import { mrt, normalView, output, pass } from 'three/tsl';
import { loadActor } from './actor';
import { SKINS, buildComposite, createUniforms } from './skins';
import { createStage } from './stage';
import { createTrail } from './trail';

const root = document.documentElement;
const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const sections = [...document.querySelectorAll<HTMLElement>('.copy section')];
const hudIndex = document.querySelector<HTMLElement>('#hud-index')!;
const hudName = document.querySelector<HTMLElement>('#hud-name')!;
const hudTech = document.querySelector<HTMLElement>('#hud-tech')!;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const COUNT = SKINS.length;
const SKETCH = SKINS.indexOf('Sketch');
// Лёгкий облёт камеры: у каждой главы свой ракурс.
const YAWS = [-0.16, 0.14, 0];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);

// Радиус линзы за одну главу: появляется из точки, держится,
// а к концу главы заливает экран следующей шкурой.
function lensRadius(q: number, rest: number, flood: number): number {
  if (q < 0.15) return rest * smooth(q / 0.15);
  if (q < 0.62) return rest;
  return rest + flood * smooth((q - 0.62) / 0.38);
}

async function boot() {
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    // ?webgl в адресе принудительно включает запасной рендер — удобно сравнивать.
    forceWebGL: new URLSearchParams(location.search).has('webgl'),
  });
  await renderer.init(); // WebGPU, а если его нет — сам откатится на WebGL 2
  renderer.toneMapping = THREE.NoToneMapping;

  const stage = createStage();
  const { scene, camera } = stage;

  const actor = await loadActor(`${import.meta.env.BASE_URL}models/teto.vrm`);
  scene.add(actor.root);
  stage.setHeadHeight(actor.headY);

  const u = createUniforms(camera);
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, normal: normalView }));
  // three закреплён на r180: это версия, с которой собран MToon-материал three-vrm.
  // В r183+ этот класс называется RenderPipeline.
  const pipeline = new THREE.PostProcessing(renderer);
  const trail = createTrail(renderer);
  pipeline.outputNode = buildComposite(scenePass, u, trail.node);

  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  hudTech.textContent = `${isWebGPU ? 'WebGPU' : 'WebGL 2'} · ${actor.kind === 'vrm' ? 'VRM' : 'stand-in figure'}`;

  const pointer = { x: 0.62, y: 0.42, tx: 0.62, ty: 0.42, press: 0, pressTarget: 0, lastMove: -1e9 };
  let subjectX = 0.5; // где на экране стоит персонаж, 0…1
  let aspect = 1;

  function resize() {
    const w = innerWidth;
    const h = innerHeight;
    if (!w || !h) return; // вкладка ещё не показана
    const dpr = Math.min(devicePixelRatio || 1, 1.75);
    aspect = w / h;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = aspect;
    // На широком экране персонаж уходит вправо, слева остаётся место под слово.
    // На узком — вверх, текст снизу.
    const shiftX = aspect > 1.15 ? 0.13 : 0;
    const shiftY = aspect > 1.15 ? 0 : 0.1;
    subjectX = 0.5 + shiftX;
    camera.setViewOffset(w, h, -shiftX * w, shiftY * h, w, h);
    u.aspect.value = aspect;
    u.dpr.value = dpr;
  }
  resize();
  addEventListener('resize', resize);

  const track = (e: PointerEvent) => {
    pointer.tx = e.clientX / innerWidth;
    pointer.ty = e.clientY / innerHeight;
    pointer.lastMove = performance.now();
  };
  addEventListener('pointermove', track, { passive: true });
  // Короткий клик — «потрогать» персонажа, долгое нажатие или протяжка — раздвинуть линзу.
  // Поэтому линза реагирует на нажатие не сразу, а когда стало ясно, что это не клик.
  const TAP_MS = 240;
  const TAP_SLOP = 10; // на сколько пикселей можно сдвинуться и остаться кликом
  const down = { active: false, at: 0, x: 0, y: 0, moved: false };
  const ndcOf = (clientX: number, clientY: number) =>
    [(clientX / innerWidth) * 2 - 1, 1 - (clientY / innerHeight) * 2] as const;

  addEventListener('pointerdown', (e) => {
    track(e);
    if (e.button !== 0) return;
    down.active = true;
    down.at = performance.now();
    down.x = e.clientX;
    down.y = e.clientY;
    down.moved = false;
  });
  addEventListener(
    'pointermove',
    (e) => {
      if (down.active && Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_SLOP) down.moved = true;
    },
    { passive: true },
  );
  addEventListener('pointerup', (e) => {
    const wasTap = down.active && !down.moved && performance.now() - down.at < TAP_MS;
    down.active = false;
    pointer.pressTarget = 0;
    if (!wasTap) return;
    const [nx, ny] = ndcOf(e.clientX, e.clientY);
    // Попали в персонажа — он реагирует, а в точке клика расходится чернильное кольцо.
    if (actor.poke?.(nx, ny, camera)) trail.splash(e.clientX / innerWidth, e.clientY / innerHeight);
  });
  const release = () => {
    down.active = false;
    pointer.pressTarget = 0;
  };
  addEventListener('pointercancel', release);
  addEventListener('blur', release);

  // Отладочная камера для крупных планов (включается из консоли в dev-сборке).
  // draw ≥ 0 останавливает набросок на этом месте хода рисования.
  const debugView = { on: false, pos: [0, 1.2, 1], target: [0, 1.2, 0], draw: -1 };
  // Набросок: 0 — чистый лист, 1 — готов. Первый раз рисуется не спеша, потом быстрее.
  let draw = 1;
  let drawnBefore = false;
  const faceOnScreen = new THREE.Vector3();
  const faceInView = new THREE.Vector3();
  let chapter = -1;
  let last = performance.now();
  let t = 0;

  const frame = () => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const still = reducedMotion.matches;
    if (!still) t += dt;

    // Нажатие стало зажатием: держат дольше клика или уже тянут.
    if (down.active && (down.moved || now - down.at > TAP_MS * 0.7)) pointer.pressTarget = 1;

    // Прокрутка → глава. Полоса главы центрирована на её секции.
    const vh = sections[0]?.offsetHeight || innerHeight;
    const s = clamp(scrollY / vh, 0, COUNT - 1);
    const band = s + 0.5;
    const i = Math.min(Math.floor(band), COUNT - 1);
    const q = i === COUNT - 1 ? Math.min(band - i, 0.6) : band - i;
    u.skinA.value = i;
    u.skinB.value = (i + 1) % COUNT;

    const shown = Math.round(s);
    if (shown !== chapter) {
      chapter = shown;
      hudIndex.textContent = String(shown + 1).padStart(2, '0');
      hudName.textContent = SKINS[shown];
    }

    // Курсор давно не двигался (или его нет, как на телефоне) — линза бродит сама.
    if (!still && now - pointer.lastMove > 3500) {
      pointer.tx = subjectX + (Math.cos(t * 0.45) * 0.2) / Math.max(aspect, 1);
      pointer.ty = 0.42 + Math.sin(t * 0.62) * 0.17;
    }
    const follow = 1 - Math.exp(-dt * 9);
    const fromX = pointer.x;
    const fromY = pointer.y;
    pointer.x += (pointer.tx - pointer.x) * follow;
    pointer.y += (pointer.ty - pointer.y) * follow;
    // Скорость линзы в экранах в секунду — от неё зависит, сколько чернил остаётся в следе.
    const speed = dt > 1e-4 ? Math.hypot((pointer.x - fromX) * aspect, pointer.y - fromY) / dt : 0;
    pointer.press += (pointer.pressTarget - pointer.press) * (1 - Math.exp(-dt * 7));

    u.pointer.value.set(pointer.x, pointer.y);
    // Радиус задан в долях высоты; на узком экране линзу уменьшаем, чтобы не съедала всю ширину.
    const rest = 0.2 * clamp(aspect * 0.9, 0.55, 1) * (1 + pointer.press * 0.9);
    u.lens.value = lensRadius(q, rest, Math.hypot(aspect, 1) + 0.15);
    u.clock.value = t;

    // След виден только в спокойной части главы: во время заливки он бы мешал переходу.
    u.trailGain.value = still ? 0 : smooth(clamp((q - 0.15) / 0.1, 0, 1)) * (1 - smooth(clamp((q - 0.5) / 0.12, 0, 1)));
    trail.update(dt, t, pointer.x, pointer.y, aspect, rest * 0.8, speed, pointer.press);

    // Набросок рисуется, пока ты в его главе. На подходе к ней линза заливает экран
    // чистым листом; в остальных главах под линзой он показан готовым.
    if (still) {
      draw = 1;
    } else if (i === SKETCH) {
      draw = Math.min(1, draw + dt / (drawnBefore ? 1.6 : 3.8));
      if (draw >= 1) drawnBefore = true;
    } else if (i === SKETCH - 1 && q > 0.62) {
      draw = Math.min(draw, 1 - smooth(clamp((q - 0.62) / 0.1, 0, 1)));
    } else {
      draw = Math.min(1, draw + dt * 2.5);
    }
    u.draw.value = debugView.draw >= 0 ? debugView.draw : draw;

    // Камера: ракурс главы плюс небольшой параллакс от курсора.
    const i0 = Math.floor(s);
    const yaw =
      lerp(YAWS[i0], YAWS[Math.min(i0 + 1, COUNT - 1)], smooth(s - i0)) - (pointer.x - 0.5) * 0.1;
    const dist = 2.05 * Math.max(1, 0.9 / aspect);
    const targetY = actor.headY - 0.17;
    camera.position.set(
      Math.sin(yaw) * dist,
      targetY + 0.03 + (pointer.y - 0.5) * 0.05 * dist,
      Math.cos(yaw) * dist,
    );
    camera.lookAt(0, targetY, 0);
    if (debugView.on) {
      camera.position.fromArray(debugView.pos);
      camera.lookAt(debugView.target[0], debugView.target[1], debugView.target[2]);
    }
    camera.updateMatrixWorld(); // нужна актёру уже в этом кадре, чтобы навести взгляд

    stage.update(still ? 0 : dt, t);
    actor.update(
      dt,
      t,
      {
        x: clamp((pointer.x - subjectX) * 2.2, -1, 1),
        y: clamp((0.42 - pointer.y) * 2.2, -1, 1),
        ndcX: pointer.x * 2 - 1,
        ndcY: 1 - pointer.y * 2,
      },
      camera,
      { chapter: s, press: pointer.press },
    );

    // Где на экране лицо и какого оно размера: вокруг него строится витражная роза,
    // от него отсчитывается «недорисованность» эскиза и свет на фоне.
    faceOnScreen.copy(actor.face).project(camera);
    u.head.value.set((faceOnScreen.x + 1) / 2, (1 - faceOnScreen.y) / 2);
    faceOnScreen.copy(actor.cheeks[0]).project(camera);
    u.cheekL.value.set((faceOnScreen.x + 1) / 2, (1 - faceOnScreen.y) / 2);
    faceOnScreen.copy(actor.cheeks[1]).project(camera);
    u.cheekR.value.set((faceOnScreen.x + 1) / 2, (1 - faceOnScreen.y) / 2);
    const faceDepth = -faceInView.copy(actor.face).applyMatrix4(camera.matrixWorldInverse).z;
    u.headSize.value = 0.115 / (Math.max(faceDepth, 0.1) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * 2);

    // Над персонажем курсор становится «рукой»: тут можно кликнуть.
    // Берём настоящее положение мыши, а не сглаженную линзу.
    const hot =
      now - pointer.lastMove < 3500 && !down.active
        ? actor.hit?.(pointer.tx * 2 - 1, 1 - pointer.ty * 2, camera)
        : null;
    // Ставим на body: поверх холста лежит слой с текстом, и курсор берётся с него.
    const cursor = hot ? 'pointer' : '';
    if (document.body.style.cursor !== cursor) document.body.style.cursor = cursor;

    pipeline.render();
  };
  renderer.setAnimationLoop(frame);

  root.dataset.ready = '';

  // Только в dev-сборке: ручка для отладки из консоли.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__kimera = { scene, camera, actor, pointer, renderer, pipeline, u, debugView, frame, THREE };
  }
}

boot().catch((err) => {
  console.error('[kimera] не удалось запустить графику:', err);
  root.dataset.gfx = 'none';
  root.dataset.ready = '';
});
