// Small FIFO concurrency limiter (C4-5). Mirrors the local pattern already
// used by apps/daemon/src/document-preview.ts's createLimiter -- kept as its
// own copy here (rather than exported/shared) since that file's helper is
// module-private and covers/ is a distinct domain folder per
// apps/daemon/AGENTS.md.

export function createLimiter<T>(limit: number): (task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const pending: Array<{
    task: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
  }> = [];

  const runNext = (): void => {
    if (active >= limit || pending.length === 0) return;
    active += 1;
    const next = pending.shift();
    if (!next) throw new Error('cover render limiter queue invariant violated');
    const { task, resolve, reject } = next;
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        runNext();
      });
  };

  return (task) =>
    new Promise<T>((resolve, reject) => {
      pending.push({ task, resolve, reject });
      runNext();
    });
}
