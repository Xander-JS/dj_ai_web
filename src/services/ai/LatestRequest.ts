/** Request identity gate for asynchronous UI work. Cancellation is best effort; identity is authoritative. */
export class LatestRequest {
  private version = 0;
  private controller: AbortController | null = null;

  begin(): { id: number; signal: AbortSignal } {
    this.controller?.abort();
    this.controller = new AbortController();
    return { id: ++this.version, signal: this.controller.signal };
  }

  isCurrent(id: number): boolean {
    return id === this.version;
  }

  finish(id: number): void {
    if (this.isCurrent(id)) this.controller = null;
  }

  invalidate(): void {
    this.version += 1;
    this.controller?.abort();
    this.controller = null;
  }
}
