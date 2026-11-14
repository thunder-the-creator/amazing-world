import {
  BufferGeometry, Color, CylinderGeometry, DynamicDrawUsage, Float32BufferAttribute,
  InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Raycaster,
  Sphere, SphereGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WAVE_DURATION, WAVE_RADIUS } from './awakening';

const MAX_GRASS = 144;
const MAX_FLOWERS = 32;
const MIN_SPACING = 0.075;
const UP = new Vector3(0, 1, 0);

// Rounded, smooth leaves/petals. Each species is one merged geometry/material.
function colored(geometry: BufferGeometry, color: number): BufferGeometry {
  const rgb = new Color(color);
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) rgb.toArray(colors, i);
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

function leaf(width: number, height: number, tilt: number, angle: number, color: number): BufferGeometry {
  const geometry = new SphereGeometry(1, 6, 4);
  geometry.scale(width, height / 2, width * 0.65);
  geometry.translate(0, height / 2, 0);
  geometry.rotateZ(tilt);
  geometry.rotateY(angle);
  return colored(geometry, color);
}

function combine(parts: BufferGeometry[]): BufferGeometry {
  const geometry = mergeGeometries(parts, false)!;
  for (const part of parts) part.dispose();
  return geometry;
}

function grassGeometry(): BufferGeometry {
  return combine(Array.from({ length: 5 }, (_, i) =>
    leaf(0.16, 0.72 + (i % 3) * 0.14, i === 0 ? 0.08 : 0.4 + (i % 2) * 0.18,
      i * 2.4, i % 2 ? 0x7ca46d : 0x659567)));
}

function flowerGeometry(): BufferGeometry {
  const stem = colored(new CylinderGeometry(0.035, 0.045, 0.8, 5), 0x61845a);
  stem.translate(0, 0.4, 0);
  const parts = [stem];
  for (let i = 0; i < 2; i++) {
    const geometry = leaf(0.09, 0.38, 0.95, i * Math.PI, 0x719465);
    geometry.translate(0, 0.2 + i * 0.13, 0);
    parts.push(geometry);
  }
  for (let i = 0; i < 5; i++) {
    const petal = new SphereGeometry(1, 6, 4);
    petal.scale(0.13, 0.07, 0.2);
    petal.translate(0, 0.84, 0.16);
    petal.rotateY(i * Math.PI * 2 / 5);
    parts.push(colored(petal, 0xecdcc7));
  }
  const center = new SphereGeometry(1, 6, 4);
  center.scale(0.105, 0.085, 0.105);
  center.translate(0, 0.87, 0);
  parts.push(colored(center, 0xcdb678));
  return combine(parts);
}

interface GrowingPlant {
  mesh: InstancedMesh;
  index: number;
  position: Vector3;
  rotation: Quaternion;
  size: number;
  delay: number;
  duration: number;
  age: number;
}

function batch(geometry: BufferGeometry, capacity: number): InstancedMesh {
  const mesh = new InstancedMesh(geometry,
    new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), capacity);
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  // Fixed conservative local bound: covers relief + fully grown plants.
  mesh.boundingSphere = new Sphere(new Vector3(), 1.2);
  return mesh;
}

export class Vegetation {
  private grass = batch(grassGeometry(), MAX_GRASS);
  private flowers = batch(flowerGeometry(), MAX_FLOWERS);
  private occupied: Vector3[] = [];
  private growing: GrowingPlant[] = [];
  private raycaster = new Raycaster();
  private matrix = new Matrix4();
  private scale = new Vector3();

  constructor(private planet: Mesh) {
    // Instances and growth transforms are local to the rotating planet.
    planet.add(this.grass, this.flowers);
  }

  plant(point: { x: number; y: number; z: number }): void {
    const center = new Vector3(point.x, point.y, point.z).normalize();
    const tangent = new Vector3().crossVectors(center,
      Math.abs(center.y) < 0.9 ? UP : new Vector3(1, 0, 0)).normalize();
    const bitangent = new Vector3().crossVectors(center, tangent);
    this.planet.updateWorldMatrix(true, false);

    for (let i = 0; i < 14; i++) {
      const mesh = i < 12 ? this.grass : this.flowers;
      if (mesh.count >= (i < 12 ? MAX_GRASS : MAX_FLOWERS)) continue;
      // Bounded rejection sampling prevents dense piles in overlapping regions.
      for (let attempt = 0; attempt < 12; attempt++) {
        const radius = i === 0 && attempt === 0 ? 0.035 : 0.1 + Math.sqrt(Math.random()) * 0.23;
        const angle = Math.random() * Math.PI * 2;
        const direction = center.clone().multiplyScalar(Math.cos(radius))
          .addScaledVector(tangent, Math.sin(radius) * Math.cos(angle))
          .addScaledVector(bitangent, Math.sin(radius) * Math.sin(angle)).normalize();
        if (this.occupied.some(p => p.distanceToSquared(direction) < MIN_SPACING ** 2)) continue;

        // Sample actual triangles and their interpolated local normals once at spawn.
        const origin = this.planet.localToWorld(direction.clone().multiplyScalar(2));
        const inward = direction.clone().negate().transformDirection(this.planet.matrixWorld);
        this.raycaster.set(origin, inward);
        const hit = this.raycaster.intersectObject(this.planet, false)[0];
        if (!hit?.normal) continue;
        const normal = hit.normal.clone().normalize();
        const position = this.planet.worldToLocal(hit.point).addScaledVector(normal, -0.001);
        const rotation = new Quaternion().setFromUnitVectors(UP, normal)
          .multiply(new Quaternion().setFromAxisAngle(UP, Math.random() * Math.PI * 2));

        // Invert the existing smoothstep wave on CPU, only when spawning.
        // Plants start inside its green core, not ahead of the color front.
        const target = radius / (WAVE_RADIUS * 0.8);
        let low = 0;
        let high = 1;
        for (let step = 0; step < 12; step++) {
          const t = (low + high) / 2;
          if (t * t * (3 - 2 * t) < target) low = t;
          else high = t;
        }
        const plant: GrowingPlant = {
          mesh, index: mesh.count++, position, rotation,
          size: (i < 12 ? 0.075 : 0.085) * (0.85 + Math.random() * 0.3),
          delay: Math.max(0.45, high * WAVE_DURATION) + Math.random() * 0.06,
          duration: 0.7 + Math.random() * 0.2, age: 0,
        };
        this.writeScale(plant, 0);
        this.growing.push(plant);
        this.occupied.push(direction);
        break;
      }
    }
  }

  private writeScale(plant: GrowingPlant, growth: number): void {
    // Tiny nonzero scale avoids singular normal matrices while hidden underground.
    this.scale.setScalar(plant.size * Math.max(0.001, growth));
    this.matrix.compose(plant.position, plant.rotation, this.scale);
    plant.mesh.setMatrixAt(plant.index, this.matrix);
    plant.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    for (let i = this.growing.length - 1; i >= 0; i--) {
      const plant = this.growing[i];
      plant.age += dt;
      if (plant.age < plant.delay) continue;
      const t = Math.min(1, (plant.age - plant.delay) / plant.duration);
      this.writeScale(plant, t * t * (3 - 2 * t));
      if (t === 1) this.growing.splice(i, 1);
    }
  }
}
