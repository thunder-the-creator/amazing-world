// Adapt backing-buffer resolution only; geometry and CSS layout stay stable.
export class AdaptiveQuality {
  private elapsed = 0;
  private frames = 0;
  private fastWindows = 0;
  private scale = 1;

  pixelRatio(width: number, height: number): number {
    const ceiling = Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(900_000 / (width * height)));
    return ceiling * this.scale;
  }

  sample(dt: number): boolean {
    this.elapsed += dt;
    this.frames++;
    if (this.elapsed < 2) return false;
    const mean = this.elapsed / this.frames;
    let next = this.scale;
    if (mean > 0.040) {
      next = Math.max(0.5, this.scale - 0.1);
      this.fastWindows = 0;
    } else if (mean < 0.035) {
      if (++this.fastWindows >= 3) {
        next = Math.min(1, this.scale + 0.05);
        this.fastWindows = 0;
      }
    } else {
      this.fastWindows = 0;
    }
    this.resetSamples();
    const changed = next !== this.scale;
    this.scale = next;
    return changed;
  }

  resetSamples(): void {
    this.elapsed = this.frames = 0;
  }
}
