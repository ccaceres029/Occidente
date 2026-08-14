export interface ConcurrentTaskResult<T, R> {
  item: T;
  index: number;
  status: 'fulfilled' | 'rejected';
  value?: R;
  reason?: unknown;
}

interface ConcurrentQueueOptions<T, R> {
  concurrency?: number;
  onSettled?: (result: ConcurrentTaskResult<T, R>, completed: number, total: number) => void;
}

/**
 * Ejecuta una colección con concurrencia limitada y conserva un resultado por elemento.
 * Una tarea fallida no detiene las demás, lo que permite reintentar solo las pendientes.
 */
export async function runConcurrentQueue<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  options: ConcurrentQueueOptions<T, R> = {},
): Promise<Array<ConcurrentTaskResult<T, R>>> {
  if (items.length === 0) return [];

  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 3));
  const results = new Array<ConcurrentTaskResult<T, R>>(items.length);
  let nextIndex = 0;
  let completed = 0;

  const processNext = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      let result: ConcurrentTaskResult<T, R>;

      try {
        result = { item, index, status: 'fulfilled', value: await worker(item, index) };
      } catch (reason) {
        result = { item, index, status: 'rejected', reason };
      }

      results[index] = result;
      completed += 1;
      options.onSettled?.(result, completed, items.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => processNext()),
  );

  return results;
}
