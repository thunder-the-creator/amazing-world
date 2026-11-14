import { MathUtils, Vector3 } from 'three';

// All terrain definitions use planet-local coordinates, shared by rendering and planting.
function frame(center: Vector3) {
  center.normalize();
  const east = new Vector3(1, 0, 0).addScaledVector(center, -center.x).normalize();
  const north = new Vector3().crossVectors(center, east);
  return { center, east, north };
}

export const LAKE = { ...frame(new Vector3(0.56, -0.16, 0.81)), width: 0.32, height: 0.23, level: 0.99 };
export const MOUNTAINS = frame(new Vector3(-0.12, 0.9, 0.42));

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
  const base = 1 + 0.027 * Math.sin(4.3 * x + 1.2 * z) * Math.cos(4.8 * y - z)
    + 0.012 * Math.sin(8.1 * z + 2 * y) * Math.cos(7.2 * x - y)
    + 0.004 * Math.sin(15 * x + 3 * z) * Math.cos(14 * y + 2 * x)
    + 0.035 * Math.exp(-8 * ((x + 0.55) ** 2 + (y + 0.35) ** 2 + (z - 0.6) ** 2))
    + 0.045 * Math.exp(-7 * ((x - 0.3) ** 2 + (y - 0.15) ** 2 + (z + 0.93) ** 2));
  const shore = lakeMetric(direction);
  if (shore >= 1.65) return base;
  const basin = LAKE.level - 0.004 - 0.04 * (1 - MathUtils.smoothstep(shore, 0.55, 1));
  const bank = Math.max(base, LAKE.level + 0.006);
  const shoreRadius = MathUtils.lerp(basin, bank, MathUtils.smoothstep(shore, 1, 1.18));
  return MathUtils.lerp(shoreRadius, base, MathUtils.smoothstep(shore, 1.18, 1.65));
}

export function mountainHeight(x: number, y: number): number {
  const peaks = [
    [-0.13, 0.015, 0.18, 0.19, 0.27],
    [0.075, 0.075, 0.145, 0.17, 0.31],
    [0.24, -0.11, 0.13, 0.15, 0.23],
  ];
  let height = 0;
  for (const [cx, cy, width, length, altitude] of peaks) {
    const q = ((x - cx) / width) ** 2 + ((y - cy) / length) ** 2;
    height += altitude * Math.exp(-1.8 * q);
  }
  const edge = (1 - MathUtils.smoothstep(Math.abs(x), 0.34, 0.46))
    * (1 - MathUtils.smoothstep(Math.abs(y), 0.23, 0.34));
  // Broad ridges and rounded summits; no high-frequency spikes.
  return height * edge * (1 + 0.055 * Math.sin(38 * x + 13 * y) * Math.sin(21 * y));
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
