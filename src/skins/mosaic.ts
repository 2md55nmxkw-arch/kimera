// 02 · MOSAIC
// Витраж в два масштаба. Фигура набрана мелкими осколками, чтобы читались лицо
// и руки; стекло за ней — крупными, и раскрашено как готическая роза вокруг
// головы: кольца и лепестки. Осколок берёт один цвет из точки под своим центром.
// У каждого свой наклон, и те, что повёрнуты к курсору, ловят блик.
import {
  atan,
  dot,
  float,
  floor,
  fract,
  length,
  luminance,
  max,
  mix,
  mod,
  mx_noise_float,
  normalize,
  pow,
  saturate,
  sin,
  smoothstep,
  step,
  vec2,
  vec3,
} from 'three/tsl';
import { hash22, paint, pick, srgb, toLinear, type N, type SkinContext } from './context';

// Стёкла витражной розы.
const JEWELS = ['#b01e3c', '#1d409c', '#0f7a5c', '#e09a22', '#5a3192', '#14808c'];

export function mosaicSkin(c: SkinContext): N {
  const { u, uv, css, asp, toUV, colorTex, viewDist, isFg, edgeAt } = c;

  const voronoi = (tile: number, salt: number) => {
    const g: N = css.div(tile);
    const gi: N = floor(g);
    const gf: N = fract(g);
    let near: N = float(8); // до ближайшего центра
    let next: N = float(8); // до второго по близости
    let p1: N = vec2(0);
    let p2: N = vec2(0);
    let h1: N = vec2(0);
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const h: N = hash22(gi.add(vec2(i + salt, j + salt)));
        // Центры медленно дышат.
        const pt: N = vec2(i, j).add(sin(h.mul(6.2832).add(u.clock.mul(0.45))).mul(0.3).add(0.5));
        const dd: N = length(pt.sub(gf));
        const closer: N = step(dd, near);
        const second: N = step(dd, next).mul(float(1).sub(closer));
        p2 = mix(mix(p2, gi.add(pt), second), p1, closer).toVar();
        next = mix(mix(next, dd, second), near, closer).toVar();
        p1 = mix(p1, gi.add(pt), closer).toVar();
        h1 = mix(h1, h, closer).toVar();
        near = mix(near, dd, closer).toVar();
      }
    }
    return { near, gap: next.sub(near), at: toUV(p1.mul(tile)), beside: toUV(p2.mul(tile)), hash: h1 };
  };
  const fine = voronoi(12, 0);
  const coarse = voronoi(34, 7.5);
  const onFigure: N = isFg(viewDist(fine.at)).toVar(); // этот мелкий осколок лежит на фигуре
  const besideFigure: N = isFg(viewDist(fine.beside)); // соседний мелкий — на фигуре

  // Стекло фигуры: цвет модели, насыщеннее и в несколько ступеней.
  const fc: N = srgb(colorTex.sample(fine.at).rgb);
  const vivid: N = mix(vec3(luminance(fc)), fc, 1.45);
  const figureGlass: N = floor(saturate(vivid).mul(6.0).add(0.5))
    .div(6.0)
    .mul(fine.hash.x.mul(0.2).add(0.9));

  // Стекло розы: кольца шириной в голову, двенадцать лепестков, шесть цветов по кругу.
  const rel: N = coarse.at.sub(u.head).mul(asp);
  const ring: N = floor(length(rel).div(u.headSize.mul(1.05)));
  const petal: N = floor(atan(rel.y, rel.x).div(6.2832 / 12).add(ring.mul(0.5)));
  const jewelIndex: N = mod(ring.mul(2.0).add(petal), 6.0);
  let jewel: N = vec3(0);
  JEWELS.forEach((hex, i) => {
    jewel = jewel.add(paint(hex).mul(pick(jewelIndex, i)));
  });
  // Второе кольцо — золотой нимб; чем дальше от головы, тем темнее стекло.
  jewel = mix(jewel, paint('#f2b53a'), pick(ring, 1).mul(0.8));
  const flicker: N = sin(u.clock.mul(0.7).add(coarse.hash.x.mul(6.2832))).mul(0.07).add(1.0);
  const roseGlass: N = jewel
    .mul(mix(1.2, 0.42, smoothstep(0.0, 6.5, length(rel).div(u.headSize))))
    .mul(coarse.hash.y.mul(0.3).add(0.85))
    .mul(flicker);

  const near: N = mix(coarse.near, fine.near, onFigure);
  const shardAt: N = mix(coarse.at, fine.at, onFigure);
  const shardHash: N = mix(coarse.hash, fine.hash, onFigure);
  // Свинцовая оправа: границы своих осколков, а у фона ещё и кромка вдоль фигуры.
  const leadFine: N = float(1).sub(smoothstep(0.05, 0.13, fine.gap));
  const leadCoarse: N = float(1).sub(smoothstep(0.022, 0.055, coarse.gap));
  const lead: N = max(
    mix(leadCoarse, leadFine, onFigure),
    leadFine.mul(besideFigure).mul(float(1).sub(onFigure)),
  );
  // Блик: курсор — источник света, осколок блестит, если его нормаль смотрит между светом и зрителем.
  const tilt: N = normalize(vec3(shardHash.sub(0.5).mul(0.95), 1.0));
  const toLight: N = u.pointer.sub(shardAt).mul(asp);
  const halfway: N = normalize(normalize(vec3(toLight.mul(2.4), 0.55)).add(vec3(0, 0, 1)));
  const glint: N = pow(saturate(dot(tilt, halfway)), 56.0).mul(
    float(1).sub(smoothstep(0.12, 0.75, length(toLight))),
  );
  // Стекло светлее к середине осколка, по нему идут лёгкие разводы.
  const streaks: N = mx_noise_float(vec3(css.x.mul(0.05), css.y.mul(0.5), 2.0)).mul(0.035);
  // Роспись по стеклу: черты лица, пряди и складки прорисованы тёмной краской
  // поверх осколков, как лица на настоящих витражах. Без неё фигура — просто пятна.
  const painted: N = float(1).sub(edgeAt(uv, 1.6).mul(onFigure).mul(0.8));
  const glass: N = mix(roseGlass, figureGlass, onFigure)
    .mul(float(1.13).sub(near.mul(0.42)).add(streaks))
    .mul(painted);
  return mix(toLinear(glass).add(glint.mul(0.95)), toLinear(paint('#100e16')), lead);
}
