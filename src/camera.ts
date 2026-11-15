import { MathUtils, PerspectiveCamera } from 'three';

/** Zoom is relative to viewport framing, so resize preserves the chosen scale. */
export class CameraMotion {
  private framingDistance = 1;
  private zoom = 1;
  private initialized = false;
  targetDistance = 1;

  constructor(private camera: PerspectiveCamera) {}

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    const halfFov = this.camera.fov * Math.PI / 360;
    const limitingFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * aspect));
    this.framingDistance = 1.065 / Math.sin(limitingFov) * 1.18;
    this.setTarget();
    if (!this.initialized) {
      this.camera.position.z = this.targetDistance;
      this.initialized = true;
    }
    this.camera.updateProjectionMatrix();
  }

  zoomBy(factor: number): void {
    this.zoom = MathUtils.clamp(this.zoom * factor, 0.55, 1.35);
    this.setTarget();
  }

  private setTarget(): void {
    // Planet relief and plants fit inside radius 1.2; near plane is 0.1.
    this.targetDistance = Math.max(2.2, this.framingDistance * this.zoom);
  }

  get rotationSensitivity(): number {
    return MathUtils.clamp(this.camera.position.z / this.framingDistance, 0.45, 1);
  }

  /** Read-only actual zoom for visual reveal effects, independent of screen shape. */
  get relativeDistance(): number {
    return this.camera.position.z / this.framingDistance;
  }

  update(dt: number): void {
    const blend = 1 - Math.exp(-7 * dt);
    this.camera.position.z += (this.targetDistance - this.camera.position.z) * blend;
  }
}
