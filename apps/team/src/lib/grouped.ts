// Rows grouped by what they belong to, in one pass, each group in the rows' order: a year of tournaments' goals put
// with their games once, not each game looking through every goal there's been (#175). Used by the app and the worker.

/** Each key's rows, in the order they came. */
export function grouped<T, K>(rows: readonly T[], keyOf: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = out.get(key);
    if (group) group.push(row);
    else out.set(key, [row]);
  }
  return out;
}
