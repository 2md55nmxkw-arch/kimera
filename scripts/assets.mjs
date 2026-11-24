// Чужие файлы сайта: модель персонажа и танец из файла.
//
// Их авторы запрещают раздавать файлы, поэтому в репозитории нет ни .vrm, ни дорожки.
// Но сайту, который собирается на GitHub, они нужны. Решение в два слоя:
//
//  · в репозитории файлы лежат запечатанными (sealed/*.enc, AES-256-GCM). Ключ есть
//    только у автора сайта (файл .assets-key, в git не попадает) и в секретах
//    репозитория (ASSETS_KEY). Из репозитория файлы достать нельзя;
//  · при сборке сайта файлы распечатываются, и модель кладётся не как .vrm, а вшитой
//    (.kmd, читает src/actor/packed.ts): готового файла модели на сайте нет.
//
//   node scripts/assets.mjs key      — завести ключ (.assets-key), если его ещё нет
//   node scripts/assets.mjs lock     — запечатать свои файлы в sealed/ (перед коммитом)
//   node scripts/assets.mjs unlock   — распечатать для сборки (это делает workflow)
//   node scripts/assets.mjs pack     — только вшить свою модель: проверить сборку у себя
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const at = (...parts) => path.join(root, ...parts);
const KEY_FILE = at('.assets-key');
const MODEL = at('public/models/teto.vrm');
const PACKED = at('public/models/teto.kmd');
const MOTION = at('public/motions/mesmerizer.kmt');
/** Что запечатываем: [свой файл, запечатанный]. */
const SEALED = [
  [MODEL, at('sealed/teto.vrm.enc')],
  [MOTION, at('sealed/mesmerizer.kmt.enc')],
];

function readKey() {
  const hex = (process.env.ASSETS_KEY ?? (fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, 'utf8') : '')).trim();
  return /^[0-9a-f]{64}$/i.test(hex) ? Buffer.from(hex, 'hex') : null;
}

/** «KSEA», вектор (12 байт), метка подлинности (16 байт), шифртекст. */
function seal(plain, key) {
  // Вектор считается из самого файла: тот же файл запечатывается в те же байты,
  // и повторная запечатка не раздувает репозиторий.
  const iv = crypto.createHmac('sha256', key).update(plain).digest().subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from('KSEA'), iv, cipher.getAuthTag(), body]);
}

function unseal(sealed, key) {
  if (sealed.subarray(0, 4).toString() !== 'KSEA') throw new Error('это не запечатанный файл');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, sealed.subarray(4, 16));
  decipher.setAuthTag(sealed.subarray(16, 32));
  return Buffer.concat([decipher.update(sealed.subarray(32)), decipher.final()]);
}

/** Вшить модель: тот же вид файла, что читает src/actor/packed.ts. */
function pack(plain) {
  const padded = Math.ceil(plain.length / 4) * 4;
  const out = new Uint8Array(8 + padded);
  const head = new DataView(out.buffer);
  head.setUint32(0, 0x4c444d4b, true); // «KMDL»
  head.setUint32(4, plain.length, true);
  out.set(plain, 8);
  const words = new Uint32Array(out.buffer, 8, padded / 4);
  let x = 0x6b1d3a57 ^ plain.length || 1;
  for (let i = 0; i < words.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    words[i] ^= x;
  }
  return out;
}

const write = (file, bytes) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  console.log(`[assets] ${path.relative(root, file)} — ${(bytes.length / 1024 / 1024).toFixed(1)} МБ`);
};

const command = process.argv[2];
if (command === 'key') {
  if (fs.existsSync(KEY_FILE)) console.log('[assets] ключ уже есть: .assets-key');
  else {
    fs.writeFileSync(KEY_FILE, `${crypto.randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
    console.log('[assets] ключ создан: .assets-key (в git не попадает; его же надо положить в секрет ASSETS_KEY)');
  }
} else if (command === 'lock') {
  const key = readKey();
  if (!key) throw new Error('нет ключа: node scripts/assets.mjs key');
  for (const [mine, sealed] of SEALED) {
    if (fs.existsSync(mine)) write(sealed, seal(fs.readFileSync(mine), key));
    else console.log(`[assets] нет ${path.relative(root, mine)} — пропускаю`);
  }
} else if (command === 'unlock') {
  const key = readKey();
  if (!key) {
    // Чужая копия репозитория или сборка без секрета: сайт соберётся с заглушкой.
    console.log('[assets] ключа нет — собираем без модели и без танца из файла');
    process.exit(0);
  }
  for (const [mine, sealed] of SEALED) {
    if (!fs.existsSync(sealed)) continue;
    const plain = unseal(fs.readFileSync(sealed), key);
    // Модель на сайт идёт только вшитой; сам .vrm при сборке на диск не пишется.
    if (mine === MODEL) write(PACKED, pack(plain));
    else write(mine, plain);
  }
} else if (command === 'pack') {
  write(PACKED, pack(fs.readFileSync(MODEL)));
} else {
  console.error('node scripts/assets.mjs key | lock | unlock | pack');
  process.exit(1);
}
