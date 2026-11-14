import { Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three';

// Deterministic, continuous relief: no textures or noise dependencies.
function height(x: number, y: number, z: number): number {
  return 0.026 * Math.sin(4.3 * x + 1.2 * z) * Math.cos(4.8 * y - z)
    + 0.014 * Math.sin(8.1 * z + 2 * y) * Math.cos(7.2 * x - y)
    + 0.006 * Math.sin(15 * x + 3 * z) * Math.cos(14 * y + 2 * x)
    + 0.002 * Math.sin(29 * z - y) * Math.cos(25 * x + y);
}

export function createPlanet(): Mesh<SphereGeometry, MeshStandardMaterial> {
  const geometry = new SphereGeometry(1, 96, 64);
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const direction = new Vector3();
  const gradient = new Vector3();
  const normal = new Vector3();
  const e = 0.0001;

  for (let i = 0; i < positions.count; i++) {
    direction.fromBufferAttribute(positions, i).normalize();
    const { x, y, z } = direction;
    const radius = 1 + height(x, y, z);
    positions.setXYZ(i, x * radius, y * radius, z * radius);
    // The gradient produces seamless smooth normals, including both poles.
    gradient.set(
      (height(x + e, y, z) - height(x - e, y, z)) / (2 * e),
      (height(x, y + e, z) - height(x, y - e, z)) / (2 * e),
      (height(x, y, z + e) - height(x, y, z - e)) / (2 * e),
    );
    gradient.addScaledVector(direction, -gradient.dot(direction));
    normal.copy(direction).addScaledVector(gradient, -1 / radius).normalize();
    normals.setXYZ(i, normal.x, normal.y, normal.z);
  }
  geometry.computeBoundingSphere();

  return new Mesh(geometry, new MeshStandardMaterial({
    color: 0x949b9e,
    roughness: 0.95,
    metalness: 0,
  }));
}
