export async function mapConcurrent<T, R>(values: T[], concurrency: number, work: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await work(values[index]!);
    }
  }));
  return results;
}

export function isStaleScan(run: { state: string; startedAt: string }, now = Date.now()) {
  return run.state === "running" && now - Date.parse(run.startedAt) > 15 * 60 * 1000;
}
