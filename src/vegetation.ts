import {
  BufferGeometry, Color, CylinderGeometry, DynamicDrawUsage, Float32BufferAttribute,
  InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Raycaster,
  Sphere, SphereGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WAVE_DURATION, WAVE_RADIUS } from './awakening';

const MAX_GRASS = 240;
const MAX_FLOWERS_PER_TYPE = 24;
const MIN_SPACING = 0.085;
const UP = new Vector3(0, 1, 0);

// Rounded, smooth leaves/petals. Each species is one merged geometry/material.
function colored(geometry: BufferGeometry, color: number): BufferGeometry {
  const rgb = new Color(color);
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) rgb.toArray(colors, i);
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

function leaf(width: number, height: number, bend: number, angle: number, color: number): BufferGeometry {
  const geometry = new SphereGeometry(1, 6, 6);
  geometry.scale(width, height / 2, width * 0.55);
  geometry.translate(0, height / 2, 0);
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const normal = new Vector3();
  for (let i = 0; i < positions.count; i++) {
    const t = positions.getY(i) / height;
    positions.setX(i, positions.getX(i) + bend * t * t);
    // Inverse-transpose of the bend keeps smooth normals, including the seam.
    normal.fromBufferAttribute(normals, i);
    normal.y -= normal.x * 2 * bend * t / height;
    normal.normalize();
    normals.setXYZ(i, normal.x, normal.y, normal.z);
  }
  geometry.rotateY(angle);
  return colored(geometry, color);
}

function combine(parts: BufferGeometry[]): BufferGeometry {
  const geometry = mergeGeometries(parts, false)!;
  for (const part of parts) part.dispose();
  return geometry;
}

function grassGeometry(): BufferGeometry {
  return combine(Array.from({ length: 4 }, (_, i) =>
    leaf(0.135 + (i % 2) * 0.02, 0.7 + (i % 3) * 0.12, 0.26 + i * 0.11,
      i * 2.4, i % 2 ? 0x7da16c : 0x659360)));
}

function flowerGeometry(type: 'pink' | 'lavender'): BufferGeometry {
  const stem = colored(new CylinderGeometry(0.025, 0.035, 0.8, 6), 0x61845a);
  stem.translate(0, 0.4, 0);
  const parts = [stem];
  for (let i = 0; i < 2; i++) {
    const geometry = leaf(0.075, 0.3, 0.22, i * Math.PI, 0x719465);
    geometry.translate(0, 0.2 + i * 0.13, 0);
    parts.push(geometry);
  }
  const petals = type === 'pink' ? 5 : 4;
  for (let i = 0; i < petals; i++) {
    const petal = new SphereGeometry(1, 8, 4);
    if (type === 'pink') {
      petal.scale(0.13, 0.065, 0.18);
      petal.translate(0, 0.82, 0.14);
    } else {
      // Four upright oval petals form a small lavender cup.
      petal.scale(0.1, 0.14, 0.09);
      petal.rotateX(0.3);
      petal.translate(0, 0.84, 0.105);
    }
    petal.rotateY(i * Math.PI * 2 / petals);
    parts.push(colored(petal, type === 'pink' ? 0xe8b9c6 : 0xc5bcdf));
  }
  const center = new SphereGeometry(1, 8, 4);
  center.scale(0.08, 0.055, 0.08);
  center.translate(0, 0.85, 0);
  parts.push(colored(center, 0xe3d6a8));
  return combine(parts);
}

interface Plant {
  mesh: InstancedMesh;
  index: number;
  position: Vector3;
  rotation: Quaternion;
  finalScale: Vector3;
  startTime: number;
  duration: number;
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
  private pinkFlowers = batch(flowerGeometry('pink'), MAX_FLOWERS_PER_TYPE);
  private lavenderFlowers = batch(flowerGeometry('lavender'), MAX_FLOWERS_PER_TYPE);
  private occupied: Vector3[] = [];
  private plants: Plant[] = [];
  private growing: Plant[] = [];
  private time = 0;
  private raycaster = new Raycaster();
  private matrix = new Matrix4();
  private scale = new Vector3();

  constructor(private planet: Mesh) {
    // Instances and growth transforms are local to the rotating planet.
    planet.add(this.grass, this.pinkFlowers, this.lavenderFlowers);
  }

  plant(point: { x: number; y: number; z: number }): void {
    const center = new Vector3(point.x, point.y, point.z).normalize();
    const tangent = new Vector3().crossVectors(center,
      Math.abs(center.y) < 0.9 ? UP : new Vector3(1, 0, 0)).normalize();
    const bitangent = new Vector3().crossVectors(center, tangent);
    this.planet.updateWorldMatrix(true, false);
    let lastGrassStart = this.time;

    for (let i = 0; i < 14; i++) {
      const isGrass = i < 12;
      const mesh = isGrass ? this.grass : i === 12 ? this.pinkFlowers : this.lavenderFlowers;
      if (mesh.count >= (isGrass ? MAX_GRASS : MAX_FLOWERS_PER_TYPE)) continue;
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
        // A small local lean preserves the surface-aligned root.
        rotation.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0),
          (Math.random() - 0.5) * 0.18));

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
        const size = (isGrass ? 0.085 : 0.09) * (0.85 + Math.random() * 0.3);
        let startTime = this.time + high * WAVE_DURATION + 0.3 + Math.random() * 0.2;
        if (isGrass) lastGrassStart = Math.max(lastGrassStart, startTime);
        else startTime = Math.max(startTime, lastGrassStart + 0.2 + (i - 12) * 0.15);
        const plant: Plant = {
          mesh, index: mesh.count++, position, rotation,
          finalScale: new Vector3(size, size * (0.85 + Math.random() * 0.3), size),
          startTime, duration: 0.7 + Math.random() * 0.4,
        };
        if (isGrass) {
          mesh.setColorAt(plant.index, new Color().setRGB(
            0.86 + Math.random() * 0.14, 0.93 + Math.random() * 0.07, 0.84 + Math.random() * 0.16));
          mesh.instanceColor!.needsUpdate = true;
        }
        this.writeScale(plant, 0);
        this.plants.push(plant);
        this.growing.push(plant);
        this.occupied.push(direction);
        break;
      }
    }
  }

  private writeScale(plant: Plant, growth: number): void {
    // Tiny nonzero scale avoids singular normal matrices while hidden underground.
    this.scale.copy(plant.finalScale).multiplyScalar(Math.max(0.001, growth));
    this.matrix.compose(plant.position, plant.rotation, this.scale);
    plant.mesh.setMatrixAt(plant.index, this.matrix);
    plant.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    this.time += dt;
    for (let i = this.growing.length - 1; i >= 0; i--) {
      const plant = this.growing[i];
      if (this.time < plant.startTime) continue;
      const t = Math.min(1, (this.time - plant.startTime) / plant.duration);
      this.writeScale(plant, Math.sin(t * Math.PI / 2)); // Gentle ease-out, no overshoot.
      if (t === 1) this.growing.splice(i, 1);
    }
  }
}
