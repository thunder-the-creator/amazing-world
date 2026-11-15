import { MathUtils, Vector3 } from 'three';
import { WORLD, WORLD_REGIONS } from './world';

const meadows = Object.values(WORLD_REGIONS).filter(region => region.leveling > 0).map(region => ({
  ...region, edge: Math.cos(region.angularRadius), core: Math.cos(region.angularRadius * 0.45),
}));

// All terrain definitions use planet-local coordinates, shared by rendering and planting.
function frame(center: Vector3) {
  center.normalize();
  const east = new Vector3(1, 0, 0).addScaledVector(center, -center.x).normalize();
  const north = new Vector3().crossVectors(center, east);
  return { center, east, north };
}

export const LAKE = { ...frame(WORLD_REGIONS.lake.direction.clone()), width: 0.32, height: 0.23, level: 0.99 };
export const MOUNTAINS = frame(WORLD_REGIONS.mountains.direction.clone());

export function lakeOutline(angle: number): number {
  return 1 + 0.12 * Math.sin(3 * angle + 0.4) + 0.065 * Math.cos(5 * angle) + 0.05 * Math.sin(2 * angle);
}

export function lakeMetric(direction: Vector3): number {
  const facing = direction.dot(LAKE.center);
  if (facing <= 0.5) return Infinity;
  const x = direction.dot(LAKE.east) / facing / LAKE.width;
  const y = direction.dot(LAKE.north) / facing / LAKE.height;
  return Math.hypot(x, y) / lakeOutline(Math.atan2(y, x));
}

export function terrainRadius(direction: Vector3): number {
  const { x, y, z } = direction;
  let base = WORLD.radius + 0.013 * Math.sin(4.3 * x + 1.2 * z) * Math.cos(4.8 * y - z)
    + 0.005 * Math.sin(8.1 * z + 2 * y) * Math.cos(7.2 * x - y)
    + 0.0015 * Math.sin(15 * x + 3 * z) * Math.cos(14 * y + 2 * x)
    + 0.018 * Math.exp(-8 * ((x + 0.55) ** 2 + (y + 0.35) ** 2 + (z - 0.6) ** 2))
    + 0.023 * Math.exp(-7 * ((x - 0.3) ** 2 + (y - 0.15) ** 2 + (z + 0.93) ** 2));
  // Wide buildable clearings with smooth shoulders, not flat circular platforms.
  for (const meadow of meadows) {
    const weight = MathUtils.smoothstep(direction.dot(meadow.direction), meadow.edge, meadow.core);
    base = MathUtils.lerp(base, WORLD.radius + 0.008, weight * meadow.leveling);
  }
  const shore = lakeMetric(direction);
  if (shore >= 1.65) return base;
  const basin = LAKE.level - 0.004 - 0.04 * (1 - MathUtils.smoothstep(shore, 0.55, 1));
  const bank = Math.max(base, LAKE.level + 0.006);
  const shoreRadius = MathUtils.lerp(basin, bank, MathUtils.smoothstep(shore, 1, 1.18));
  return MathUtils.lerp(shoreRadius, base, MathUtils.smoothstep(shore, 1.18, 1.65));
}

export function mountainHeight(x: number, y: number): number {
  // One connected low ridge, with broad saddles instead of three isolated humps.
  const ridge = 0.035 * Math.sin(x * 8 + 0.4) - 0.13 * x;
  const across = (y - ridge) / 0.145;
  const shoulders = Math.exp(-((x / 0.34) ** 4) - across * across * 1.25);
  const summits = 0.065 + 0.022 * Math.exp(-(((x + 0.13) / 0.12) ** 2))
    + 0.032 * Math.exp(-(((x - 0.12) / 0.13) ** 2));
  const edge = (1 - MathUtils.smoothstep(Math.abs(x), 0.32, 0.46))
    * (1 - MathUtils.smoothstep(Math.abs(y), 0.22, 0.34));
  return shoulders * summits * edge;
}

export function mountainMetric(direction: Vector3): number {
  const facing = direction.dot(MOUNTAINS.center);
  if (facing <= 0.5) return 0;
  return mountainHeight(direction.dot(MOUNTAINS.east) / facing, direction.dot(MOUNTAINS.north) / facing);
}

export function lakeDirection(angle: number, radius: number): Vector3 {
  const edge = lakeOutline(angle) * radius;
  return LAKE.center.clone()
    .addScaledVector(LAKE.east, Math.cos(angle) * LAKE.width * edge)
    .addScaledVector(LAKE.north, Math.sin(angle) * LAKE.height * edge).normalize();
}
