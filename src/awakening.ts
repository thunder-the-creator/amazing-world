import { Color, MeshStandardMaterial, Vector4 } from 'three';

const MAX_AWAKENINGS = 16;
const WAVE_DURATION = 1.35;
const WAVE_RADIUS = 0.52; // Angular radius on the sphere, in radians.

/** One vertex mask on the existing mesh; all coordinates stay planet-local. */
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
        uniform vec4 uAwakeningPoints[${MAX_AWAKENINGS}];
        uniform int uAwakeningCount;
        varying float vAwakening;
      `).replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vec3 surfaceDirection = normalize(position);
        float sleeping = 1.0;
        for (int i = 0; i < ${MAX_AWAKENINGS}; i++) {
          if (i >= uAwakeningCount) break;
          vec4 region = uAwakeningPoints[i];
          // Dot product gives spherical distance without acos per vertex.
          // w is cos(outer radius); the inner edge stays inside that radius.
          if (region.w < 0.999999) {
            float mask = smoothstep(region.w, mix(region.w, 1.0, 0.4),
              dot(surfaceDirection, region.xyz));
            sleeping *= 1.0 - mask;
          }
        }
        // Smooth union: overlapping regions have no internal borders.
        vAwakening = 1.0 - sleeping;
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
        #include <common>
        varying float vAwakening;
        uniform vec3 uLivingGreen;
        uniform vec3 uLivingGold;
      `).replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        float sunlight = 0.0;
        #if NUM_DIR_LIGHTS > 0
          sunlight = smoothstep(0.3, 1.0, dot(normal, directionalLights[0].direction));
        #endif
        vec3 livingColor = mix(uLivingGreen, uLivingGold, sunlight * 0.35);
        diffuseColor.rgb = mix(diffuseColor.rgb, livingColor, vAwakening);
      `);
    };
    material.customProgramCacheKey = () => 'local-awakening-v1';
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
      const eased = 1 - (1 - progress) ** 3;
      this.points[i].w = Math.cos(WAVE_RADIUS * eased);
    }
  }
}
