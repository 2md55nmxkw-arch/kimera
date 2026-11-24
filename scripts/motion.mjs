// Перевод танца из MMD (.vmd) в дорожку для нашей модели.
//
//   node scripts/motion.mjs "<файл.vmd>" public/motions/<имя>.kmt [--credit="Motion by …"] [--frames=720] [--arm=38]
//
// Зачем перевод, а не чтение .vmd в браузере: авторы движений обычно запрещают
// раздавать их файлы. На сайт попадает не .vmd, а дорожка под скелет VRM — повороты
// костей по кадрам, — и та в репозиторий не коммитится (см. .gitignore).
//
// Что происходит:
//  · MMD — левая система координат, персонаж смотрит на −Z; у нас правая и +Z.
//    Поэтому у сдвигов меняем знак Z, у поворотов — X и Y.
//  · Ключи .vmd соединены кривыми Безье — считаем их честно, иначе пропадут
//    остановки и рывки, из которых и состоит танец.
//  · Модели MMD стоят с опущенными руками (А-стойка), VRM — с разведёнными (Т).
//    Повороты рук и пальцев пересчитываются на эту разницу (угол --arm, градусы).
//  · Кости MMD, которых в VRM нет (скрутки руки, «плечо-родитель», «паз», «пояс»),
//    вливаются в соседние.
//  · Ноги в MMD ставятся по точкам для ступней. Их и пишем: колени на месте
//    посчитает наш решатель ног, под длину ног нашей модели.
import fs from 'node:fs';
import path from 'node:path';

import { Quaternion, Vector3 } from 'three';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const opt = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
if (files.length < 2) {
  console.error('node scripts/motion.mjs "<файл.vmd>" public/motions/<имя>.kmt [--credit=…] [--frames=N] [--arm=38]');
  process.exit(1);
}
const [source, target] = files;
const ARM = (Number(opt('arm', 38)) * Math.PI) / 180;
const FPS = 30;

// ── чтение .vmd ─────────────────────────────────────────────────────────

const buf = fs.readFileSync(source);
const sjis = new TextDecoder('shift_jis');
const text = (from, size) => {
  const end = buf.indexOf(0, from);
  return sjis.decode(buf.subarray(from, end >= from && end < from + size ? end : from + size));
};
if (!buf.subarray(0, 25).toString('latin1').startsWith('Vocaloid Motion Data 0002')) throw new Error('это не .vmd');

/** имя кости → ключи по возрастанию кадра */
const bones = new Map();
let at = 50;
const boneCount = buf.readUInt32LE(at);
at += 4;
for (let i = 0; i < boneCount; i++, at += 111) {
  const name = text(at, 15);
  const key = {
    frame: buf.readUInt32LE(at + 15),
    // Сразу в нашу систему координат.
    pos: new Vector3(buf.readFloatLE(at + 19), buf.readFloatLE(at + 23), -buf.readFloatLE(at + 27)),
    rot: new Quaternion(-buf.readFloatLE(at + 31), -buf.readFloatLE(at + 35), buf.readFloatLE(at + 39), buf.readFloatLE(at + 43)).normalize(),
    curve: buf.subarray(at + 47, at + 111),
  };
  if (!bones.has(name)) bones.set(name, []);
  bones.get(name).push(key);
}
for (const keys of bones.values()) keys.sort((a, b) => a.frame - b.frame);

const morphs = new Map();
const morphCount = buf.readUInt32LE(at);
at += 4;
for (let i = 0; i < morphCount; i++, at += 23) {
  const name = text(at, 15);
  if (!morphs.has(name)) morphs.set(name, []);
  morphs.get(name).push({ frame: buf.readUInt32LE(at + 15), weight: buf.readFloatLE(at + 19) });
}
for (const keys of morphs.values()) keys.sort((a, b) => a.frame - b.frame);

// ── значение кости на кадре ─────────────────────────────────────────────

/** Кривая Безье ключа: по доле времени — доля пути. Ось: 0 X, 1 Y, 2 Z, 3 поворот. */
function ease(curve, axis, t) {
  const x1 = curve[axis] / 127;
  const y1 = curve[axis + 4] / 127;
  const x2 = curve[axis + 8] / 127;
  const y2 = curve[axis + 12] / 127;
  if (x1 === y1 && x2 === y2) return t;
  let lo = 0;
  let hi = 1;
  let s = t;
  for (let i = 0; i < 24; i++) {
    s = (lo + hi) / 2;
    const x = 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
    if (x < t) lo = s;
    else hi = s;
  }
  return 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
}

const ONE = new Quaternion();
const ZERO = new Vector3();

function span(keys, frame) {
  let lo = 0;
  let hi = keys.length - 1;
  if (frame <= keys[0].frame) return [keys[0], keys[0], 0];
  if (frame >= keys[hi].frame) return [keys[hi], keys[hi], 0];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].frame <= frame) lo = mid;
    else hi = mid;
  }
  return [keys[lo], keys[hi], (frame - keys[lo].frame) / (keys[hi].frame - keys[lo].frame)];
}

const rot = (name, frame) => {
  const keys = bones.get(name);
  if (!keys) return ONE.clone();
  const [a, b, t] = span(keys, frame);
  return a.rot.clone().slerp(b.rot, ease(b.curve, 3, t));
};
const pos = (name, frame) => {
  const keys = bones.get(name);
  if (!keys) return ZERO.clone();
  const [a, b, t] = span(keys, frame);
  return new Vector3(
    a.pos.x + (b.pos.x - a.pos.x) * ease(b.curve, 0, t),
    a.pos.y + (b.pos.y - a.pos.y) * ease(b.curve, 1, t),
    a.pos.z + (b.pos.z - a.pos.z) * ease(b.curve, 2, t),
  );
};
const morph = (name, frame) => {
  const keys = morphs.get(name);
  if (!keys) return 0;
  if (frame <= keys[0].frame) return keys[0].weight;
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return last.weight;
  let i = 0;
  while (keys[i + 1].frame <= frame) i++;
  const a = keys[i];
  const b = keys[i + 1];
  return a.weight + ((b.weight - a.weight) * (frame - a.frame)) / (b.frame - a.frame);
};

// ── что пишем ───────────────────────────────────────────────────────────

const FINGERS = [
  ['Thumb', '親指', ['Metacarpal', 'Proximal', 'Distal'], ['０', '１', '２']],
  ['Index', '人指', ['Proximal', 'Intermediate', 'Distal'], ['１', '２', '３']],
  ['Middle', '中指', ['Proximal', 'Intermediate', 'Distal'], ['１', '２', '３']],
  ['Ring', '薬指', ['Proximal', 'Intermediate', 'Distal'], ['１', '２', '３']],
  ['Little', '小指', ['Proximal', 'Intermediate', 'Distal'], ['１', '２', '３']],
];
const SIDES = [
  ['left', '左', -1],
  ['right', '右', 1],
];

const quats = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'leftFootGoal', 'rightFootGoal'];
for (const [side] of SIDES) {
  quats.push(`${side}Shoulder`, `${side}UpperArm`, `${side}LowerArm`, `${side}Hand`);
  for (const [finger, , joints] of FINGERS) for (const joint of joints) quats.push(`${side}${finger}${joint}`);
}
const vecs = ['body', 'leftFootGoal', 'rightFootGoal'];

// Мимика MMD → выражения VRM: [выражение, [[морф, вес], …]].
const FACES = [
  ['blink', [['まばたき', 1], ['笑い', 1], ['はぅ', 1]]],
  ['blinkLeft', [['ウィンク', 1], ['ウィンク２', 1]]],
  ['blinkRight', [['ウィンク右', 1], ['ｳｨﾝｸ２右', 1]]],
  ['aa', [['あ', 1], ['あ２', 1], ['□', 0.5]]],
  ['ih', [['い', 1]]],
  ['oh', [['お', 1]]],
  ['ou', [['う', 1]]],
  ['happy', [['にっこり', 1], ['笑い', 0.5], ['ω', 0.3], ['にこり', 0.3]]],
  ['angry', [['怒り', 0.45]]],
  ['sad', [['困る', 0.4]]],
];

// Последний кадр, на котором что-то из нужного ещё движется.
const used = ['全ての親', 'センター', 'グルーブ', '腰', '下半身', '上半身', '上半身2', '首', '頭', '左腕', '右腕', '左ひじ', '右ひじ', '左手首', '右手首', '左足ＩＫ', '右足ＩＫ'];
const lastKey = Math.max(...used.map((name) => bones.get(name)?.at(-1)?.frame ?? 0));
const frames = Number(opt('frames', lastKey + 1));

const Q = new Int16Array(frames * quats.length * 4);
const V = new Float32Array(frames * vecs.length * 3);
const F = new Uint8Array(frames * FACES.length);

const inv = (q) => q.clone().invert();
const mul = (...qs) => qs.reduce((a, b) => a.clone().multiply(b));
/** Плечо в MMD задирается сильнее, чем это красиво на VRM: берём половину. */
const SHOULDER = 0.5;

for (let f = 0; f < frames; f++) {
  const out = {};
  const root = rot('全ての親', f);
  const centre = rot('センター', f);
  const groove = rot('グルーブ', f);
  const waist = rot('腰', f);
  const lower = rot('下半身', f);
  out.root = root;
  // Таз: всё, что выше него по цепочке, плюс «нижняя половина».
  out.hips = mul(root, centre, groove, waist, lower);
  // Верх тела в MMD растёт из «пояса», а не из таза: поворот таза из него вычитаем.
  out.spine = mul(inv(lower), rot('上半身', f));
  out.chest = rot('上半身2', f);
  out.neck = rot('首', f);
  out.head = rot('頭', f);

  for (const [side, jp, sign] of SIDES) {
    // Из Т-стойки в А-стойку: левая рука (+X) опускается поворотом вокруг Z на −угол.
    const A = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), sign * ARM);
    const Ai = inv(A);
    const shoulderP = rot(`${jp}肩P`, f);
    const shoulder = mul(shoulderP, rot(`${jp}肩`, f));
    // Куда рука смотрит относительно груди: «плечо-родитель» на руку не действует.
    const armRel = mul(shoulder, inv(shoulderP), rot(`${jp}腕`, f), rot(`${jp}腕捩`, f));
    const soft = ONE.clone().slerp(shoulder, SHOULDER);
    out[`${side}Shoulder`] = soft;
    out[`${side}UpperArm`] = mul(inv(soft), armRel, A);
    out[`${side}LowerArm`] = mul(Ai, rot(`${jp}ひじ`, f), rot(`${jp}手捩`, f), A);
    out[`${side}Hand`] = mul(Ai, rot(`${jp}手首`, f), A);
    for (const [finger, jpFinger, joints, digits] of FINGERS) {
      joints.forEach((joint, i) => {
        out[`${side}${finger}${joint}`] = mul(Ai, rot(`${jp}${jpFinger}${digits[i]}`, f), A);
      });
    }
    // Ступня: точка и поворот «кости для ступни» (без общего разворота — он в root).
    out[`${side}FootGoal`] = mul(rot(`${jp}足IK親`, f), rot(`${jp}足ＩＫ`, f));
  }

  quats.forEach((name, i) => {
    const q = out[name].normalize();
    const o = (f * quats.length + i) * 4;
    Q[o] = Math.round(q.x * 32767);
    Q[o + 1] = Math.round(q.y * 32767);
    Q[o + 2] = Math.round(q.z * 32767);
    Q[o + 3] = Math.round(q.w * 32767);
  });

  // Сдвиг тела: «центр» и «паз», в единицах MMD (около 8 см).
  const body = pos('センター', f).add(pos('グルーブ', f).applyQuaternion(centre)).add(pos('全ての親', f));
  const feet = SIDES.map(([, jp]) => pos(`${jp}足IK親`, f).add(pos(`${jp}足ＩＫ`, f).applyQuaternion(rot(`${jp}足IK親`, f))));
  [body, ...feet].forEach((v, i) => {
    const o = (f * vecs.length + i) * 3;
    V[o] = v.x;
    V[o + 1] = v.y;
    V[o + 2] = v.z;
  });

  FACES.forEach(([, mix], i) => {
    const w = mix.reduce((sum, [name, weight]) => sum + morph(name, f) * weight, 0);
    F[f * FACES.length + i] = Math.round(Math.min(1, Math.max(0, w)) * 255);
  });
}

// ── файл ────────────────────────────────────────────────────────────────

const head = Buffer.from(
  JSON.stringify({ fps: FPS, frames, quats, vecs, faces: FACES.map(([name]) => name), credit: opt('credit', '') }),
  'utf8',
);
const pad = (4 - ((8 + head.length) % 4)) % 4;
const start = Buffer.alloc(8);
start.write('KMTN', 0, 'latin1');
start.writeUInt32LE(head.length + pad, 4);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, Buffer.concat([start, head, Buffer.alloc(pad, 0x20), Buffer.from(Q.buffer), Buffer.from(V.buffer), Buffer.from(F.buffer)]));
console.log(
  `[motion] ${path.basename(source)} → ${target}: ${frames} кадров (${(frames / FPS).toFixed(1)} с), ` +
    `${quats.length} костей, ${(fs.statSync(target).size / 1024).toFixed(0)} КБ`,
);
