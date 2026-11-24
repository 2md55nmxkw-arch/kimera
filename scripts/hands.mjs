// Две руки для заключительной секции: public/reach/left.webp и right.webp.
//
//   node scripts/hands.mjs [--size=1600x1000] [--preview]
//
// Руки — самой Тето: модель ставится в позу «руки в стороны», камера подходит к
// кисти, всё остальное со сцены убирается, и кадр снимается дважды — цвет и слой
// меток. По меткам строится прозрачность: остаётся только рука на пустом фоне.
// Снимается вдвое крупнее и уменьшается — так край получается сглаженным.
// --preview кладёт рядом shots/reach.png: обе руки на тёмном фоне, как в секции.
// Переснимать после смены модели или её материалов.
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const [W, H] = (args.find((a) => a.startsWith('--size='))?.slice(7) ?? '1600x1000').split('x').map(Number);
const chrome = [process.env.CHROME, '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => existsSync(p));
if (!chrome) throw new Error('не нашёл Chrome; укажи путь в переменной CHROME');

const server = await createServer({ root, logLevel: 'error', server: { port: 5499, strictPort: false } });
await server.listen();
const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl-egl'],
});
let shots;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.log(`[hands] ошибка страницы: ${e.message}`));
  await page.goto(`http://localhost:${server.httpServer.address().port}/?freeze=02-default-clear&webgl&q=low`);
  await page.waitForFunction('window.__frozen === true', null, { timeout: 60_000 });

  shots = await page.evaluate(
    async ({ W, H }) => {
      const { scene, camera, actor, u, rig, THREE } = window.__kimera;
      const vrm = actor.debug.vrm;
      const flip = vrm.meta?.metaVersion === '0' ? -1 : 1;
      const bone = (name) => vrm.humanoid.getNormalizedBoneNode(name);

      // На сцене остаётся только персонаж.
      const kept = new Set();
      actor.root.traverse((o) => kept.add(o));
      scene.traverse((o) => {
        if (o.isMesh && !kept.has(o)) o.visible = false;
      });

      /** Поставить руку: всё выпрямлено в стороны, кисть и пальцы — по описанию. */
      const pose = (side, hand) => {
        const p = side === 1 ? 'left' : 'right';
        for (const name of ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', `${p}Shoulder`, `${p}UpperArm`, `${p}LowerArm`]) {
          bone(name)?.rotation.set(0, 0, 0);
        }
        bone(`${p}UpperArm`)?.rotation.set(0, 0, hand.raise * side * flip);
        bone(`${p}LowerArm`)?.rotation.set(hand.twist * flip, 0, 0);
        bone(`${p}Hand`)?.rotation.set(0, hand.sway * side, hand.drop * side * flip);
        const fingers = ['Index', 'Middle', 'Ring', 'Little'];
        fingers.forEach((f, i) => {
          const k = hand.curl[i];
          bone(`${p}${f}Proximal`)?.rotation.set(0, hand.spread * (1.5 - i) * 0.5 * side, -k * 1.25 * side * flip);
          bone(`${p}${f}Intermediate`)?.rotation.set(0, 0, -k * 1.55 * side * flip);
          bone(`${p}${f}Distal`)?.rotation.set(0, 0, -k * 0.95 * side * flip);
        });
        const t = hand.thumb;
        bone(`${p}ThumbMetacarpal`)?.rotation.set((0.16 + t * 0.45) * flip, (0.3 + t * 0.27) * side, 0);
        bone(`${p}ThumbProximal`)?.rotation.set(0, (0.1 + t * 0.5) * side, 0);
        bone(`${p}ThumbDistal`)?.rotation.set(0, (0.05 + t * 0.6) * side, 0);
        vrm.update(0);
        vrm.scene.updateMatrixWorld(true);
      };

      const grab = () => {
        const out = document.createElement('canvas');
        out.width = W;
        out.height = H;
        const ctx = out.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(rig.canvas, 0, 0, W, H);
        return ctx;
      };

      const shoot = async (side, hand) => {
        pose(side, hand);
        const p = side === 1 ? 'left' : 'right';
        const wrist = vrm.humanoid.getRawBoneNode(`${p}Hand`).getWorldPosition(new THREE.Vector3());
        const elbow = vrm.humanoid.getRawBoneNode(`${p}LowerArm`).getWorldPosition(new THREE.Vector3());
        // В кадре — от локтя до кончиков пальцев; рука входит со своего края.
        const along = wrist.clone().sub(elbow).normalize();
        const centre = wrist.clone().addScaledVector(along, 0.05);
        centre.y -= 0.02;
        rig.resizeTo(W * 2, H * 2, 1);
        camera.clearViewOffset();
        camera.aspect = W / H;
        camera.updateProjectionMatrix();
        camera.position.set(centre.x, centre.y + 0.02, centre.z + 0.41);
        camera.lookAt(centre);
        camera.updateMatrixWorld();

        u.raw.value = 1;
        rig.render();
        const colour = grab();
        u.raw.value = 2;
        rig.render();
        const marks = grab().getImageData(0, 0, W, H).data;

        const image = colour.getImageData(0, 0, W, H);
        const d = image.data;
        for (let i = 0; i < d.length; i += 4) {
          // Слой меток чёрный там, где ничего нет.
          const here = Math.max(marks[i], marks[i + 1], marks[i + 2]);
          d[i + 3] = Math.min(255, here * 6);
        }
        colour.putImageData(image, 0, 0);
        const blob = await new Promise((resolve) => colour.canvas.toBlob(resolve, 'image/webp', 0.9));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let text = '';
        for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(text);
      };

      return {
        // Левая: кисть расслаблена и чуть опущена, пальцы свисают.
        left: await shoot(1, { raise: 0.06, twist: 0.25, drop: 0.38, sway: 0.0, curl: [0.1, 0.3, 0.42, 0.5], spread: 0.06, thumb: 0.25 }),
        // Правая: тянется указательным, остальные подобраны.
        right: await shoot(-1, { raise: -0.04, twist: 0.1, drop: 0.12, sway: 0.0, curl: [0.03, 0.42, 0.55, 0.62], spread: 0.04, thumb: 0.45 }),
      };
    },
    { W, H },
  );

  const dir = path.join(root, 'public', 'reach');
  await mkdir(dir, { recursive: true });
  for (const [name, base64] of Object.entries(shots)) {
    const bytes = Buffer.from(base64, 'base64');
    await writeFile(path.join(dir, `${name}.webp`), bytes);
    console.log(`[hands] public/reach/${name}.webp  ${W}×${H}  ${Math.round(bytes.length / 1024)} КБ`);
  }

  if (args.includes('--preview')) {
    // Обе руки на тёмном фоне — посмотреть, как они сойдутся в секции.
    await page.setViewportSize({ width: 1400, height: 620 });
    await page.setContent(`<body style="margin:0;background:#0a0a0b;height:100vh;position:relative;overflow:hidden">
      <img src="data:image/webp;base64,${shots.left}" style="position:absolute;left:-4%;top:14%;width:50%;filter:grayscale(1) brightness(1.2)">
      <img src="data:image/webp;base64,${shots.right}" style="position:absolute;right:-4%;top:8%;width:50%;filter:grayscale(1) brightness(1.2)">
    </body>`);
    await page.waitForTimeout(300);
    await mkdir(path.join(root, 'shots'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'shots', 'reach.png') });
    console.log('[hands] shots/reach.png');
  }
} finally {
  await browser.close();
  await server.close();
}
