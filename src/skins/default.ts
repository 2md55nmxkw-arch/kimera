// 01 · DEFAULT
// Модель как есть. Вся работа здесь — подать её чисто: мягкий студийный фон
// со светом за головой, падающая тень на фоне, затенение в складках и ручное
// сглаживание контуров (сама сцена рендерится без него).
import { exp, float, floor, length, mix, saturate, smoothstep, vec2, vec3 } from 'three/tsl';
import { hash21, paint, toLinear, type N, type SkinContext } from './context';

export function defaultSkin(c: SkinContext): N {
  const { uv, css, pxUV, colorAt, viewDist, isFg, cross, diag, edgeAt, lin, dist, fg, heads } = c;
  const edge: N = edgeAt(uv, 1.25);

  let blurred: N = vec3(0);
  let cover: N = fg;
  for (const t of diag(pxUV.mul(0.75))) {
    blurred = blurred.add(colorAt(uv.add(t)).rgb);
    cover = cover.add(isFg(viewDist(uv.add(t))));
  }
  cover = cover.div(5.0);

  // Затенение: насколько соседи вокруг ближе к камере, чем эта точка.
  let occluded: N = float(0);
  for (const t of diag(pxUV.mul(7.0))) {
    const gap: N = dist.sub(viewDist(uv.add(t)));
    occluded = occluded.add(smoothstep(0.004, 0.04, gap).mul(float(1).sub(smoothstep(0.08, 0.3, gap))));
  }
  const shade: N = float(1).sub(occluded.mul(0.085));

  // Тень фигуры на фоне: силуэт, сдвинутый вниз-вправо и размытый.
  const cast: N = vec2(-0.011, -0.014);
  let shadow: N = float(0);
  for (const t of cross(pxUV.mul(9.0))) shadow = shadow.add(isFg(viewDist(uv.add(cast).add(t))));
  shadow = shadow.add(isFg(viewDist(uv.add(cast)))).div(5.0);

  const light: N = exp(heads.mul(heads).mul(-0.11)); // пятно света за головой
  const wall: N = mix(paint('#aeb2c0'), paint('#f6f1e8'), saturate(light.mul(0.85).add(float(1).sub(uv.y).mul(0.3))));
  const backdrop: N = toLinear(
    wall
      .mul(float(1).sub(shadow.mul(0.16)))
      .mul(float(1).sub(length(uv.sub(0.5)).mul(0.25)))
      .add(hash21(floor(css)).sub(0.5).mul(0.012)),
  );
  const model: N = mix(lin, blurred.div(4.0), edge.mul(0.7)).mul(shade);
  return mix(backdrop, model, cover);
}
