import { Object3D, Quaternion, Vector2, Vector3 } from 'three';
import type { CameraMotion } from './camera';

const TAP_DISTANCE = 9; // CSS pixels, independent of rendering resolution.
const TAP_DURATION = 280;
const AUTO_DELAY = 2.5;
const AUTO_SPEED = 0.025; // Radians per second; one revolution in about 4 minutes.
const axisX = new Vector3(1, 0, 0);
const axisY = new Vector3(0, 1, 0);

export class PlanetControls {
  private pointers = new Map<number, Vector2>();
  private pinchDistance = 0;
  private idleTime = 0;
  private autoSpeed = 0;
  private active: number | null = null;
  private blocked = false;
  private dragging = false;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private startedAt = 0;
  private movedAt = 0;
  private velocityX = 0;
  private velocityY = 0;
  private rotation = new Quaternion();
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(
    canvas: HTMLCanvasElement,
    private planet: Object3D,
    private onTap: (x: number, y: number) => void,
    private camera: CameraMotion,
  ) {
    canvas.addEventListener('pointerdown', (event) => {
      this.interact();
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      this.pointers.set(event.pointerId, new Vector2(event.clientX, event.clientY));
      canvas.setPointerCapture(event.pointerId);
      if (this.pointers.size > 1) {
        this.reset();
        this.blocked = true;
        this.pinchDistance = this.measurePinch();
        return;
      }
      this.reset();
      this.active = event.pointerId;
      this.startX = this.lastX = event.clientX;
      this.startY = this.lastY = event.clientY;
      this.startedAt = this.movedAt = performance.now();
    });

    canvas.addEventListener('pointermove', (event) => {
      this.interact();
      this.pointers.get(event.pointerId)?.set(event.clientX, event.clientY);
      if (this.blocked) {
        const distance = this.measurePinch();
        if (distance > 1 && this.pinchDistance > 1) {
          this.camera.zoomBy(this.pinchDistance / distance);
        }
        this.pinchDistance = distance;
        return;
      }
      if (event.pointerId !== this.active) return;
      const now = performance.now();
      const distance = Math.hypot(event.clientX - this.startX, event.clientY - this.startY);
      if (!this.dragging && distance <= TAP_DISTANCE) return;
      this.dragging = true;
      const scale = Math.PI / Math.max(1, Math.min(canvas.clientWidth, canvas.clientHeight))
        * this.camera.rotationSensitivity;
      const dx = (event.clientX - this.lastX) * scale;
      const dy = (event.clientY - this.lastY) * scale;
      const dt = Math.max((now - this.movedAt) / 1000, 0.008);
      this.turn(dx, dy);
      this.velocityX = this.velocityX * 0.3 + Math.max(-4, Math.min(4, dx / dt)) * 0.7;
      this.velocityY = this.velocityY * 0.3 + Math.max(-4, Math.min(4, dy / dt)) * 0.7;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.movedAt = now;
    });

    const finish = (event: PointerEvent) => {
      if (!this.pointers.has(event.pointerId)) return;
      this.interact();
      if (event.pointerId === this.active && !this.blocked) {
        const now = performance.now();
        const distance = Math.hypot(event.clientX - this.startX, event.clientY - this.startY);
        if (event.type === 'pointerup' && !this.dragging && distance <= TAP_DISTANCE
          && now - this.startedAt <= TAP_DURATION) {
          this.onTap(event.clientX, event.clientY);
        }
        if (event.type !== 'pointerup' || now - this.movedAt > 90 || this.reducedMotion.matches) {
          this.velocityX = this.velocityY = 0;
        }
        this.active = null;
      }
      this.pointers.delete(event.pointerId);
      // Rebase after a third finger leaves; one remaining finger stays blocked.
      this.pinchDistance = this.measurePinch();
      if (this.pointers.size === 0) this.blocked = false;
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    canvas.addEventListener('lostpointercapture', finish);
    canvas.addEventListener('pointerenter', () => this.interact());
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.interact();
      this.velocityX = this.velocityY = 0;
      this.dragging = true; // A wheel during a held click must not end as a tap.
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
      const delta = Math.max(-240, Math.min(240, event.deltaY * units));
      this.camera.zoomBy(Math.exp(delta * 0.0015));
    }, { passive: false });
    canvas.addEventListener('keydown', (event) => {
      const directions: Record<string, [number, number]> = {
        ArrowLeft: [-0.08, 0], ArrowRight: [0.08, 0],
        ArrowUp: [0, -0.08], ArrowDown: [0, 0.08],
      };
      const direction = directions[event.key];
      if (!direction) return;
      event.preventDefault();
      this.interact();
      this.reset();
      this.turn(direction[0] * this.camera.rotationSensitivity, direction[1] * this.camera.rotationSensitivity);
    });
    window.addEventListener('blur', () => this.cancel());
  }

  private interact(): void {
    this.idleTime = 0;
    this.autoSpeed = 0;
  }

  private measurePinch(): number {
    if (this.pointers.size !== 2) return 0;
    const [first, second] = this.pointers.values();
    return first.distanceTo(second);
  }

  private turn(dx: number, dy: number): void {
    this.rotation.setFromAxisAngle(axisY, dx);
    this.planet.quaternion.premultiply(this.rotation);
    this.rotation.setFromAxisAngle(axisX, dy);
    this.planet.quaternion.premultiply(this.rotation).normalize();
  }

  private reset(): void {
    this.active = null;
    this.dragging = false;
    this.velocityX = this.velocityY = 0;
  }

  cancel(): void {
    this.interact();
    this.reset();
    // A backgrounded tab may never receive pointerup for the old fingers.
    this.pointers.clear();
    this.blocked = false;
    this.pinchDistance = 0;
  }

  update(dt: number): void {
    if (this.active !== null || this.blocked) return;
    const decay = Math.exp(-4.5 * dt);
    // Integral of exponential decay makes inertia independent of frame rate.
    this.turn(this.velocityX * (1 - decay) / 4.5, this.velocityY * (1 - decay) / 4.5);
    this.velocityX *= decay;
    this.velocityY *= decay;
    if (Math.abs(this.velocityX) < 0.002) this.velocityX = 0;
    if (Math.abs(this.velocityY) < 0.002) this.velocityY = 0;
    this.idleTime += dt;
    if (this.reducedMotion.matches) {
      this.autoSpeed = 0;
      return;
    }
    if (this.velocityX !== 0 || this.velocityY !== 0) return;
    // Integrate the exponential speed ramp, including a partial delay-crossing frame.
    const autoDt = Math.min(dt, Math.max(0, this.idleTime - AUTO_DELAY));
    const fade = Math.exp(-1.2 * autoDt);
    this.turn(AUTO_SPEED * autoDt + (this.autoSpeed - AUTO_SPEED) * (1 - fade) / 1.2, 0);
    this.autoSpeed = AUTO_SPEED + (this.autoSpeed - AUTO_SPEED) * fade;
  }
}
