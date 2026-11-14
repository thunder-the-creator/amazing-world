import { Color, MeshStandardMaterial, Vector4 } from 'three';

const MAX_AWAKENINGS = 16;
const WAVE_DURATION = 1.9;
const WAVE_RADIUS = 0.52; // Angular radius on the sphere, in radians.

/** Per-pixel mask on the existing mesh; all coordinates stay planet-local. */
export class WorldAwakening {
  private points = Array.from({ length: MAX_AWAKENINGS }, () => new Vector4(0, 0, 0, 1));
  private ages = new Float32Array(MAX_AWAKENINGS);
  private count = { value: 0 };

  constructor(material: MeshStandardMaterial) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uAwakeningPoints = { value: this.points };
      shader.uniforms.uAwakeningCount = this.count;
      shader.uniforms.uLivingGreen = { value: new Color(0x638f60) };
      shader.uniforms.uLivingGold = { value: new Color(0xb3a66b) };
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `
        #include <common>
        varying vec3 vSurfaceDirection;
      `).replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vSurfaceDirection = normalize(position);
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
        #include <common>
        varying vec3 vSurfaceDirection;
        uniform vec4 uAwakeningPoints[${MAX_AWAKENINGS}];
        uniform int uAwakeningCount;
        uniform vec3 uLivingGreen;
        uniform vec3 uLivingGold;
      `).replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        // Interpolation changes vector length; normalize once per fragment.
        vec3 surfaceDirection = normalize(vSurfaceDirection);
        float sleeping = 1.0;
        for (int i = 0; i < ${MAX_AWAKENINGS}; i++) {
          if (i >= uAwakeningCount) break;
          vec4 region = uAwakeningPoints[i];
          // w is cos(outer radius): no acos or distance/sqrt per region.
          // Branches depend only on uniforms, keeping derivatives well-defined.
          if (region.w < 0.999999) {
            float alignment = dot(surfaceDirection, region.xyz);
            // Keep the soft inner edge at least one pixel wide at any DPR.
            float feather = max((1.0 - region.w) * 0.4, fwidth(alignment));
            float mask = smoothstep(region.w, region.w + feather, alignment);
            sleeping *= 1.0 - mask;
          }
        }
        // Smooth union: overlapping regions have no internal borders.
        float awakening = 1.0 - sleeping;
        float sunlight = 0.0;
        #if NUM_DIR_LIGHTS > 0
          sunlight = smoothstep(0.3, 1.0, dot(normal, directionalLights[0].direction));
        #endif
        vec3 livingColor = mix(uLivingGreen, uLivingGold, sunlight * 0.35);
        diffuseColor.rgb = mix(diffuseColor.rgb, livingColor, awakening);
      `);
    };
    material.customProgramCacheKey = () => 'local-awakening-per-pixel-v2';
  }

  awaken(point: { x: number; y: number; z: number }): void {
    // Debug cap: retain the first 16 regions, never erase existing living land.
    if (this.count.value === MAX_AWAKENINGS) return;
    const length = Math.hypot(point.x, point.y, point.z);
    if (!Number.isFinite(length) || length < 0.0001) return;
    this.points[this.count.value].set(point.x / length, point.y / length, point.z / length, 1);
    this.ages[this.count.value] = 0;
    this.count.value++;
  }

  update(dt: number): void {
    for (let i = 0; i < this.count.value; i++) {
      if (this.ages[i] >= WAVE_DURATION) continue;
      this.ages[i] = Math.min(WAVE_DURATION, this.ages[i] + dt);
      const progress = this.ages[i] / WAVE_DURATION;
      // Smoothstep: zero speed at both ends, gentle acceleration in between.
      const eased = progress * progress * (3 - 2 * progress);
      this.points[i].w = Math.cos(WAVE_RADIUS * eased);
    }
  }
}
