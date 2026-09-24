/** One budget covers queueing, headers and body consumption. */
export function deadline(parent: AbortSignal | undefined, ms: number, message: string) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason ?? new Error('Request cancelled.'));
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(message)), ms);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener('abort', abort);
    }
  };
}

export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('Request cancelled.'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export class RequestQueue {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private nextStartAt = 0;
  private pacing = Promise.resolve();

  constructor(private readonly limit: number, private startIntervalMs = 0) {}

  setStartInterval(ms: number): void { this.startIntervalMs = Math.max(0, ms); }

  private async waitForPacedStart(signal: AbortSignal): Promise<void> {
    const turn = this.pacing.then(async () => {
      signal.throwIfAborted();
      const delay = Math.max(0, this.nextStartAt - Date.now());
      if (delay > 0) await new Promise<void>((resolve, reject) => {
        const finish = () => { signal.removeEventListener('abort', abort); resolve(); };
        const timer = setTimeout(finish, delay);
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        signal.addEventListener('abort', abort, { once: true });
      });
      signal.throwIfAborted();
      this.nextStartAt = Date.now() + this.startIntervalMs;
    });
    this.pacing = turn.catch(() => {});
    await abortable(turn, signal);
  }

  async run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        const index = this.waiting.indexOf(start);
        if (index !== -1) this.waiting.splice(index, 1);
        reject(signal.reason ?? new Error('Request cancelled.'));
      };
      const start = () => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) { abort(); return; }
        this.active += 1;
        resolve();
      };
      if (signal.aborted) { abort(); return; }
      if (this.active < this.limit) start();
      else {
        this.waiting.push(start);
        signal.addEventListener('abort', abort, { once: true });
      }
    });
    try {
      signal.throwIfAborted();
      await this.waitForPacedStart(signal);
      return await abortable(work(), signal);
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}
