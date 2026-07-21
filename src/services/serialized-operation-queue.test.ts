import { QueueFullError, SerializedOperationQueue } from './serialized-operation-queue';

describe('SerializedOperationQueue', () => {
  test('runs one operation at a time in arrival order', async () => {
    const queue = new SerializedOperationQueue(2, 0);
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;

    const first = queue.run(() =>
      new Promise<void>((resolve) => {
        events.push('first-start');
        releaseFirst = resolve;
      }).then(() => events.push('first-end'))
    );
    const second = queue.run(async () => {
      events.push('second-start');
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(events).toEqual(['first-start']);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(events).toEqual(['first-start', 'first-end', 'second-start']);
  });

  test('rejects work beyond the configured waiting bound', async () => {
    const queue = new SerializedOperationQueue(0, 0);
    let release: (() => void) | undefined;
    const active = queue.run(() => new Promise<void>((resolve) => (release = resolve)));

    expect(() => queue.run(async () => undefined)).toThrow(QueueFullError);
    await new Promise((resolve) => setImmediate(resolve));
    release?.();
    await active;
  });
});
