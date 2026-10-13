import { randomUUID } from 'node:crypto';

/** Do not reveal an old frame while React is preparing the selected board mode. */
export class BoardVisibilityGate {
  token?: string;
  private pending?: { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };
  wait(publish: () => void): Promise<void> {
    this.cancel();
    this.token = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.cancel(new Error('白板画面尚未就绪，请重试')), 8000);
      this.pending = { resolve, reject, timer };
      publish();
    });
  }
  ready(token: unknown) {
    if (!this.pending || token !== this.token) return;
    const pending = this.pending; this.pending = undefined; this.token = undefined;
    clearTimeout(pending.timer); pending.resolve();
  }
  cancel(error = new Error('白板打开已取消')) {
    const pending = this.pending; this.pending = undefined; this.token = undefined;
    if (pending) { clearTimeout(pending.timer); pending.reject(error); }
  }
}
