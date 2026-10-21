// A job in steps (lib/Wizard.svelte, ADR 0117): how far on it can go.

/**
 * The furthest step open: the first whose needs aren't met (you can be on it, not past it), or the last when every
 * step's are. `met[i]`: step i has what it needs.
 */
export function reachableStep(met: readonly boolean[]): number {
  const i = met.findIndex((ok) => !ok);
  return i === -1 ? Math.max(0, met.length - 1) : i;
}
