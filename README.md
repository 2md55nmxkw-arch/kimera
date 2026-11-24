# KIMERA キメラ

One body, three skins — a browser art piece with Kasane Teto: the same 3-D figure shown
as it is, as stained glass and as a pencil sketch, on a small revolving theatre stage.
Put a record on and the stage turns into a show that follows the song.

Built with Vite, TypeScript, three.js (WebGPU with a WebGL 2 fallback) and three-vrm.

## Run it

```bash
npm install
npm run dev
```

## What is not in this repository

Two files are left out on purpose: their authors do not allow redistribution.

- **The character model.** rurune式重音テト, free VRM by rurune:
  <https://rurunerune.booth.pm/items/8000175>. Download it from the author and save it as
  `public/models/teto.vrm`. Without it the site shows a plain stand-in figure.
- **The Mesmerizer dance.** "Teto Mesmerizer Motion by sir vee" (MMD). With the author's
  `.vmd` at hand:

  ```bash
  node scripts/motion.mjs "<path to the Teto .vmd>" public/motions/mesmerizer.kmt --credit="Motion by sir vee"
  ```

  Without it Teto dances the site's own routine for that song.

## Credits

- 重音テト © 線/小山乃舞世/TWINDRILL. This is a non-commercial fan work.
- Model: rurune. Dance motion for Mesmerizer: sir vee.
- Songs are not hosted here: a record opens its author's official video in the YouTube
  player, and only after a click.

The roadmap and working notes are in `PLAN.md` (in Russian).
