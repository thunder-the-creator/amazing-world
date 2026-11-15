import {
  CanvasTexture, Color, InstancedMesh, MathUtils, Matrix4, Mesh, Object3D,
  PlaneGeometry, Quaternion, ShaderMaterial, Vector3,
} from 'three';

function cloudTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext('2d')!;
  // One small shared alpha texture: overlapping soft lobes with transparent margins.
  const lobes = [
    [27, 37, 21], [47, 29, 25], [70, 25, 24], [93, 35, 23], [65, 41, 21],
  ];
  for (const [x, y, radius] of lobes) {
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, 'rgba(255,255,255,0.94)');
    gradient.addColorStop(0.42, 'rgba(255,255,255,0.82)');
    gradient.addColorStop(0.73, 'rgba(255,255,255,0.32)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  return new CanvasTexture(canvas);
}

export class CloudVeil {
  private opacity = { value: 0.75 };
  private haloOpacity = { value: 0.12 };
  readonly clouds: InstancedMesh<PlaneGeometry, ShaderMaterial>;
  readonly halo: Mesh<PlaneGeometry, ShaderMaterial>;

  constructor(planet: Object3D) {
    const material = new ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: {
        cloudMap: { value: cloudTexture() },
        veilOpacity: this.opacity,
        cloudColor: { value: new Color(0xc6d2dc) },
      },
      vertexShader: `
        varying vec2 cloudUv;
        void main() {
          cloudUv = uv;
          vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          // Only the centers rotate with the planet; each card faces the camera.
          vec2 offset = mat2(instanceMatrix[0].xy, instanceMatrix[1].xy) * position.xy;
          gl_Position = projectionMatrix * (center + vec4(offset, 0.0, 0.0));
        }
      `,
      fragmentShader: `
        uniform sampler2D cloudMap;
        uniform float veilOpacity;
        uniform vec3 cloudColor;
        varying vec2 cloudUv;
        void main() {
          float alpha = texture2D(cloudMap, cloudUv).a * veilOpacity;
          if (alpha < 0.005) discard;
          // Shared RGB makes overlap order independent within this single batch.
          gl_FragColor = vec4(cloudColor, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    // A few elongated clusters, with gaps; the rear clusters appear during rotation.
    const clusters = [
      { direction: [0.22, 0.62, 0.9], altitude: 1.48, width: 1.28, height: 0.52, tilt: -0.12 },
      { direction: [-0.55, 0.15, 0.82], altitude: 1.25, width: 0.9, height: 0.4, tilt: 0.18 },
      { direction: [0.8, 0.3, 0.52], altitude: 1.3, width: 0.95, height: 0.43, tilt: -0.15 },
      { direction: [0.35, -0.45, 0.82], altitude: 1.27, width: 1.15, height: 0.46, tilt: 0.1 },
      { direction: [0.35, 0.25, 0.88], altitude: 1.27, width: 1.0, height: 0.38, tilt: -0.22 },
      { direction: [-0.7, 0.52, -0.5], altitude: 1.3, width: 1.05, height: 0.43, tilt: 0.15 },
      { direction: [0.65, -0.1, -0.75], altitude: 1.27, width: 1.1, height: 0.42, tilt: -0.2 },
      { direction: [-0.3, -0.72, -0.63], altitude: 1.28, width: 0.95, height: 0.4, tilt: 0.1 },
    ];
    this.clouds = new InstancedMesh(new PlaneGeometry(2, 2), material, clusters.length);
    const matrix = new Matrix4(), axis = new Vector3(0, 0, 1);
    clusters.forEach((cluster, i) => {
      matrix.compose(new Vector3(...cluster.direction).normalize().multiplyScalar(cluster.altitude),
        new Quaternion().setFromAxisAngle(axis, cluster.tilt), new Vector3(cluster.width / 2, cluster.height / 2, 1));
      this.clouds.setMatrixAt(i, matrix);
    });
    this.clouds.name = 'cloud-veil';
    this.clouds.frustumCulled = false; // Billboard expansion happens in the vertex shader.
    this.clouds.renderOrder = 5;

    this.halo = new Mesh(new PlaneGeometry(3, 3), new ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { haloOpacity: this.haloOpacity, haloColor: { value: new Color(0x819eb4) } },
      vertexShader: `
        varying vec2 haloPosition;
        void main() {
          haloPosition = position.xy;
          vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          gl_Position = projectionMatrix * (center + vec4(position.xy, 0.0, 0.0));
        }
      `,
      fragmentShader: `
        varying vec2 haloPosition;
        uniform float haloOpacity;
        uniform vec3 haloColor;
        void main() {
          float radius = length(haloPosition);
          float alpha = smoothstep(0.92, 1.04, radius) * (1.0 - smoothstep(1.04, 1.48, radius));
          alpha *= haloOpacity;
          if (alpha < 0.002) discard;
          gl_FragColor = vec4(haloColor, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    }));
    this.halo.name = 'soft-atmosphere';
    this.halo.frustumCulled = false;
    this.halo.renderOrder = 1;
    // These visuals are intentionally absent from landscape.pickables.
    planet.add(this.halo, this.clouds);
  }

  update(dt: number, relativeDistance: number): void {
    const distance = MathUtils.smoothstep(relativeDistance, 0.57, 1.05);
    const blend = 1 - Math.exp(-5 * dt);
    this.opacity.value += (0.035 + distance * 0.75 - this.opacity.value) * blend;
    this.haloOpacity.value += (0.04 + distance * 0.08 - this.haloOpacity.value) * blend;
  }
}
