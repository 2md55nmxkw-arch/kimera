// Сборка: создаёт рендер, сцену, персонажа и шкуры и крутит цикл кадра.
// Самой механики здесь нет — она в модулях; как они договариваются между собой,
// описано в core/contracts.ts.
import '@fontsource/dela-gothic-one';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource-variable/martian-mono';
import './style.css';

import * as THREE from 'three/webgpu';
import { loadActor } from './actor';
import { bindLangSwitch, say, type Key } from './content/i18n';
import { createLabels } from './content/labels';
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
import { markAt } from './stage/kit';
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
  // ?freeze=<кадр> — замереть в состоянии контрольного кадра (для снимка всей страницы),
  // ?perf=<набор> — замерить время кадра. Тоже только dev; обычный цикл в них не идёт.
  const freezeShot = import.meta.env.DEV ? params.get('freeze') : null;
  const perfSet = import.meta.env.DEV ? params.get('perf') : null;
  const staged = Boolean(shotSet || freezeShot || perfSet);
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
  if (!staged) guardDevice(renderer, () => delete root.dataset.ready);
  // Контрольные кадры всегда снимаются в полном качестве.
  const quality = createQuality(levelFrom(params.get('q')) ?? (staged ? 'high' : null));

  // Настоящие тени — со среднего уровня качества (уровень запомнен с прошлого визита).
  const shadows = quality.atLeast('medium');
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const stage = createStage(shadows);
  const { scene, camera } = stage;

  // Ход загрузки модели виден заставке: переменная --load на <html>, 0…1.
  const actor = await loadActor(`${import.meta.env.BASE_URL}models/teto.vrm`, (loaded) =>
    root.style.setProperty('--load', loaded.toFixed(3)),
  );
  root.style.setProperty('--load', '1');
  tag(actor.root, ID.actor);
  scene.add(actor.root);

  const u = createUniforms(camera);
  const scenePass = createScenePass(scene, camera);
  // three закреплён на r180: это версия, с которой собран MToon-материал three-vrm.
  // В r183+ этот класс называется RenderPipeline.
  const pipeline = new THREE.PostProcessing(renderer);
  const trail = createTrail(renderer);
  pipeline.outputNode = buildComposite(scenePass, u, trail.node);

  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  say(hudTech, actor.kind === 'vrm' ? 'hud.model' : 'hud.standin', isWebGPU ? 'WebGPU' : 'WebGL 2');
  bindLangSwitch(document);

  const ndcOf = (clientX: number, clientY: number) =>
    [(clientX / innerWidth) * 2 - 1, 1 - (clientY / innerHeight) * 2] as const;
  const input = createInput((clientX, clientY) => {
    const [nx, ny] = ndcOf(clientX, clientY);
    const x = clientX / innerWidth;
    const y = clientY / innerHeight;
    // Попали в персонажа — он реагирует, а в точке клика расходится чернильное кольцо.
    const zone = actor.poke?.(nx, ny, camera) ?? null;
    if (zone) trail.splash(x, y);
    for (const part of parts) part.poke?.({ x, y, zone });
  });
  const pointer = input.pointer;

  // Ручки для отладки из консоли dev-сборки: своя камера и остановка хода наброска.
  const debugView = { on: false, pos: [0, 1.2, 1], target: [0, 1.2, 0], draw: -1 };

  // Части со своим состоянием. Новая механика подключается сюда одной строкой.
  const labels = createLabels(camera, () => ({
    x: u.head.value.x * innerWidth,
    y: u.head.value.y * innerHeight,
    r: u.headSize.value * innerHeight * 1.15,
  }));
  const parts: Part[] = [createSketchDraw(SKINS.indexOf('Sketch'), debugView), labels];

  // ── что к чему привязано ───────────────────────────────────────────────
  // Гримёрка: анкета. Часть фактов живёт на самой Тето, часть — на вещах.
  const spot = new THREE.Vector3();
  const on = (name: string) => () => actor.points[name] ?? null;
  const at = (name: string) => () => markAt(name, spot);
  labels.anchor('profile.height', on('top'), 110);
  labels.anchor('profile.hair', on('drillR'), 150);
  labels.anchor('profile.uniform', on('body'), -30);
  labels.anchor('profile.number', on('armL'), 10);
  labels.anchor('profile.sheet', at('mirror'), -90);
  labels.anchor('profile.phrase', at('note'), -60);
  labels.anchor('profile.bread', at('bread'), 180);
  // Мастерская: двенадцать эпизодов истории — двенадцать лепестков розы вокруг головы.
  const HISTORY = ['proposal', 'hoax', 'utau', 'fame', 'twindrill', 'piapro', 'day', 'disc', 'decade', 'synthv', 'voices', 'eighteen'];
  HISTORY.forEach((id, k) => {
    const a = -Math.PI / 2 + (k / HISTORY.length) * Math.PI * 2; // с макушки по часовой
    labels.anchorOnScreen(
      `history.${id}`,
      (head) => ({ x: head.x + Math.cos(a) * head.r * 2.05, y: head.y + Math.sin(a) * head.r * 2.05 }),
      (-a * 180) / Math.PI,
    );
  });
  // Стол художника: пометки от руки на листе.
  labels.anchor('design.eyes', on('face'), 25);
  labels.anchor('design.hair', on('drillL'), 70);
  labels.anchor('design.uniform', on('body'), -25);
  labels.anchor('design.size', on('top'), 115);
  labels.anchorOnScreen('design.artist', () => ({ x: innerWidth * 0.8, y: innerHeight * 0.74 }), 0, false);
  labels.anchorOnScreen('design.voice', () => ({ x: innerWidth * 0.8, y: innerHeight * 0.82 }), 0, false);

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
  // Стукнула в «стекло» изнутри — по нему расходится такое же кольцо, как от клика.
  const knockAt = new THREE.Vector2();
  actor.onKnock = (at) => {
    toScreen(at, knockAt);
    trail.splash(knockAt.x, knockAt.y);
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
      say(hudName, `skin.${shown}` as Key);
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
    const lens = lensRadius(q, lensRest, Math.hypot(aspect, 1) + 0.15);
    u.lens.value = lens;
    u.clock.value = t;

    const frame: Frame = { dt, t, still, s, chapter, q, aspect, subjectX, pointer, lensRest, lens, idle: env.idle ?? 0 };

    // След виден только в спокойной части главы: во время заливки он бы мешал переходу.
    u.trailGain.value = still ? 0 : smooth(clamp((q - 0.15) / 0.1, 0, 1)) * (1 - smooth(clamp((q - 0.5) / 0.12, 0, 1)));
    trail.update(dt, t, pointer.x, pointer.y, aspect, lensRest * 0.8, speed, pointer.press);

    for (const part of parts) part.step?.(frame);

    placeCamera(camera, frame, actor.headY, debugView);
    stage.step(frame);
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
      { chapter: s, press: pointer.press, idle: frame.idle, still },
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
    step(dt, { s: scrollY / vh, still, roam: !still && idle, idle: Math.max(0, now - pointer.lastMove) / 1000 });

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

  if (!staged) {
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
      scrollTo(s) {
        const vh = sections[0]?.offsetHeight || innerHeight;
        scrollTo({ top: Math.round(s) * vh, behavior: 'instant' });
      },
      async sync() {
        // Дождаться, пока видеокарта действительно дорисует кадр.
        const device = (renderer.backend as { device?: { queue: { onSubmittedWorkDone(): Promise<void> } } }).device;
        if (isWebGPU && device) {
          await device.queue.onSubmittedWorkDone();
          return;
        }
        // На WebGL finish() в Chrome возвращается сразу; ставим «забор» и ждём его.
        const gl = renderer.getContext() as unknown as WebGL2RenderingContext;
        const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        if (!fence) return;
        const channel = new MessageChannel(); // setTimeout округлял бы ожидание до 4 мс
        await new Promise<void>((resolve) => {
          channel.port1.onmessage = () => {
            const status = gl.clientWaitSync(fence, 0, 0);
            if (status === gl.TIMEOUT_EXPIRED && !gl.isContextLost()) channel.port2.postMessage(0);
            else resolve();
          };
          channel.port2.postMessage(0);
        });
        gl.deleteSync(fence);
        channel.port1.close();
      },
      render() {
        // three обновляет проход сцены раз за «кадр», а номер кадра двигает его
        // собственный цикл rAF. Здесь кадры идут подряд в одной задаче, без rAF,
        // поэтому номер двигаем сами — иначе после смены размера в буфере пусто.
        (renderer as unknown as { _nodes?: { nodeFrame?: { update(): void } } })._nodes?.nodeFrame?.update();
        render();
      },
    };
    const { freezeAt, runPerf, runShots } = await import('./core/capture');
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
    if (perfSet) await runPerf(rig, perfSet);
    if (freezeShot) {
      freezeAt(rig, freezeShot);
      (window as unknown as Record<string, unknown>).__frozen = true;
    }
  }
}

boot().catch((err) => {
  console.error('[kimera] не удалось запустить графику:', err);
  root.dataset.gfx = 'none';
  root.dataset.ready = '';
});
