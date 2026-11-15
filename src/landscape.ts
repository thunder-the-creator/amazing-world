import {
  BufferGeometry, Color, Float32BufferAttribute, InstancedMesh, Matrix4,
  MathUtils, Mesh, MeshStandardMaterial, Quaternion, SphereGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAKE, MOUNTAINS, lakeDirection, lakeMetric, lakeOutline, mountainHeight, mountainMetric, terrainRadius } from './terrain';

interface BankVertex { angle: number; radius: number; position: Vector3; normal: Vector3 }

// Subdivide the actual cut edges, preserving their positions and normals exactly.
// Sharing this angular sampling with the water makes both seams watertight.
function bankBoundary(planet: Mesh): BankVertex[] {
  const source = planet.geometry;
  const edges = new Map<string, { a: number; b: number; count: number }>();
  const index = source.index!;
  for (let i = 0; i < index.count; i += 3) {
    const vertices = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    for (let j = 0; j < 3; j++) {
      const a = vertices[j], b = vertices[(j + 1) % 3];
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      const edge = edges.get(key);
      if (edge) edge.count++;
      else edges.set(key, { a, b, count: 1 });
    }
  }
  const angles = Array.from({ length: 96 }, (_, i) => i * Math.PI * 2 / 96);
  const boundary = [...edges.values()].filter(edge => edge.count === 1).map(edge => {
    const a = new Vector3().fromBufferAttribute(source.attributes.position, edge.a);
    const b = new Vector3().fromBufferAttribute(source.attributes.position, edge.b);
    return { ...edge, pa: a, pb: b };
  }).filter(edge => lakeMetric(edge.pa.clone().normalize()) < 1.8 && lakeMetric(edge.pb.clone().normalize()) < 1.8)
    .map(edge => {
      const wa = edge.pa.dot(LAKE.center), wb = edge.pb.dot(LAKE.center);
      const ax = edge.pa.dot(LAKE.east) / wa / LAKE.width, ay = edge.pa.dot(LAKE.north) / wa / LAKE.height;
      const bx = edge.pb.dot(LAKE.east) / wb / LAKE.width, by = edge.pb.dot(LAKE.north) / wb / LAKE.height;
      angles.push((Math.atan2(ay, ax) + Math.PI * 2) % (Math.PI * 2));
      angles.push((Math.atan2(by, bx) + Math.PI * 2) % (Math.PI * 2));
      return { ...edge, wa, wb, ax, ay, bx, by };
    });
  angles.sort((a, b) => a - b);
  return angles.filter((angle, i) => i === 0 || angle - angles[i - 1] > 1e-7).map(angle => {
    const x = Math.cos(angle), y = Math.sin(angle);
    let outer: BankVertex | undefined;
    for (const edge of boundary) {
      const dx = edge.bx - edge.ax, dy = edge.by - edge.ay;
      const cross = x * dy - y * dx;
      if (Math.abs(cross) < 1e-9) continue;
      const t = (edge.ax * y - edge.ay * x) / cross;
      const radius = (edge.ax * dy - edge.ay * dx) / cross;
      if (t < -1e-7 || t > 1 + 1e-7 || radius <= 0) continue;
      const projected = MathUtils.clamp(t, 0, 1);
      const amount = projected * edge.wa / (edge.wb * (1 - projected) + projected * edge.wa);
      // A cut grid can have tiny inward notches; cover the outer envelope so no
      // lake-sector triangle leaves a hole between two intersections of one ray.
      if (!outer || radius > outer.radius) {
        outer = { angle, radius, position: edge.pa.clone().lerp(edge.pb, amount),
          normal: new Vector3().fromBufferAttribute(source.attributes.normal, edge.a)
            .lerp(new Vector3().fromBufferAttribute(source.attributes.normal, edge.b), amount).normalize() };
      }
    }
    if (outer) return outer;
    throw new Error('Lake boundary must form a closed radial contour.');
  });
}

function geometry(positions: number[], indices: number[], colors: number[], region: number): BufferGeometry {
  const result = new BufferGeometry();
  result.setAttribute('position', new Float32BufferAttribute(positions, 3));
  result.setAttribute('color', new Float32BufferAttribute(colors, 3));
  // Reserved semantic IDs for future landscape awakening; no awakening effect is applied here.
  result.setAttribute('landscapeRegion', new Float32BufferAttribute(new Float32Array(positions.length / 3).fill(region), 1));
  result.setIndex(indices);
  result.computeVertexNormals();
  result.computeBoundingSphere();
  return result;
}

function mountains(): BufferGeometry {
  const positions: number[] = [], indices: number[] = [], colors: number[] = [];
  const width = 64, height = 48;
  const low = new Color(0x656b70), high = new Color(0xa5aaad);
  const ground = new Color(0x949b9e);
  for (let row = 0; row <= height; row++) {
    for (let col = 0; col <= width; col++) {
      const x = (col / width - 0.5) * 0.92, y = (row / height - 0.5) * 0.68;
      const direction = MOUNTAINS.center.clone().addScaledVector(MOUNTAINS.east, x)
        .addScaledVector(MOUNTAINS.north, y).normalize();
      const altitude = mountainHeight(x, y);
      direction.multiplyScalar(terrainRadius(direction) + altitude - 0.002);
      positions.push(direction.x, direction.y, direction.z);
      const shade = Math.min(1, altitude * 6 + 0.025 * Math.sin(23 * y + 9 * x) + 0.12);
      const color = low.clone().lerp(high, Math.max(0, shade));
      color.lerp(ground, 1 - MathUtils.smoothstep(altitude, 0, 0.04));
      colors.push(color.r, color.g, color.b);
      if (row < height && col < width) {
        const a = row * (width + 1) + col, b = a + width + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  return geometry(positions, indices, colors, 0);
}

function lakeSurface(shore: boolean, boundary: BankVertex[]): BufferGeometry {
  const positions: number[] = [], indices: number[] = [], colors: number[] = [];
  const segments = boundary.length, rings = shore ? 12 : 14;
  const deep = new Color(shore ? 0x646863 : 0x5e6862);
  const shallow = new Color(shore ? 0x898c86 : 0x7b8173);
  for (let ring = 0; ring <= rings; ring++) {
    const t = ring / rings;
    for (let i = 0; i <= segments; i++) {
      const bank = boundary[i % segments];
      const angle = bank.angle;
      const radius = shore ? MathUtils.lerp(0.98, bank.radius / lakeOutline(angle), t) : t * 0.98;
      const direction = lakeDirection(angle, radius);
      const elevation = shore ? MathUtils.lerp(LAKE.level, terrainRadius(direction),
        MathUtils.smoothstep(radius, 0.98, 1.13)) : LAKE.level;
      direction.multiplyScalar(elevation);
      if (shore && ring === rings) {
        // Subpixel apron closes rasterization cracks on subdivided boundary edges.
        const outward = bank.position.clone().normalize().sub(LAKE.center).normalize();
        direction.copy(bank.position).multiplyScalar(1.00015).addScaledVector(outward, 0.0005);
      }
      positions.push(direction.x, direction.y, direction.z);
      const shade = shore ? 0.3 + t * 0.5 + 0.08 * Math.sin(angle * 11) : t * t * 0.65;
      const color = deep.clone().lerp(shallow, shade);
      if (shore) color.lerp(new Color(0x949b9e), MathUtils.smoothstep(t, 0.4, 1));
      colors.push(color.r, color.g, color.b);
      if (ring < rings && i < segments) {
        const a = ring * (segments + 1) + i, b = a + segments + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const result = geometry(positions, indices, colors, shore ? 1 : 2);
  if (shore) {
    for (let i = 0; i <= segments; i++) {
      const normal = boundary[i % segments].normal;
      result.attributes.normal.setXYZ(rings * (segments + 1) + i, normal.x, normal.y, normal.z);
    }
  }
  // A constant-radius water surface has exact smooth radial normals, including its center.
  if (!shore) {
    const normal = new Vector3();
    for (let i = 0; i < result.attributes.position.count; i++) {
      normal.fromBufferAttribute(result.attributes.position, i).normalize();
      result.attributes.normal.setXYZ(i, normal.x, normal.y, normal.z);
    }
  }
  return result;
}

export function createLandscape(planet: Mesh) {
  const stoneMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.98 });
  const boundary = bankBoundary(planet);
  const pieces = [mountains(), lakeSurface(true, boundary)];
  const stoneSurface = new Mesh(mergeGeometries(pieces, false)!, stoneMaterial);
  for (const piece of pieces) piece.dispose();
  const water = new Mesh(lakeSurface(false, boundary), new MeshStandardMaterial({
    vertexColors: true, roughness: 0.88, metalness: 0,
  }));
  stoneSurface.name = 'dormant-mountains-and-shore';
  water.name = 'dormant-lake';

  const rockGeometry = new SphereGeometry(1, 16, 10);
  const position = rockGeometry.attributes.position;
  const color = new Color(0x747a7c);
  const colors: number[] = [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const shape = 1 + 0.09 * Math.sin(x * 5 + y * 2) * Math.cos(z * 4 - y);
    position.setXYZ(i, x * shape, y * shape, z * shape);
    const shade = 0.85 + 0.12 * y;
    colors.push(color.r * shade, color.g * shade, color.b * shade);
  }
  rockGeometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  rockGeometry.computeVertexNormals();
  const placements = [
    { direction: lakeDirection(0.2, 1.2), scale: new Vector3(0.055, 0.045, 0.04) },
    { direction: lakeDirection(0.65, 1.19), scale: new Vector3(0.035, 0.027, 0.028) },
    { direction: lakeDirection(1.9, 1.16), scale: new Vector3(0.06, 0.04, 0.035) },
    { direction: lakeDirection(2.45, 1.2), scale: new Vector3(0.038, 0.025, 0.028) },
    { direction: lakeDirection(3.6, 1.22), scale: new Vector3(0.05, 0.038, 0.035) },
    { direction: lakeDirection(4.8, 1.18), scale: new Vector3(0.04, 0.025, 0.03) },
    { direction: new Vector3(-0.80, 0.30, 0.52).normalize(), scale: new Vector3(0.08, 0.085, 0.065) },
    { direction: new Vector3(-0.78, 0.40, 0.50).normalize(), scale: new Vector3(0.065, 0.065, 0.05) },
    { direction: new Vector3(0.81, 0.48, 0.35).normalize(), scale: new Vector3(0.07, 0.13, 0.055) },
    { direction: new Vector3(0.87, 0.42, 0.27).normalize(), scale: new Vector3(0.045, 0.06, 0.04) },
    { direction: new Vector3(-0.3, -0.55, -0.78).normalize(), scale: new Vector3(0.10, 0.08, 0.065) },
    { direction: new Vector3(0.55, 0.4, -0.73).normalize(), scale: new Vector3(0.07, 0.07, 0.05) },
  ];
  // Smaller landmarks leave room for future paths, homes and groves.
  for (const placement of placements) placement.scale.multiplyScalar(0.65);
  const rocks = new InstancedMesh(rockGeometry, stoneMaterial, placements.length);
  rocks.name = 'dormant-rocks';
  const matrix = new Matrix4(), rotation = new Quaternion(), up = new Vector3(0, 1, 0);
  placements.forEach(({ direction, scale }, i) => {
    rotation.setFromUnitVectors(up, direction).multiply(new Quaternion().setFromAxisAngle(up, i * 2.4));
    matrix.compose(direction.clone().multiplyScalar(terrainRadius(direction) + scale.y * 0.25), rotation, scale);
    rocks.setMatrixAt(i, matrix);
  });
  rocks.computeBoundingSphere();
  planet.add(stoneSurface, water, rocks);

  return {
    // Only terrain participates in tapping; plant children must never intercept a tap.
    pickables: [planet, stoneSurface, water, rocks],
    // Local centers and semantic geometry IDs support future local appearance changes.
    regions: { mountains: MOUNTAINS, lake: LAKE, rocks: placements },
    stoneSurface, water, rocks,
    canPlant(direction: Vector3, normal: Vector3): boolean {
      // Also exclude the fine mountain apron: it can sit slightly above the
      // coarser planet triangles even where the analytical ridge is very low.
      if (lakeMetric(direction) < 1.75 || mountainMetric(direction) > 0.001) return false;
      if (normal.dot(direction) < Math.cos(Math.PI * 40 / 180)) return false;
      return !placements.some(rock => direction.distanceTo(rock.direction)
        < Math.max(rock.scale.x, rock.scale.z) * 1.15 + 0.055);
    },
  };
}
