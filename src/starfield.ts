import { BufferGeometry, Float32BufferAttribute, Points, ShaderMaterial } from 'three';

export function createStarfield(): Points<BufferGeometry, ShaderMaterial> {
  const count = 400;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  // Stable sky on reload; this does not affect the plants' random placement.
  let seed = 6247;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < count; i++) {
    let x: number;
    let y: number;
    let z: number;
    if (i < 320) {
      // Populate the visible spherical dome more densely than the rear sky.
      x = (random() - 0.5) * 1.6;
      y = (random() - 0.5) * 1.1;
      z = -1;
    } else {
      y = random() * 2 - 1;
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(1 - y * y);
      x = radius * Math.cos(angle);
      z = radius * Math.sin(angle);
    }
    const distance = 40 / Math.hypot(x, y, z);
    positions.set([x * distance, y * distance, z * distance], i * 3);
    const bright = random() > 0.94;
    const light = bright ? 0.65 : 0.12 + random() * 0.25;
    colors.set([light * 0.8, light * 0.88, light], i * 3);
    sizes[i] = bright ? 1.6 : 0.65 + random() * 0.55;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('starSize', new Float32BufferAttribute(sizes, 1));
  const material = new ShaderMaterial({
    uniforms: { pixelRatio: { value: 1 } },
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    vertexShader: `
      uniform float pixelRatio;
      attribute float starSize;
      varying vec3 starColor;
      void main() {
        starColor = color;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(1.0, starSize * pixelRatio);
      }
    `,
    fragmentShader: `
      varying vec3 starColor;
      void main() {
        float radius = length(gl_PointCoord - 0.5);
        float alpha = 1.0 - smoothstep(0.12, 0.5, radius);
        gl_FragColor = vec4(starColor, alpha);
        #include <colorspace_fragment>
      }
    `,
  });
  const stars = new Points(geometry, material);
  stars.frustumCulled = false;
  return stars;
}
