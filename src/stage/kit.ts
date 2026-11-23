// Из чего собираются декорации: размеры круга, материалы и «система координат стены».
//
// Круг стоит позади персонажа и разделён на три клина по 120° стенами, идущими от
// центра к краю, — как настоящий театральный поворотный круг. Зритель видит один
// клин: две стены сходятся углом за спиной актрисы, как раскрытая книга.
//
// Декорация описывает свой клин в «активном» положении (он повёрнут к залу):
//   · начало координат — центр круга, +Z смотрит в зал;
//   · левая и правая стены задаются каждая в своих плоских координатах:
//     x — вдоль стены слева направо, как на экране (0…RADIUS), y — вверх (0…HEIGHT),
//     z — от стены в комнату.
//
// Что видно в обычном кадре (камера в двух метрах, кадр узкий):
//   левая стена  — почти вся, x от 0.1 до 1.25, y от 0.5 до 2.15; её нижняя половина
//                  лежит под заголовком и текстом главы, поэтому главное вешают
//                  выше y = 1.55, а ниже держат спокойный тон;
//   правая стена — полоса x от 0.65 до 1.25 (остальное закрыто фигурой или за кадром).
// Пол в обычном кадре не виден вовсе; он нужен для общего плана в финале.
import * as THREE from 'three/webgpu';
import { ID, allocateId, tag } from '../core/gbuffer';
import type { Geo } from '../model/geo';

/** Радиус круга и длина стены, метры. */
export const RADIUS = 1.9;
/** Высота стен. */
export const HEIGHT = 2.8;
/** Центр круга: позади персонажа, край проходит в 40 см за её спиной. */
export const CENTRE_Z = -2.3;
/** Толщина половины стены (вторая половина принадлежит соседнему клину). */
export const WALL = 0.04;

// Четыре ступени света: тот же «рисованный» характер, что у материала персонажа.
const ramp = new THREE.DataTexture(new Uint8Array([105, 170, 225, 255]), 4, 1, THREE.RedFormat);
ramp.minFilter = THREE.NearestFilter;
ramp.magFilter = THREE.NearestFilter;
ramp.needsUpdate = true;

/** Матовая краска. Цвет берётся из оттенка вершин (Geo.tint). */
const paint = new THREE.MeshToonNodeMaterial({ vertexColors: true, gradientMap: ramp });
const glows = new Map<string, THREE.Material>();

export interface PartOptions {
  /** Светится сам (лампочка, пламя): цвет #rrggbb. */
  glow?: string;
  /** Архитектура (стены, пол) — в мозаике на её месте стекло розы. По умолчанию предмет. */
  set?: boolean;
  /** Не отбрасывает тень (мелочь, стекло). */
  noShadow?: boolean;
}

/** Деталь из заготовки: готовый Mesh с материалом, тенями и меткой для G-буфера. */
export function part(geo: Geo, opts: PartOptions = {}): THREE.Mesh {
  let material: THREE.Material = paint;
  if (opts.glow) {
    material = glows.get(opts.glow) ?? new THREE.MeshBasicNodeMaterial({ color: opts.glow });
    glows.set(opts.glow, material);
  }
  const mesh = new THREE.Mesh(geo.toGeometry(), material);
  mesh.castShadow = !opts.glow && !opts.noShadow;
  mesh.receiveShadow = !opts.glow;
  tag(mesh, opts.set ? ID.set : allocateId());
  return mesh;
}

const SIN = Math.sin(Math.PI / 3);
const COS = Math.cos(Math.PI / 3);

export type Side = 'left' | 'right';

/**
 * Группа в координатах стены (см. шапку файла). Всё, что в неё добавлено, окажется
 * на стене: x вдоль неё слева направо, y вверх, z в комнату.
 */
export function wall(side: Side): THREE.Group {
  const g = new THREE.Group();
  if (side === 'left') {
    // Левая стена идёт от края круга к углу: её начало — на краю.
    g.position.set(-SIN * RADIUS, 0, COS * RADIUS);
    g.rotation.y = Math.PI / 6;
  } else {
    g.rotation.y = -Math.PI / 6;
  }
  // Стена делит круг пополам с соседним клином: своя половина толщины — со своей
  // стороны, поэтому плоскость стены сдвинута в комнату.
  g.position.x += (side === 'left' ? COS : -COS) * WALL;
  g.position.z += SIN * WALL;
  return g;
}

/** Декорация одного клина. */
export interface StageSet {
  name: string;
  /** Цвет пола клина. */
  floor: string;
  /** Наполнить стены. Группы уже стоят на месте, координаты — стенные. */
  build(left: THREE.Group, right: THREE.Group): void;
}
