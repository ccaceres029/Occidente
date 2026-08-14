import { describe, expect, it } from 'vitest';
import { runConcurrentQueue } from './concurrentQueue';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
};

describe('runConcurrentQueue', () => {
  it('respeta el límite de concurrencia y conserva el orden de resultados', async () => {
    let active = 0;
    let maximumActive = 0;
    const gates = Array.from({ length: 5 }, () => deferred<number>());

    const execution = runConcurrentQueue(
      [0, 1, 2, 3, 4],
      async (item) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        const value = await gates[item].promise;
        active -= 1;
        return value;
      },
      { concurrency: 3 },
    );

    await Promise.resolve();
    expect(active).toBe(3);
    gates[0].resolve(10);
    gates[1].resolve(11);
    await Promise.resolve();
    await Promise.resolve();
    expect(active).toBe(3);
    gates[2].resolve(12);
    gates[3].resolve(13);
    gates[4].resolve(14);

    const results = await execution;
    expect(maximumActive).toBe(3);
    expect(results.map((result) => result.value)).toEqual([10, 11, 12, 13, 14]);
  });

  it('continúa después de un error e informa el avance de cada tarea', async () => {
    const progress: number[] = [];
    const results = await runConcurrentQueue(
      ['uno', 'dos', 'tres'],
      async (item) => {
        if (item === 'dos') throw new Error('falló');
        return item.toUpperCase();
      },
      { concurrency: 2, onSettled: (_result, completed) => progress.push(completed) },
    );

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(results[2].value).toBe('TRES');
    expect(progress).toEqual([1, 2, 3]);
  });

  it('no ejecuta trabajo cuando la colección está vacía', async () => {
    let calls = 0;
    const results = await runConcurrentQueue([], async () => { calls += 1; });

    expect(results).toEqual([]);
    expect(calls).toBe(0);
  });
});
