import './style.css';
import {
  ACESFilmicToneMapping, DirectionalLight, HemisphereLight,
  PerspectiveCamera, Raycaster, Scene, Vector2, WebGLRenderer,
} from 'three';
import { createPlanet } from './planet';
import { PlanetControls } from './controls';
import { AdaptiveQuality } from './quality';

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
  const camera = new PerspectiveCamera(35, 1, 0.1, 30);
  const planet = createPlanet();
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
    const hit = raycaster.intersectObject(planet, false)[0];
    if (!hit) return;
    const point = planet.worldToLocal(hit.point);
    // Extension point only: no game logic or visual response in this version.
    canvas.dispatchEvent(new CustomEvent<PlanetTapDetail>('planet-tap', {
      bubbles: true,
      detail: { point: { x: point.x, y: point.y, z: point.z } },
    }));
  });

  const quality = new AdaptiveQuality();
  function resize(): void {
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    renderer.setPixelRatio(quality.pixelRatio(width, height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const halfFov = camera.fov * Math.PI / 360;
    const limitingFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect));
    camera.position.z = 1.065 / Math.sin(limitingFov) * 1.18;
    camera.updateProjectionMatrix();
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
