import {
  Color, DataTexture, MathUtils, Mesh, Object3D, RepeatWrapping, RedFormat,
  ShaderMaterial, SphereGeometry, Vector3, LinearFilter, LinearMipmapLinearFilter,
} from 'three';
import { MOUNTAINS } from './terrain';

// All noise is baked once on the CPU. No noise loops or ray marching on the GPU.
function cloudTexture(): DataTexture {
  const size = 32, grid = new Float32Array(size ** 3);
  let seed = 417;
  for (let i = 0; i < grid.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    grid[i] = seed / 4294967296;
  }
  function noise(x: number, y: number, z: number): number {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const smooth = (t: number) => t * t * (3 - 2 * t);
    const u = smooth(x - ix), v = smooth(y - iy), w = smooth(z - iz);
    const at = (a: number, b: number, c: number) => grid[(a & 31) + ((b & 31) * size) + ((c & 31) * size * size)];
    const lerp = MathUtils.lerp;
    return lerp(lerp(lerp(at(ix, iy, iz), at(ix + 1, iy, iz), u),
      lerp(at(ix, iy + 1, iz), at(ix + 1, iy + 1, iz), u), v),
    lerp(lerp(at(ix, iy, iz + 1), at(ix + 1, iy, iz + 1), u),
      lerp(at(ix, iy + 1, iz + 1), at(ix + 1, iy + 1, iz + 1), u), v), w);
  }
  function field(x: number, y: number, z: number): number {
    // Broad flowing forms, with smaller wisps; sampled in 3D to avoid UV seams.
    const warp = noise(x * 2.2 + 4, y * 2.2, z * 2.2);
    const twist = y * 0.6 + warp * 0.45;
    const a = (x * Math.cos(twist) - z * Math.sin(twist)) * 7;
    const b = y * 7 + warp * 0.8;
    const c = (z * Math.cos(twist) + x * Math.sin(twist)) * 7;
    return noise(a, b, c) * 0.48 + noise(a * 2.1, b * 2.1, c * 2.1) * 0.30
      + noise(a * 4.3, b * 4.3, c * 4.3) * 0.15 + noise(a * 8.6, b * 8.6, c * 8.6) * 0.07;
  }
  const width = 512, height = 256, data = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    const theta = (1 - (row + 0.5) / height) * Math.PI;
    for (let col = 0; col < width; col++) {
      const phi = (col + 0.5) / width * Math.PI * 2;
      const x = -Math.cos(phi) * Math.sin(theta), y = Math.cos(theta), z = Math.sin(phi) * Math.sin(theta);
      const value = field(x, y, z), offset = row * width + col;
      data[offset] = Math.round(value * 255);
    }
  }
  const texture = new DataTexture(data, width, height, RedFormat);
  texture.wrapS = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function shellGeometry(): SphereGeometry {
  const geometry = new SphereGeometry(1, 64, 48);
  const position = geometry.attributes.position, normal = geometry.attributes.normal;
  const direction = new Vector3(), outward = new Vector3();
  for (let i = 0; i < position.count; i++) {
    direction.fromBufferAttribute(position, i).normalize();
    // A broad rounded crown encloses the mountain range without enlarging the
    // whole equator or changing the existing camera framing / zoom limits.
    const crown = Math.max(0, direction.dot(MOUNTAINS.center));
    const radius = 1.17 + 0.22 * crown ** 4;
    position.setXYZ(i, direction.x * radius, direction.y * radius, direction.z * radius);
    // Analytic normals stay smooth across the duplicated UV seam and poles.
    const slope = 0.88 * crown ** 3;
    outward.copy(direction).multiplyScalar(radius + slope * crown)
      .addScaledVector(MOUNTAINS.center, -slope).normalize();
    normal.setXYZ(i, outward.x, outward.y, outward.z);
  }
  geometry.computeBoundingSphere();
  return geometry;
}

const shellVertex = `
  varying vec2 shellUv;
  varying vec3 viewNormal;
  varying vec3 viewPosition;
  void main() {
    shellUv = uv;
    viewNormal = normalize(normalMatrix * normal);
    vec4 point = modelViewMatrix * vec4(position, 1.0);
    viewPosition = point.xyz;
    gl_Position = projectionMatrix * point;
  }
`;

export class CloudVeil {
  private opacity = { value: 1 };
  private haloOpacity = { value: 0.65 };
  readonly clouds: Mesh<SphereGeometry, ShaderMaterial>;
  readonly halo: Mesh<SphereGeometry, ShaderMaterial>;

  constructor(planet: Object3D) {
    const geometry = shellGeometry();
    this.clouds = new Mesh(geometry, new ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: {
        cloudMap: { value: cloudTexture() }, veilOpacity: this.opacity,
        cloudLight: { value: new Color(0xe8eff1) }, cloudShadow: { value: new Color(0xa5b7c6) },
      },
      vertexShader: shellVertex,
      fragmentShader: `
        uniform sampler2D cloudMap;
        uniform float veilOpacity;
        uniform vec3 cloudLight;
        uniform vec3 cloudShadow;
        varying vec2 shellUv;
        varying vec3 viewNormal;
        varying vec3 viewPosition;
        void main() {
          float cloud = texture2D(cloudMap, shellUv).r;
          vec3 normal = normalize(viewNormal);
          // Screen derivatives give the baked folds gentle volume (one texture
          // fetch, no normal map and no per-fragment procedural noise).
          vec3 dx = dFdx(viewPosition), dy = dFdy(viewPosition);
          vec3 tangentX = cross(dy, normal), tangentY = cross(normal, dx);
          float determinant = dot(dx, tangentX);
          normal = normalize(abs(determinant) * normal - sign(determinant) * 0.026
            * (dFdx(cloud) * tangentX + dFdy(cloud) * tangentY));
          float sunlight = max(0.0, dot(normal, normalize(vec3(-3.0, 4.0, 5.0))));
          float billow = smoothstep(0.28, 0.72, cloud);
          vec3 color = mix(cloudShadow, cloudLight, 0.35 + billow * 0.65) * (0.24 + sunlight * 0.86);
          float facing = max(0.0, dot(normalize(viewNormal), normalize(-viewPosition)));
          float rim = 1.0 - facing;
          color += vec3(0.08, 0.11, 0.14) * rim * rim;
          // Fully opaque at rest: even the darker cloud folds hide the terrain.
          // Cloud density only varies the dissolving edge during the near reveal.
          float alpha = clamp(veilOpacity + (cloud - 0.5) * 2.0 * veilOpacity * (1.0 - veilOpacity), 0.0, 1.0);
          gl_FragColor = vec4(color, alpha * smoothstep(0.0, 0.35, facing));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    }));
    this.clouds.name = 'cloud-veil';
    this.clouds.renderOrder = 5;

    // A real enclosing shell: Fresnel-like rim with a soft outer falloff.
    // Front faces only, so each shell adds one draw call and no double-sided pass.
    this.halo = new Mesh(geometry, new ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { haloOpacity: this.haloOpacity, haloColor: { value: new Color(0xb4d5ed) } },
      vertexShader: shellVertex,
      fragmentShader: `
        uniform float haloOpacity;
        uniform vec3 haloColor;
        varying vec3 viewNormal;
        varying vec3 viewPosition;
        void main() {
          float facing = max(0.0, dot(normalize(viewNormal), normalize(-viewPosition)));
          float rim = 1.0 - facing;
          float alpha = rim * rim * smoothstep(0.0, 0.4, facing) * haloOpacity;
          gl_FragColor = vec4(haloColor, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    }));
    this.halo.scale.setScalar(1.04);
    this.halo.name = 'soft-atmosphere';
    this.halo.renderOrder = 4;
    // The existing pickable list contains only land, water and rocks.
    planet.add(this.clouds, this.halo);
  }

  update(dt: number, relativeDistance: number): void {
    // Keep the mystery at medium/default distances; reveal only on approach.
    const distance = MathUtils.smoothstep(relativeDistance, 0.60, 0.85);
    const blend = 1 - Math.exp(-5 * dt);
    this.opacity.value += (distance - this.opacity.value) * blend;
    this.haloOpacity.value += (0.025 + distance * 0.625 - this.haloOpacity.value) * blend;
    this.clouds.visible = this.opacity.value > 0.001;
  }
}
