import { MathUtils, PerspectiveCamera } from 'three';
import { WORLD } from './world';

/** Zoom measures the fraction of the available distance above the safe near limit. */
export class CameraMotion {
  private framingDistance = 1;
  private zoom = 1;
  private initialized = false;
  targetDistance = 1;

  constructor(private camera: PerspectiveCamera) {}

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    const halfFov = this.camera.fov * Math.PI / 360;
    // Narrow scenes fit horizontally; desktop scenes fit vertically. Include the
    // entire atmosphere, and use projected sphere tangents rather than a flat disk.
    const narrow = aspect < 1;
    const limitingFov = narrow ? Math.atan(Math.tan(halfFov) * aspect) : halfFov;
    const fill = narrow ? 0.96 : 0.94;
    this.framingDistance = WORLD.atmosphereRadius / Math.sin(Math.atan(Math.tan(limitingFov) * fill));
    this.setTarget();
    if (!this.initialized) {
      this.camera.position.z = this.targetDistance;
      this.initialized = true;
    }
    this.camera.updateProjectionMatrix();
  }

  zoomBy(factor: number): void {
    const range = this.framingDistance - WORLD.minimumCameraDistance;
    const distance = MathUtils.clamp(this.targetDistance * factor,
      WORLD.minimumCameraDistance, WORLD.minimumCameraDistance + range * 1.5);
    this.zoom = (distance - WORLD.minimumCameraDistance) / range;
    this.setTarget();
  }

  private setTarget(): void {
    // A shared near limit stays outside terrain, plants, clouds and the near plane.
    // Keep zoom progress on resize: close inspection stays close on either screen.
    this.targetDistance = WORLD.minimumCameraDistance
      + (this.framingDistance - WORLD.minimumCameraDistance) * this.zoom;
  }

  get rotationSensitivity(): number {
    return MathUtils.clamp((this.camera.position.z - WORLD.radius)
      / (this.framingDistance - WORLD.radius), 0.12, 1);
  }

  /** Actual distance (not the target); the veil responds to the visible approach. */
  get relativeDistance(): number {
    return this.camera.position.z / this.framingDistance;
  }

  update(dt: number): void {
    const blend = 1 - Math.exp(-7 * dt);
    this.camera.position.z += (this.targetDistance - this.camera.position.z) * blend;
  }
}
