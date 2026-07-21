export class QueueFullError extends Error {
  constructor() {
    super('Operation queue is full');
    this.name = 'QueueFullError';
  }
}

export class SerializedOperationQueue {
  private tail: Promise<void> = Promise.resolve();
  private waiting = 0;
  private lastStartedAt = 0;

  constructor(
    private readonly maxQueueSize: number,
    private readonly minimumIntervalMs: number
  ) {}

  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.waiting > this.maxQueueSize) throw new QueueFullError();
    this.waiting += 1;

    const result = this.tail
      .catch(() => undefined)
      .then(async () => {
        const delay = Math.max(0, this.lastStartedAt + this.minimumIntervalMs - Date.now());
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        this.lastStartedAt = Date.now();
        return operation();
      });

    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    void result.then(
      () => {
        this.waiting -= 1;
      },
      () => {
        this.waiting -= 1;
      }
    );
    return result;
  }
}
