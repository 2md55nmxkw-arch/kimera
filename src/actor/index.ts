import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MToonMaterialLoaderPlugin, VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { MToonNodeMaterial } from '@pixiv/three-vrm/nodes';
import { applyDance, type DanceName } from './dance';
import { createLife, type IdleName } from './life';
import { createMemory, type Memory } from './memory';
import { markBodyParts } from './parts';
import { createPoser, type Mood } from './pose';
import { createReactor, type Zone } from './react';
import { createWind } from './wind';

export interface Look {
  x: number; // куда повернуть голову: −1 слева … 1 справа от персонажа
  y: number; // −1 внизу … 1 вверху
  ndcX: number; // сам курсор на экране, −1 … 1
  ndcY: number;
}

export interface Actor {
  kind: 'vrm' | 'stand-in';
  root: THREE.Object3D;
  headY: number;
  /** Центр лица в мире; обновляется каждый кадр. */
  face: THREE.Vector3;
  /** Щёки в мире: [левая, правая]. */
  cheeks: [THREE.Vector3, THREE.Vector3];
  /**
   * Именованные точки на теле в мире, обновляются каждый кадр: face, top, drillL,
   * drillR, body, handL, handR, armL, armR. К ним привязываются подписи и предметы.
   */
  points: Record<string, THREE.Vector3>;
  update(dt: number, t: number, look: Look, camera: THREE.PerspectiveCamera, mood: Mood): void;
  /** Что у персонажа под этой точкой экрана (координаты −1…1), если что-то есть. */
  hit?(ndcX: number, ndcY: number, camera: THREE.PerspectiveCamera): Zone | null;
  /** Клик по персонажу: запускает реакцию и возвращает зону, в которую попали. */
  poke?(ndcX: number, ndcY: number, camera: THREE.PerspectiveCamera): Zone | null;
  /** Запустить реакцию напрямую, без попадания по экрану. */
  react?(zone: Zone, offset: number): void;
  /**
   * Точка в мире, на которую ей может быть интересно посмотреть. Вес от 1 — «посмотри
   * сейчас» (держится, пока вызов повторяют); меньше 1 — точка попадает в список, из
   * которого она сама изредка выбирает, куда глянуть; 0 — убрать из списка.
   * Вектор хранится по ссылке: предмет может двигаться. Подробнее — actor/life.ts.
   */
  interest?(point: THREE.Vector3 | null, weight?: number): void;
  /**
   * Запустить жест по имени: shift, yawn, stretch, hand, hair, sigh, knock, wave, wary;
   * bored — заскучать до первого движения указателя.
   * @returns false, если сейчас идёт другой жест
   */
  idle?(name: IdleName): boolean;
  /**
   * Внешний ветер по волосам и одежде (вентилятор): направление в мире и сила,
   * 1 — крепкий поток. Держится, пока не сменят; сила 0 — выключить.
   */
  wind?(direction: THREE.Vector3, strength: number): void;
  /** Вызывается в кадре, когда она стукнула костяшками в «стекло» экрана; точка — в мире. */
  onKnock?: ((at: THREE.Vector3) => void) | null;
  /** Что она помнит о посетителе (actor/memory.ts). Только этот браузер. */
  memory?: Memory;
  /** Вернуть всё к состоянию сразу после загрузки: инерцию, моргание, реакции, волосы. */
  reset?(): void;
  /** Играет музыка: она слушает — улыбается и покачивает головой. */
  listen?(on: boolean): void;
  /**
   * Танцевать (actor/dance.ts) или перестать (null).
   * @param tempo движений в минуту
   */
  dance?(name: DanceName | null, tempo?: number): void;
  /** Где сейчас песня, секунды: танец подстраивается под плеер. */
  danceAt?(seconds: number): void;
  /** Для отладки из консоли в dev-сборке. */
  debug?: unknown;
}

// Модель лежит в public/models/teto.vrm. Пока её нет, на сцене стоит манекен.
/** @param onProgress доля загруженного файла модели, 0…1 */
export async function loadActor(url: string, onProgress?: (loaded: number) => void): Promise<Actor> {
  if (await exists(url)) {
    try {
      return await loadVRM(url, onProgress);
    } catch (err) {
      console.warn('[kimera] VRM не загрузилась, ставлю манекен:', err);
    }
  }
  return buildStandIn();
}

async function exists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    // Некоторые хостинги на любой путь отдают index.html с кодом 200.
    return res.ok && !(res.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

// Во сколько раз усилить отклонение взгляда перед тем, как отдать его модели.
const EYE_GAIN = 3;

async function loadVRM(url: string, onProgress?: (loaded: number) => void): Promise<Actor> {
  const loader = new GLTFLoader();
  loader.register(
    (parser) =>
      new VRMLoaderPlugin(parser, {
        // MToon в варианте NodeMaterial: обычный не работает с WebGPURenderer.
        mtoonMaterialPlugin: new MToonMaterialLoaderPlugin(parser, {
          materialType: MToonNodeMaterial,
        }),
      }),
  );

  const gltf = await loader.loadAsync(url, (e) => {
    if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total);
  });
  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) throw new Error('в файле нет данных VRM');

  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm); // модели VRM 0.x смотрят в обратную сторону
  vrm.scene.traverse((o) => {
    o.frustumCulled = false;
    // Тень отбрасывает, но на себя не принимает: рисованному лицу она только вредит.
    o.castShadow = true;
  });
  markBodyParts(vrm); // ярус и рука в каждой вершине — для слоя меток G-буфера

  // У VRM 0.x оси X и Z нормализованного скелета зеркальны относительно VRM 1.0.
  const flip = vrm.meta?.metaVersion === '0' ? -1 : 1;
  const bone = (name: Parameters<NonNullable<VRM['humanoid']>['getNormalizedBoneNode']>[0]) =>
    vrm.humanoid?.getNormalizedBoneNode(name) ?? null;

  const head = bone('head');
  const neck = bone('neck');
  const poser = createPoser(vrm); // тело, руки и пальцы

  // Цель взгляда живёт в мировых координатах, вне модели: сцена VRM 0.x развёрнута
  // на 180°, и дочерняя точка оказалась бы зеркально за спиной персонажа.
  const lookTarget = new THREE.Vector3();
  // Взглядом управляем сами (см. update): по умолчанию VRM поворачивает глаза очень скупо.
  if (vrm.lookAt) vrm.lookAt.autoUpdate = false;
  const aim = new THREE.Vector3();
  const headPos = new THREE.Vector3();

  vrm.scene.updateMatrixWorld(true);
  // Кость головы стоит у основания черепа; центр лица примерно на 8 см выше.
  const headY = (head ? head.getWorldPosition(new THREE.Vector3()).y : 1.32) + 0.08;

  const yaw = { v: 0 };
  const pitch = { v: 0 };

  // ── мелкая жизнь, память, ветер ───────────────────────────────────────
  const life = createLife();
  let wantListen = false;
  let listening = 0; // 0…1, плавно
  // Танец. Просят один (danceName), а идёт, возможно, ещё другой (danceShown): танцы
  // не переключаются на ходу — прежний сначала стихает, и только тогда встаёт новый.
  // Так же с перемоткой песни: стихла, перескочила, вернулась. Иначе поза прыгает.
  let danceName: DanceName | null = null;
  let danceTempo = 96;
  let danceShown: DanceName = 'sway';
  let tempoShown = 96;
  let danceClock = 0; // сколько секунд песни прошло
  let danceLag = 0; // на сколько секунд наши часы отстали от песни
  let danceJump: number | null = null; // перемотка: куда перескочить, когда танец стихнет
  let danceRamp = 0; // 0…1, ход входа в танец
  const memory = createMemory();
  // Гладили в прошлый раз — машет, доводили — косится. Сброс (reset) приветствие отменяет.
  life.greet(memory.standing === 'kind' ? 'wave' : memory.standing === 'wary' ? 'wary' : null);
  const wind = createWind(vrm);
  const seen = { x: 0, y: 0, ready: false }; // где указатель был кадр назад
  let chapterNow = 0;

  // ── реакции на клик ───────────────────────────────────────────────────
  const reactor = createReactor();
  const raw = (name: Parameters<typeof bone>[0]) => vrm.humanoid?.getRawBoneNode(name) ?? null;
  const rawHead = raw('head');
  const rawChest = raw('upperChest') ?? raw('chest');
  const rawHandL = raw('leftMiddleProximal') ?? raw('leftHand');
  const rawHandR = raw('rightMiddleProximal') ?? raw('rightHand');
  const rawArmL = raw('leftUpperArm');
  const rawArmR = raw('rightUpperArm');
  const rawHips = raw('hips');
  const hipsPos = new THREE.Vector3(0, 0.86, 0);
  // Поворот головы считаем относительно исходного, чтобы зоны «ехали» вместе с ней.
  const headRestInv = rawHead
    ? rawHead.getWorldQuaternion(new THREE.Quaternion()).invert()
    : new THREE.Quaternion();

  // Зоны попадания — шары вокруг частей тела. weight < 1 даёт зоне преимущество
  // там, где шары перекрываются (ладонь на груди важнее самой груди).
  const zone = (name: Zone, r: number, weight = 1) => ({ name, r, weight, pos: new THREE.Vector3() });
  const zones = {
    handL: zone('handL', 0.065, 0.7),
    handR: zone('handR', 0.065, 0.7),
    face: zone('face', 0.075, 0.85),
    top: zone('top', 0.08),
    drillL: zone('drillL', 0.1),
    drillR: zone('drillR', 0.1),
    body: zone('body', 0.13, 1.15),
  };
  const zoneList = Object.values(zones);
  const points: Record<string, THREE.Vector3> = { armL: new THREE.Vector3(), armR: new THREE.Vector3() };
  for (const z of zoneList) points[z.name] = z.pos;
  const headWorld = new THREE.Vector3();
  const qHead = new THREE.Quaternion();
  const cheeks: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
  const onHead = (out: THREE.Vector3, x: number, y: number, z: number) =>
    out.set(x, y, z).applyQuaternion(qHead).add(headWorld);

  function locate() {
    if (rawHead) {
      rawHead.getWorldPosition(headWorld);
      rawHead.getWorldQuaternion(qHead).multiply(headRestInv);
      onHead(zones.face.pos, 0, 0.075, 0.07);
      onHead(zones.top.pos, 0, 0.175, 0.01);
      onHead(zones.drillL.pos, 0.185, 0.02, -0.03);
      onHead(zones.drillR.pos, -0.185, 0.02, -0.03);
      onHead(cheeks[0], 0.043, 0.03, 0.085);
      onHead(cheeks[1], -0.043, 0.03, 0.085);
    }
    if (rawChest) {
      rawChest.getWorldPosition(zones.body.pos);
      zones.body.pos.z += 0.06;
    }
    rawHandL?.getWorldPosition(zones.handL.pos);
    rawHandR?.getWorldPosition(zones.handR.pos);
    rawArmL?.getWorldPosition(points.armL);
    rawArmR?.getWorldPosition(points.armR);
    rawHips?.getWorldPosition(hipsPos);
  }

  const inView = new THREE.Vector3();
  const onScreen = new THREE.Vector3();
  /** Ближайшая зона под точкой экрана и то, с какой стороны от её центра точка (−1…1). */
  function find(ndcX: number, ndcY: number, camera: THREE.PerspectiveCamera) {
    locate();
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    let best: Zone | null = null;
    let bestScore = 1;
    let offset = 0;
    for (const z of zoneList) {
      const depth = -inView.copy(z.pos).applyMatrix4(camera.matrixWorldInverse).z;
      if (depth < 0.05) continue;
      onScreen.copy(z.pos).project(camera);
      const dx = (ndcX - onScreen.x) * camera.aspect;
      const dy = ndcY - onScreen.y;
      const radius = z.r / (depth * tanHalf); // радиус шара в тех же экранных единицах
      const score = (Math.hypot(dx, dy) / radius) * z.weight;
      if (score < bestScore) {
        bestScore = score;
        best = z.name;
        offset = THREE.MathUtils.clamp(dx / radius, -1, 1);
      }
    }
    return best ? { zone: best, offset } : null;
  }

  const away = new THREE.Vector3();
  const hands: [THREE.Vector3, THREE.Vector3] = [zones.handL.pos, zones.handR.pos];
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

  const actor: Actor = {
    kind: 'vrm',
    root: vrm.scene,
    headY,
    face: zones.face.pos,
    cheeks,
    points,
    memory,
    onKnock: null,
    debug: { vrm, lookTarget, poser, reactor, zones, life, wind },
    hit(ndcX, ndcY, camera) {
      return find(ndcX, ndcY, camera)?.zone ?? null;
    },
    poke(ndcX, ndcY, camera) {
      const found = find(ndcX, ndcY, camera);
      if (!found) return null;
      const kind = reactor.trigger(found.zone, found.offset);
      // Запоминаются только настоящие клики: react() из контрольных кадров память не трогает.
      if (kind === 'sulk') memory.note('sulk');
      else if (kind === 'joy') memory.note('joy');
      else if (kind === 'top') memory.note('pat');
      return found.zone;
    },
    react(zone, offset) {
      reactor.trigger(zone, offset);
    },
    interest(point, weight) {
      life.interest(point, weight);
    },
    idle(name) {
      return life.trigger(name, chapterNow);
    },
    wind(direction, strength) {
      wind?.set(direction, strength);
    },
    listen(on) {
      wantListen = on;
    },
    dance(name, tempo = 96) {
      danceName = name;
      danceTempo = tempo;
      if (name === danceShown) tempoShown = tempo;
    },
    danceAt(seconds) {
      // Плеер сообщает время песни несколько раз в секунду. Мелкое расхождение
      // выбираем понемногу, чуть ускоряя или замедляя свои часы; крупное — перемотка.
      const off = seconds - danceClock;
      if (Math.abs(off) > 1) danceJump = seconds;
      else {
        danceJump = null;
        danceLag = off;
      }
    },
    reset() {
      wantListen = false;
      listening = 0;
      danceName = null;
      danceClock = 0;
      danceLag = 0;
      danceJump = null;
      danceRamp = 0;
      yaw.v = 0;
      pitch.v = 0;
      seen.ready = false;
      reactor.reset();
      life.reset(); // и приветствие тоже: после сброса она всегда нейтральна
      poser?.reset();
      wind?.reset();
      vrm.springBoneManager?.reset();
    },
    update(dt, t, look, camera, mood) {
      const react = reactor.update(dt);
      const still = mood.still ?? false;
      chapterNow = mood.chapter;

      // Скорость указателя, высот экрана в секунду: быстрый взмах перед лицом забирает внимание.
      const speed =
        seen.ready && dt > 1e-4
          ? Math.hypot(((look.ndcX - seen.x) / 2) * camera.aspect, (look.ndcY - seen.y) / 2) / dt
          : 0;
      seen.x = look.ndcX;
      seen.y = look.ndcY;
      seen.ready = true;

      const live = life.update(dt, {
        idle: mood.idle ?? 0,
        still,
        press: mood.press,
        busy: reactor.busy || danceName !== null, // пока танцует, не зевает и не скучает
        chapter: mood.chapter,
        speed,
        eye: camera.position,
        face: zones.face.pos,
        hands,
      });
      // Танец. Сменить его или перескочить по песне можно, только когда он стих.
      const other = danceName !== null && danceName !== danceShown;
      if (danceRamp <= 0 && (other || danceJump !== null)) {
        if (other) {
          danceShown = danceName!;
          tempoShown = danceTempo;
          danceClock = 0;
        }
        if (danceJump !== null) danceClock = danceJump;
        danceJump = null;
        danceLag = 0;
      }
      if (danceName) {
        const fix = Math.min(0.15, Math.max(-0.15, danceLag * 2)) * dt;
        danceClock += dt + fix;
        danceLag -= fix;
      }
      const wantDance = danceName !== null && !other && danceJump === null && !still;
      danceRamp = clamp01(danceRamp + (wantDance ? dt : -dt) / 0.5);
      const dancing = danceRamp * danceRamp * (3 - 2 * danceRamp);
      if (dancing > 0.002) applyDance(danceShown, (danceClock * tempoShown) / 60, dancing, live);
      listening += ((wantListen && !still ? 1 : 0) - listening) * (1 - Math.exp(-dt * 2.5));
      // Слушает, когда музыка открыта, но не танцует (пауза, загрузка).
      if (listening * (1 - dancing) > 0.002) {
        const beat = t * 3.4;
        const calmly = listening * (1 - dancing);
        live.happy = Math.max(live.happy, 0.55 * calmly);
        live.headRoll += Math.sin(beat) * 0.055 * calmly;
        live.bob += Math.abs(Math.sin(beat)) * 0.007 * calmly;
      }
      // Обиделась — на курсор не смотрит; заскучала — следит вполглаза.
      const attend = (1 - react.ignore) * live.attend;
      if (head) head.getWorldPosition(headPos);

      const k = 1 - Math.exp(-dt * 6);
      // В покое голова развёрнута к камере (та облетает персонажа от главы к главе),
      // а за курсором поворачивается не до конца: остаток угла добирают глаза.
      const toCamera = Math.atan2(camera.position.x, camera.position.z) * 0.85;
      let yawTo = toCamera + look.x * 0.3 * attend + react.awayYaw * react.ignore;
      let pitchTo = -look.y * 0.16 * attend;
      // Отвела взгляд — голова идёт следом, но не до конца: остальное добирают глаза.
      const glance = live.gaze * (1 - react.ignore);
      if (glance > 0.001) {
        away.copy(live.gazeAt).sub(headPos);
        const follow = glance * live.gazeHead;
        yawTo += (Math.atan2(away.x, away.z) * 0.6 - yawTo) * follow;
        pitchTo += (-Math.atan2(away.y, Math.hypot(away.x, away.z)) * 0.5 - pitchTo) * follow;
      }
      yaw.v += (yawTo - yaw.v) * k;
      pitch.v += (pitchTo - pitch.v) * k;

      // Точка под курсором: луч из камеры через курсор, точка на нём близко к лицу.
      // Даже небольшой сдвиг курсора заметно уводит взгляд, а когда курсор на лице,
      // точка лежит между лицом и камерой — получается взгляд в зрителя.
      // К этой же точке в последней главе тянется рука.
      aim.set(look.ndcX, look.ndcY, 0.5).unproject(camera).sub(camera.position).normalize();
      lookTarget
        .copy(camera.position)
        .addScaledVector(aim, camera.position.distanceTo(headPos) * 0.8);
      if (glance > 0.001) lookTarget.lerp(live.gazeAt, glance);
      if (react.ignore > 0.001) {
        // Демонстративно смотрит в сторону.
        away.set(Math.sin(react.awayYaw) * 2, headPos.y + 0.15, Math.cos(react.awayYaw) * 2);
        lookTarget.lerp(away, react.ignore);
      }

      // Поза главы, дыхание, перенос веса, руки.
      const pose = poser?.update(dt, t, mood, lookTarget, react, camera.position, live);
      const tilt = (pose?.tilt ?? 0) + react.headRoll + live.headRoll;

      // Голова поворачивается за линзой, шея берёт на себя треть.
      // Корпус в позе может быть развёрнут — голова это компенсирует.
      const bodyTurn = (pose?.turn ?? 0) * 0.9;
      const bodyLean = (pose?.lean ?? 0) * 0.8;
      const hy = yaw.v - bodyTurn + react.headYaw + live.headYaw;
      const hp = pitch.v - bodyLean + react.headPitch + live.headPitch;
      if (neck) neck.rotation.set(flip * hp * 0.35, hy * 0.35, flip * tilt * 0.4);
      if (head) head.rotation.set(flip * hp * 0.65, hy * 0.65, flip * (tilt * 0.6 - hy * 0.08));
      if (vrm.lookAt) {
        // lookAt() считает угол до цели относительно головы. В модели этот угол
        // ослаблен: 90° на входе дают всего 8–12° поворота зрачка, поэтому усиливаем.
        vrm.lookAt.lookAt(lookTarget);
        // Поверх усиления — микросаккады: зрачок мелко перескакивает около цели.
        vrm.lookAt.yaw = THREE.MathUtils.clamp(vrm.lookAt.yaw * EYE_GAIN + live.eyeYaw, -90, 90);
        vrm.lookAt.pitch = THREE.MathUtils.clamp(vrm.lookAt.pitch * EYE_GAIN + live.eyePitch, -90, 90);
      }

      const face = pose?.face ?? { relaxed: 0.3, happy: 0, surprised: 0, wink: 0 };
      const em = vrm.expressionManager;
      if (em) {
        // Лицо в три слоя: поза главы, поверх неё мелкая жизнь (зевок, скука, привет),
        // поверх всего — реакция на клик. Верхний слой глушит нижние.
        const base = 1 - live.calm;
        const own = 1 - react.calm;
        const surprised = Math.max(clamp01(face.surprised + live.surprised) * own, react.surprised);
        // От удивления глаза не моргают; подмигивание занимает один глаз целиком.
        const calm = 1 - surprised;
        const wink = face.wink * base * own;
        // Моргание и веки, прикрытые надолго (скука, зевок); под реакцией на клик веки её.
        const lids = Math.max(live.blink, clamp01(live.lids) * own);
        em.setValue('blink', Math.max(lids * calm * (1 - wink), react.blink));
        em.setValue('blinkRight', wink * calm * (1 - react.blink));
        em.setValue('relaxed', Math.min(1, clamp01(face.relaxed * base + live.relaxed) * own + react.relaxed) * calm);
        em.setValue('happy', Math.min(1, clamp01(face.happy * base + live.happy) * own + react.happy) * calm);
        em.setValue('angry', Math.min(1, live.angry * own + react.angry) * calm);
        em.setValue('sad', clamp01(live.sad) * own * calm);
        em.setValue('aa', clamp01(live.mouth) * own);
        em.setValue('Surprised', surprised);
      }

      // Ветер и рывки локонов — это настройки пружинных костей, их надо выставить до шага.
      wind?.kick(0, react.kick[0] > 0);
      wind?.kick(1, react.kick[1] > 0);
      wind?.update(dt, t, { ndcX: look.ndcX, ndcY: look.ndcY, head: zones.face.pos, hips: hipsPos, still }, camera);

      // Пружинные кости волос и юбки считаются здесь. Их шаг не длиннее 1/45 с: при
      // редких кадрах (dt до 0.05) один длинный шаг делает пряди дёргаными, а под
      // ветром — ещё и нервными. При 60 кадрах в секунду шаг один, как и раньше.
      const substeps = Math.max(1, Math.ceil(dt * 45 - 1e-3));
      for (let i = 0; i < substeps; i++) vrm.update(dt / substeps);
      locate(); // зоны и центр лица — по уже обновлённым костям

      if (live.knock) actor.onKnock?.(zones.handR.pos);
    },
  };
  return actor;
}

class Ringlet extends THREE.Curve<THREE.Vector3> {
  constructor() {
    super();
  }

  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const a = t * Math.PI * 2 * 4.2;
    const r = 0.085 * (1 - t * 0.8);
    return target.set(Math.cos(a) * r, -t * 0.34, Math.sin(a) * r);
  }
}

// Манекен без лица: силуэт с двумя «свёрлами», чтобы было видно, как шкуры
// ведут себя на голове, волосах и ткани, пока нет настоящей модели.
function buildStandIn(): Actor {
  const mat = (hex: string, roughness = 0.8) =>
    new THREE.MeshStandardNodeMaterial({ color: hex, roughness, metalness: 0 });
  const skin = mat('#f1d5c4');
  const hair = mat('#e0526e', 0.6);
  const cloth = mat('#5a5e68');
  const trim = mat('#c4283f');

  const root = new THREE.Group();

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.3, 8, 24), cloth);
  torso.position.y = 1.08;
  torso.scale.set(1, 1, 0.72);
  root.add(torso);

  const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.28, 8, 16), cloth);
  shoulders.rotation.z = Math.PI / 2;
  shoulders.position.y = 1.27;
  root.add(shoulders);

  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.42, 6, 12), cloth);
    arm.position.set(side * 0.215, 1.02, 0);
    arm.rotation.z = side * 0.07;
    root.add(arm);
  }

  const tie = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.2, 4), trim);
  tie.position.set(0, 1.17, 0.108);
  tie.rotation.x = Math.PI;
  root.add(tie);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.1, 16), skin);
  neck.position.y = 1.36;
  root.add(neck);

  const head = new THREE.Group();
  head.position.y = 1.47;
  root.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 40, 28), skin);
  skull.scale.set(0.95, 1.05, 0.98);
  head.add(skull);

  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.124, 40, 28, 0, Math.PI * 2, 0, Math.PI * 0.6),
    hair,
  );
  cap.rotation.x = -0.42;
  cap.position.y = 0.006;
  head.add(cap);

  const ahoge = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.1, 8), hair);
  ahoge.position.set(0.01, 0.15, 0.02);
  ahoge.rotation.z = -0.5;
  head.add(ahoge);

  const ringletGeo = new THREE.TubeGeometry(new Ringlet(), 180, 0.036, 10, false);
  const ringlets = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.165, 0.03, -0.02);
    pivot.rotation.z = side * 0.22;
    const mesh = new THREE.Mesh(ringletGeo, hair);
    if (side < 0) mesh.scale.x = -1; // зеркальная закрутка
    pivot.add(mesh);
    head.add(pivot);
    return { pivot, side, lag: 0 };
  });

  const yaw = { v: 0 };
  const pitch = { v: 0 };

  return {
    kind: 'stand-in',
    root,
    headY: 1.47,
    face: new THREE.Vector3(0, 1.47, 0.08),
    cheeks: [new THREE.Vector3(0.045, 1.44, 0.1), new THREE.Vector3(-0.045, 1.44, 0.1)],
    points: {
      face: new THREE.Vector3(0, 1.47, 0.08),
      top: new THREE.Vector3(0, 1.6, 0),
      drillL: new THREE.Vector3(0.18, 1.45, -0.02),
      drillR: new THREE.Vector3(-0.18, 1.45, -0.02),
      body: new THREE.Vector3(0, 1.1, 0.1),
      handL: new THREE.Vector3(0.22, 0.8, 0),
      handR: new THREE.Vector3(-0.22, 0.8, 0),
      armL: new THREE.Vector3(0.2, 1.25, 0),
      armR: new THREE.Vector3(-0.2, 1.25, 0),
    },
    update(dt, t, look) {
      const k = 1 - Math.exp(-dt * 6);
      const prevYaw = yaw.v;
      yaw.v += (look.x * 0.5 - yaw.v) * k;
      pitch.v += (-look.y * 0.25 - pitch.v) * k;
      head.rotation.set(pitch.v, yaw.v, yaw.v * -0.1);

      const breath = Math.sin(t * 1.4);
      torso.scale.z = 0.72 + breath * 0.012;
      shoulders.position.y = 1.27 + breath * 0.003;

      // Локоны запаздывают за поворотом головы и слегка покачиваются.
      const turn = (yaw.v - prevYaw) / Math.max(dt, 1e-3);
      for (const r of ringlets) {
        r.lag += (-turn * 0.08 - r.lag) * (1 - Math.exp(-dt * 4));
        r.pivot.rotation.z = r.side * 0.22 + Math.sin(t * 1.1 + r.side) * 0.03 + r.lag * 0.4;
        r.pivot.rotation.x = Math.sin(t * 0.9 + r.side * 2) * 0.03 - pitch.v * 0.3;
      }
    },
  };
}
