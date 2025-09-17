// /src/app/features/admin/views/world-editor/service/three-engine/utils/constants.ts

/** Prefijo para los nombres de objetos InstancedMesh que contienen cuerpos celestes. */
export const CELESTIAL_MESH_PREFIX = 'CelestialObjects_';

/**
 * Nombres de objetos que deben ser ignorados por interacciones como
 * raycasting para selección, hover o cálculo de la caja delimitadora de la escena.
 */
export const UNSELECTABLE_NAMES = [
  'Luz Ambiental',
  'EditorGrid',
  'SelectionProxy',
  'HoverProxy',
  'FocusPivot'
];

/** Factor de escala adicional aplicado a objetos muy lejanos para que sean visibles. */
export const DEEP_SPACE_SCALE_BOOST = 10.0;