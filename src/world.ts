import { Vector3 } from 'three';

// One unit remains the planet radius. Shared bounds keep framing and shells aligned.
export const WORLD = {
  radius: 1,
  cloudRadius: 1.18,
  atmosphereRadius: 1.18 * 1.025,
  minimumCameraDistance: 1.5,
} as const;

interface WorldRegion {
  name: string;
  direction: Vector3;
  angularRadius: number; // Radians along the sphere, not a world-space disk.
  maxSlopeDegrees: number; // Placement guidance; still raycast the final geometry.
  leveling: number; // Blend gentle terrain toward a common meadow elevation.
}

function region(name: string, xyz: [number, number, number], radius: number,
  maxSlopeDegrees: number, leveling: number): WorldRegion {
  return { name, direction: new Vector3(...xyz).normalize(), angularRadius: radius, maxSlopeDegrees, leveling };
}

// Layout anchors only: no objects, runtime generation, UI or extra render calls.
export const WORLD_REGIONS = {
  residential: region('Жилая поляна', [-0.55, 0.05, 0.83], 0.32, 10, 0.85),
  forest: region('Лесной сектор', [0.82, 0.4, -0.4], 0.40, 20, 0.35),
  specialTree: region('Поляна особенного дерева', [-0.4, 0.35, -0.85], 0.27, 10, 0.8),
  lake: region('Озёрная территория', [0.56, -0.16, 0.81], 0.43, 15, 0),
  mountains: region('Невысокий горный регион', [-0.12, 0.9, 0.42], 0.48, 30, 0),
  flowers: region('Цветочная долина', [-0.25, -0.78, 0.57], 0.30, 12, 0.7),
  secret: region('Тайная романтическая поляна', [-0.82, -0.4, -0.4], 0.25, 10, 0.85),
  nature: region('Природный резерв', [0.35, -0.65, -0.68], 0.38, 20, 0.3),
} as const;

// Reference heights for FUTURE content; nothing is instantiated from these values.
export const FUTURE_OBJECT_HEIGHTS = {
  house: [0.06, 0.085], tree: [0.07, 0.11], specialTree: 0.14,
} as const;
