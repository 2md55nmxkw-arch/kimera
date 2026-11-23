// G-буфер: сцена рендерится один раз, и о каждом пикселе известно четыре вещи.
//
//   output — цвет, как его дал материал;
//   normal — нормаль в пространстве камеры;
//   depth  — глубина;
//   id     — метки: что это за предмет и какая это часть тела.
//
// Слой id (половинная точность, значения хранятся как есть):
//   r — номер предмета: 0 — никто, ID.stage — старый реквизит, ID.actor — персонаж,
//       дальше свои номера у предметов декораций (allocateId);
//   g — «ярус» тела: 1 — голова, 0.5 — торс и руки, 0 — ноги и всё, что не тело;
//   b — рука: +1 — левая, −1 — правая, 0 — не рука.
// Ярус и рука заданы в вершинах и плавно меняются на стыках частей, поэтому по ним
// можно резать тело порогом (g > 0.75 — голова) и рисовать шов там, где порог пройден.
//
// Правило: всё, что попадает в сцену, проходит через tag(). Без метки у предмета
// не будет номера, а в консоли появится предупреждение о нехватке атрибута.
import * as THREE from 'three/webgpu';
import { attribute, mrt, normalView, output, pass, userData, vec4 } from 'three/tsl';

export const ID = { none: 0, stage: 1, actor: 2 } as const;

let nextId = 16;
/** Свободный номер для нового предмета. Номера до 2048 хранятся в буфере точно. */
export const allocateId = (): number => nextId++;

/** Имя вершинного атрибута с ярусом и рукой: vec2(ярус, рука). */
export const PART = 'part';

/**
 * Пометить предмет и всё, что в нём, номером id. У геометрии без разметки частей
 * тела атрибут заполняется нулями.
 */
export function tag(root: THREE.Object3D, id: number): void {
  root.traverse((o) => {
    o.userData.gid = id;
    const geometry = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (geometry?.isBufferGeometry && !geometry.getAttribute(PART)) {
      const count = geometry.getAttribute('position')?.count ?? 0;
      geometry.setAttribute(PART, new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    }
  });
}

/** Проход сцены со всеми слоями G-буфера. Слои берутся через getTextureNode(имя). */
export function createScenePass(scene: THREE.Scene, camera: THREE.Camera) {
  const scenePass = pass(scene, camera);
  scenePass.setMRT(
    mrt({
      output,
      normal: normalView,
      id: vec4(userData('gid', 'float'), attribute(PART, 'vec2'), 1),
    }),
  );
  return scenePass;
}
