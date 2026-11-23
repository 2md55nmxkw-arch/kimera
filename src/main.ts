// Сборка: создаёт рендер, сцену, персонажа и шкуры и крутит цикл кадра.
// Самой механики здесь нет — она в модулях; как они договариваются между собой,
// описано в core/contracts.ts.
import '@fontsource/dela-gothic-one';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource-variable/martian-mono';
import './style.css';

import * as THREE from 'three/webgpu';
import { loadActor } from './actor';
import type { Rig } from './core/capture';
import { chapterAt, lensRadius } from './core/chapters';
import type { Frame, Part, StepEnv } from './core/contracts';
import { ID, createScenePass, tag } from './core/gbuffer';
import { createInput } from './core/input';
import { clamp, smooth } from './core/math';
import { createQuality, levelFrom } from './core/quality';
import { reseed } from './core/random';
import { guardDevice, recoveryPlan } from './core/recovery';
import { createTrail } from './fx/trail';
import { SKINS, buildComposite, createUniforms } from './skins';
import { createSketchDraw } from './skins/sketch';
import { createStage } from './stage';
import { frameCamera, placeCamera } from './stage/camera';

const root = document.documentElement;
const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const sections = [...document.querySelectorAll<HTMLElement>('.copy section')];
const hudIndex = document.querySelector<HTMLElement>('#hud-index')!;
const hudName = document.querySelector<HTMLElement>('#hud-name')!;
const hudTech = document.querySelector<HTMLElement>('#hud-tech')!;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const COUNT = SKINS.length;

async function boot() {
  const params = new URLSearchParams(location.search);
  // ?shots=<набор> — снять контрольные кадры и ничего больше не делать (только dev).
  const shotSet = import.meta.env.DEV ? params.get('shots') : null;
  // Недавно теряли видеокарту — пробуем запасной рендер, а потом сдаёмся (core/recovery.ts).
  const recovery = recoveryPlan();
  if (recovery.giveUp) throw new Error('видеокарта теряется раз за разом');
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    // ?webgl в адресе принудительно включает запасной рендер — удобно сравнивать.
    forceWebGL: params.has('webgl') || recovery.forceWebGL,
  });
  await renderer.init(); // WebGPU, а если его нет — сам откатится на WebGL 2
  renderer.toneMapping = THREE.NoToneMapping;
  if (!shotSet) guardDevice(renderer, () => delete root.dataset.ready);
  // Контрольные кадры всегда снимаются в полном качестве.
  const quality = createQuality(shotSet ? 'high' : levelFrom(params.get('q')));

  const stage = createStage();
  const { scene, camera } = stage;
  tag(scene, ID.stage);

  const actor = await loadActor(`${import.meta.env.BASE_URL}models/teto.vrm`);
  tag(actor.root, ID.actor);
  scene.add(actor.root);
  stage.setHeadHeight(actor.headY);

  const u = createUniforms(camera);
  const scenePass = createScenePass(scene, camera);
  // three закреплён на r180: это версия, с которой собран MToon-материал three-vrm.
  // В r183+ этот класс называется RenderPipeline.
  const pipeline = new THREE.PostProcessing(renderer);
  const trail = createTrail(renderer);
  pipeline.outputNode = buildComposite(scenePass, u, trail.node);

  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  hudTech.textContent = `${isWebGPU ? 'WebGPU' : 'WebGL 2'} · ${actor.kind === 'vrm' ? 'VRM' : 'stand-in figure'}`;

  const ndcOf = (clientX: number, clientY: number) =>
    [(clientX / innerWidth) * 2 - 1, 1 - (clientY / innerHeight) * 2] as const;
  const input = createInput((clientX, clientY) => {
    const [nx, ny] = ndcOf(clientX, clientY);
    // Попали в персонажа — он реагирует, а в точке клика расходится чернильное кольцо.
    if (actor.poke?.(nx, ny, camera)) trail.splash(clientX / innerWidth, clientY / innerHeight);
  });
  const pointer = input.pointer;

  // Ручки для отладки из консоли dev-сборки: своя камера и остановка хода наброска.
  const debugView = { on: false, pos: [0, 1.2, 1], target: [0, 1.2, 0], draw: -1 };

  // Части со своим состоянием. Новая механика подключается сюда одной строкой.
  const parts: Part[] = [createSketchDraw(SKINS.indexOf('Sketch'), debugView)];

  let subjectX = 0.5; // где на экране стоит персонаж, 0…1
  let aspect = 1;

  function resizeTo(w: number, h: number, dpr: number) {
    aspect = w / h;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    subjectX = frameCamera(camera, w, h);
    u.aspect.value = aspect;
    u.dpr.value = dpr;
  }
  function resize() {
    if (!innerWidth || !innerHeight) return; // вкладка ещё не показана
    resizeTo(innerWidth, innerHeight, quality.pixelRatio());
  }
  resize();
  addEventListener('resize', resize);

  const onScreen = new THREE.Vector3();
  const inView = new THREE.Vector3();
  const toScreen = (world: THREE.Vector3, out: THREE.Vector2) => {
    onScreen.copy(world).project(camera);
    out.set((onScreen.x + 1) / 2, (1 - onScreen.y) / 2);
  };
  let shownChapter = -1;
  let t = 0;

  /** Вернуть всё к состоянию сразу после загрузки. */
  function reset() {
    reseed(1);
    t = 0;
    Object.assign(pointer, { x: 0.62, y: 0.42, tx: 0.62, ty: 0.42, press: 0, pressTarget: 0 });
    actor.reset?.();
    trail.reset();
    stage.reset();
    for (const part of parts) part.reset?.();
  }

  /**
   * Один шаг симуляции: всё, что меняется со временем. Часов, прокрутки и мыши
   * здесь нет — они приходят в env, поэтому шаг можно повторить с тем же результатом.
   */
  function step(dt: number, env: StepEnv) {
    const still = env.still;
    if (!still) t += dt;

    const { s, chapter, q } = chapterAt(env.s, COUNT);
    u.skinA.value = chapter;
    u.skinB.value = (chapter + 1) % COUNT;

    const shown = Math.round(s);
    if (shown !== shownChapter) {
      shownChapter = shown;
      hudIndex.textContent = String(shown + 1).padStart(2, '0');
      hudName.textContent = SKINS[shown];
    }

    // Курсор давно не двигался (или его нет, как на телефоне) — линза бродит сама.
    if (env.roam) {
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
    const lensRest = 0.2 * clamp(aspect * 0.9, 0.55, 1) * (1 + pointer.press * 0.9);
    u.lens.value = lensRadius(q, lensRest, Math.hypot(aspect, 1) + 0.15);
    u.clock.value = t;

    const frame: Frame = { dt, t, still, s, chapter, q, aspect, subjectX, pointer, lensRest };

    // След виден только в спокойной части главы: во время заливки он бы мешал переходу.
    u.trailGain.value = still ? 0 : smooth(clamp((q - 0.15) / 0.1, 0, 1)) * (1 - smooth(clamp((q - 0.5) / 0.12, 0, 1)));
    trail.update(dt, t, pointer.x, pointer.y, aspect, lensRest * 0.8, speed, pointer.press);

    for (const part of parts) part.step?.(frame);

    placeCamera(camera, frame, actor.headY, debugView);
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
    toScreen(actor.face, u.head.value);
    toScreen(actor.cheeks[0], u.cheekL.value);
    toScreen(actor.cheeks[1], u.cheekR.value);
    const faceDepth = -inView.copy(actor.face).applyMatrix4(camera.matrixWorldInverse).z;
    u.headSize.value = 0.115 / (Math.max(faceDepth, 0.1) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * 2);
  }

  const render = () => pipeline.render();

  let last = performance.now();
  const frame = () => {
    const now = performance.now();
    // Не успеваем — рисуем мельче, стало легче — возвращаемся (core/quality.ts).
    if (quality.measure(now - last, now)) resize();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    input.poll(now);
    const still = reducedMotion.matches;
    const vh = sections[0]?.offsetHeight || innerHeight;
    const idle = input.idle(now);
    step(dt, { s: scrollY / vh, still, roam: !still && idle });

    // Над персонажем курсор становится «рукой»: тут можно кликнуть.
    // Берём настоящее положение мыши, а не сглаженную линзу.
    const hot = !idle && !input.down ? actor.hit?.(pointer.tx * 2 - 1, 1 - pointer.ty * 2, camera) : null;
    // Ставим на body: поверх холста лежит слой с текстом, и курсор берётся с него.
    const cursor = hot ? 'pointer' : '';
    if (document.body.style.cursor !== cursor) document.body.style.cursor = cursor;

    render();
  };
  // Первый кадр рисуется ещё под заставкой: на нём собираются все шейдеры,
  // и заминка от этого не попадает в первые секунды на глазах у зрителя.
  step(0, { s: scrollY / (sections[0]?.offsetHeight || innerHeight), still: reducedMotion.matches, roam: false });
  render();

  if (!shotSet) {
    renderer.setAnimationLoop(frame);
    // В скрытой вкладке не считаем ничего; при возврате время не делает скачка.
    document.addEventListener('visibilitychange', () => {
      last = performance.now();
      renderer.setAnimationLoop(document.hidden ? null : frame);
    });
  }

  root.dataset.ready = '';

  // Только в dev-сборке: ручка для отладки из консоли и стенд контрольных кадров.
  if (import.meta.env.DEV) {
    const rig: Rig = {
      canvas,
      backend: isWebGPU ? 'webgpu' : 'webgl',
      camera,
      actor,
      pointer,
      debugView,
      u,
      resizeTo,
      resize,
      reset,
      step,
      render() {
        // three обновляет проход сцены раз за «кадр», а номер кадра двигает его
        // собственный цикл rAF. Здесь кадры идут подряд в одной задаче, без rAF,
        // поэтому номер двигаем сами — иначе после смены размера в буфере пусто.
        (renderer as unknown as { _nodes?: { nodeFrame?: { update(): void } } })._nodes?.nodeFrame?.update();
        render();
      },
    };
    const { runShots } = await import('./core/capture');
    /** Снять контрольные кадры из консоли; обычный цикл на это время останавливается. */
    const shots = async (set = 'current', only?: string[]) => {
      renderer.setAnimationLoop(null);
      try {
        return await runShots(rig, set, only);
      } finally {
        last = performance.now();
        renderer.setAnimationLoop(frame);
      }
    };
    (window as unknown as Record<string, unknown>).__kimera = { scene, camera, actor, pointer, renderer, pipeline, u, debugView, frame, rig, shots, quality, THREE };
    if (shotSet) await runShots(rig, shotSet, params.get('only')?.split(','));
  }
}

boot().catch((err) => {
  console.error('[kimera] не удалось запустить графику:', err);
  root.dataset.gfx = 'none';
  root.dataset.ready = '';
});
