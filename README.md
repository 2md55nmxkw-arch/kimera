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

## The model and the dance are not yours to take from here

Two files belong to other authors, who do not allow redistribution:

- **The character model.** rurune式重音テト, free VRM by rurune:
  <https://rurunerune.booth.pm/items/8000175>.
- **The Mesmerizer dance.** "Teto Mesmerizer Motion by sir vee" (MMD).

They are kept in `sealed/` encrypted, only so that this site's own build can use them;
the key is not in the repository, and the published site carries the model embedded in
its own format, not as a `.vrm` file. If you want them, get them from their authors.

To run the site with them locally, save the model as `public/models/teto.vrm` and convert
the dance:

```bash
node scripts/motion.mjs "<path to the Teto .vmd>" public/motions/mesmerizer.kmt --credit="Motion by sir vee"
```

Without the model the site shows a plain stand-in figure; without the dance Teto dances
the site's own routine for that song.

## Credits

- 重音テト © 線/小山乃舞世/TWINDRILL. This is a non-commercial fan work.
- Model: rurune. Dance motion for Mesmerizer: sir vee.
- Songs are not hosted here: a record opens its author's official video in the YouTube
  player, and only after a click.

The roadmap and working notes are in `PLAN.md` (in Russian).
