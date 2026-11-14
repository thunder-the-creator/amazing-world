import { Float32BufferAttribute, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three';
import { lakeMetric, terrainRadius } from './terrain';

function refineLakePatch(geometry: SphereGeometry): void {
  const positions = Array.from(geometry.attributes.position.array);
  const source = geometry.index!;
  const mids = new Map<string, number>();
  const vertex = (i: number) => new Vector3().fromArray(positions, i * 3);
  const append = (point: Vector3) => {
    const index = positions.length / 3;
    point.normalize().toArray(positions, positions.length);
    return index;
  };
  const key = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;
  // Split only edges around the lake. Neighbors share the same midpoints,
  // preventing T-junctions while leaving the rest of the 96x64 sphere intact.
  for (let i = 0; i < source.count; i += 3) {
    const triangle = [source.getX(i), source.getX(i + 1), source.getX(i + 2)];
    if (!triangle.some(v => lakeMetric(vertex(v).normalize()) < 2)) continue;
    for (let j = 0; j < 3; j++) {
      const a = triangle[j], b = triangle[(j + 1) % 3];
      if (!mids.has(key(a, b))) mids.set(key(a, b), append(vertex(a).add(vertex(b))));
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < source.count; i += 3) {
    const triangle = [source.getX(i), source.getX(i + 1), source.getX(i + 2)];
    const ring: number[] = [];
    for (let j = 0; j < 3; j++) {
      const a = triangle[j], b = triangle[(j + 1) % 3];
      ring.push(a);
      const mid = mids.get(key(a, b));
      if (mid !== undefined) ring.push(mid);
    }
    if (ring.length === 3) indices.push(...triangle);
    else {
      const center = append(vertex(triangle[0]).add(vertex(triangle[1])).add(vertex(triangle[2])));
      for (let j = 0; j < ring.length; j++) indices.push(ring[j], ring[(j + 1) % ring.length], center);
    }
  }
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(positions.length, 3));
  geometry.deleteAttribute('uv'); // The untextured material needs no UV coordinates.
  geometry.setIndex(indices);
}

export function createPlanet(): Mesh<SphereGeometry, MeshStandardMaterial> {
  const geometry = new SphereGeometry(1, 96, 64);
  refineLakePatch(geometry);
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const direction = new Vector3();
  const gradient = new Vector3();
  const normal = new Vector3();
  const e = 0.0001;
  const sample = new Vector3();
  const radiusAt = (x: number, y: number, z: number) => terrainRadius(sample.set(x, y, z).normalize());
  const lakeCoordinates: number[] = [];

  for (let i = 0; i < positions.count; i++) {
    direction.fromBufferAttribute(positions, i).normalize();
    const { x, y, z } = direction;
    lakeCoordinates.push(lakeMetric(direction));
    const radius = terrainRadius(direction);
    positions.setXYZ(i, x * radius, y * radius, z * radius);
    // The gradient produces seamless smooth normals, including both poles.
    gradient.set(
      (radiusAt(x + e, y, z) - radiusAt(x - e, y, z)) / (2 * e),
      (radiusAt(x, y + e, z) - radiusAt(x, y - e, z)) / (2 * e),
      (radiusAt(x, y, z + e) - radiusAt(x, y, z - e)) / (2 * e),
    );
    gradient.addScaledVector(direction, -gradient.dot(direction));
    normal.copy(direction).addScaledVector(gradient, -1 / radius).normalize();
    normals.setXYZ(i, normal.x, normal.y, normal.z);
  }
  // The lake and its detailed bank replace this patch, rather than overlapping
  // a coarse sphere underneath. Their outer apron extends beyond the cut edges.
  const source = geometry.index!;
  const indices: number[] = [];
  for (let i = 0; i < source.count; i += 3) {
    const a = source.getX(i), b = source.getX(i + 1), c = source.getX(i + 2);
    if (Math.min(lakeCoordinates[a], lakeCoordinates[b], lakeCoordinates[c]) >= 1.3) indices.push(a, b, c);
  }
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  return new Mesh(geometry, new MeshStandardMaterial({
    color: 0x949b9e,
    roughness: 0.95,
    metalness: 0,
  }));
}
