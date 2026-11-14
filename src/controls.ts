import { Object3D, Quaternion, Vector3 } from 'three';

const TAP_DISTANCE = 9; // CSS pixels, independent of rendering resolution.
const TAP_DURATION = 280;
const axisX = new Vector3(1, 0, 0);
const axisY = new Vector3(0, 1, 0);

export class PlanetControls {
  private pointers = new Set<number>();
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
  ) {
    canvas.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      this.pointers.add(event.pointerId);
      canvas.setPointerCapture(event.pointerId);
      if (this.pointers.size > 1) {
        this.reset();
        this.blocked = true;
        return;
      }
      this.reset();
      this.active = event.pointerId;
      this.startX = this.lastX = event.clientX;
      this.startY = this.lastY = event.clientY;
      this.startedAt = this.movedAt = performance.now();
    });

    canvas.addEventListener('pointermove', (event) => {
      if (this.blocked || event.pointerId !== this.active) return;
      const now = performance.now();
      const distance = Math.hypot(event.clientX - this.startX, event.clientY - this.startY);
      if (!this.dragging && distance <= TAP_DISTANCE) return;
      this.dragging = true;
      const scale = Math.PI / Math.max(1, Math.min(canvas.clientWidth, canvas.clientHeight));
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
      if (this.pointers.size === 0) this.blocked = false;
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    canvas.addEventListener('lostpointercapture', finish);
    canvas.addEventListener('keydown', (event) => {
      const directions: Record<string, [number, number]> = {
        ArrowLeft: [-0.08, 0], ArrowRight: [0.08, 0],
        ArrowUp: [0, -0.08], ArrowDown: [0, 0.08],
      };
      const direction = directions[event.key];
      if (!direction) return;
      event.preventDefault();
      this.reset();
      this.turn(...direction);
    });
    window.addEventListener('blur', () => this.cancel());
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
    this.reset();
    // A backgrounded tab may never receive pointerup for the old fingers.
    this.pointers.clear();
    this.blocked = false;
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
  }
}
