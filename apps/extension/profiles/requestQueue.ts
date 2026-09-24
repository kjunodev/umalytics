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

export type RequestPriority = 'shared' | 'stats' | 'leaderboard' | 'profile' | 'history' | 'background';

const priorityOrder: Record<RequestPriority, number> = {
  shared: 0, stats: 1, leaderboard: 2, profile: 3, history: 4, background: 5
};

export class RequestQueue {
  private active = 0;
  private readonly waiting: Array<{ priority: RequestPriority; start: () => void }> = [];
  private nextStartAt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly limit: number, private startIntervalMs = 0) {}

  setStartInterval(ms: number): void { this.startIntervalMs = Math.max(0, ms); }

  private pump(): void {
    if (this.timer !== undefined || this.active >= this.limit || this.waiting.length === 0) return;
    const delay = Math.max(0, this.nextStartAt - Date.now());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.active >= this.limit || this.waiting.length === 0) return;
      let best = 0;
      for (let index = 1; index < this.waiting.length; index += 1) {
        if (priorityOrder[this.waiting[index]!.priority] < priorityOrder[this.waiting[best]!.priority]) best = index;
      }
      const next = this.waiting.splice(best, 1)[0]!;
      this.active += 1;
      this.nextStartAt = Date.now() + this.startIntervalMs;
      next.start();
      this.pump();
    }, delay);
  }

  async run<T>(signal: AbortSignal, work: () => Promise<T>, priority: RequestPriority = 'background'): Promise<T> {
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        const index = this.waiting.indexOf(entry);
        if (index !== -1) this.waiting.splice(index, 1);
        reject(signal.reason ?? new Error('Request cancelled.'));
      };
      const start = () => {
        signal.removeEventListener('abort', abort);
        resolve();
      };
      const entry = { priority, start };
      if (signal.aborted) { abort(); return; }
      this.waiting.push(entry);
      signal.addEventListener('abort', abort, { once: true });
      this.pump();
    });
    try {
      signal.throwIfAborted();
      return await abortable(work(), signal);
    } finally {
      this.active -= 1;
      this.pump();
    }
  }
}
