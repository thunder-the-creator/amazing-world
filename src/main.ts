import './style.css';
import {
  ACESFilmicToneMapping, DirectionalLight, HemisphereLight,
  PerspectiveCamera, Raycaster, Scene, Vector2, WebGLRenderer,
} from 'three';
import { createPlanet } from './planet';
import { PlanetControls } from './controls';
import { AdaptiveQuality } from './quality';
import { WorldAwakening } from './awakening';
import { Vegetation } from './vegetation';
import { CameraMotion } from './camera';
import { createStarfield } from './starfield';
import { createLandscape } from './landscape';
import { CloudVeil } from './clouds';

/** Coordinates in planet-local space; independent of its current rotation. */
export interface PlanetTapDetail {
  point: { x: number; y: number; z: number };
}

const canvas = document.querySelector<HTMLCanvasElement>('#planet')!;
const stage = document.querySelector<HTMLElement>('.stage')!;
const error = document.querySelector<HTMLParagraphElement>('#error')!;

function showError(message: string): void {
  error.textContent = message;
  error.hidden = false;
}

function start(): void {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch {
    showError('Не удалось запустить 3D. Откройте страницу в браузере с поддержкой WebGL 2.');
    return;
  }
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(35, 1, 0.1, 100);
  const cameraMotion = new CameraMotion(camera);
  const stars = createStarfield();
  scene.add(stars);
  const planet = createPlanet();
  const landscape = createLandscape(planet);
  const veil = new CloudVeil(planet);
  const awakening = new WorldAwakening(planet.material);
  const vegetation = new Vegetation(planet, landscape.canPlant);
  canvas.addEventListener('planet-tap', (event) => {
    const point = (event as CustomEvent<PlanetTapDetail>).detail.point;
    if (awakening.awaken(point)) vegetation.plant(point);
  });
  planet.rotation.set(0.15, -0.4, -0.1);
  scene.add(planet);
  scene.add(new HemisphereLight(0xd9e6f0, 0x394652, 1.5));
  const key = new DirectionalLight(0xf1f4f7, 3.1);
  key.position.set(-3, 4, 5);
  scene.add(key);
  const rim = new DirectionalLight(0x9fbcd3, 1.1);
  rim.position.set(3, 0, -2);
  scene.add(rim);

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const controls = new PlanetControls(canvas, planet, (x, y) => {
    const rect = canvas.getBoundingClientRect();
    pointer.set((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1);
    camera.updateMatrixWorld();
    planet.updateMatrixWorld();
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(landscape.pickables, false)[0];
    if (!hit) return;
    const point = planet.worldToLocal(hit.point);
    // The surface interaction uses the same local point as the public event.
    canvas.dispatchEvent(new CustomEvent<PlanetTapDetail>('planet-tap', {
      bubbles: true,
      detail: { point: { x: point.x, y: point.y, z: point.z } },
    }));
  }, cameraMotion);

  const quality = new AdaptiveQuality();
  function resize(): void {
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    renderer.setPixelRatio(quality.pixelRatio(width, height));
    renderer.setSize(width, height, false);
    cameraMotion.resize(width / height);
    stars.material.uniforms.pixelRatio.value = renderer.getPixelRatio();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  const interval = 1000 / 30;
  let previous = performance.now();
  let renderedAt = previous;
  let frame = 0;
  let contextLost = false;
  function animate(now: number): void {
    frame = requestAnimationFrame(animate);
    if (contextLost) return;
    const elapsed = now - previous;
    if (elapsed < interval - 0.5) return;
    previous += Math.max(1, Math.floor((elapsed + 0.5) / interval)) * interval;
    const dt = (now - renderedAt) / 1000;
    renderedAt = now;
    controls.update(Math.min(dt, 0.1));
    cameraMotion.update(Math.min(dt, 0.1));
    veil.update(Math.min(dt, 0.1), cameraMotion.relativeDistance);
    // A camera-centered shell behaves like a distant sky during zoom.
    stars.position.copy(camera.position);
    awakening.update(Math.min(dt, 0.1));
    vegetation.update(Math.min(dt, 0.1));
    if (quality.sample(dt)) resize();
    renderer.render(scene, camera);
  }
  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(frame);
    controls.cancel();
    quality.resetSamples();
    if (!document.hidden) {
      previous = renderedAt = performance.now();
      frame = requestAnimationFrame(animate);
    }
  });
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    contextLost = true;
    controls.cancel();
    showError('3D временно приостановлено. Ожидаем восстановления графики…');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false;
    error.hidden = true;
    previous = renderedAt = performance.now();
    quality.resetSamples();
    resize();
  });
  frame = requestAnimationFrame(animate);
}

start();
