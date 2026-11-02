// One thing's requests in the order they were tapped (the register: a walk-in added, then let in): each is sent once
// the one before it for the same key has been answered, failed or not; different keys go at once.

/**
 * A queue per key: `turn(key, send)` sends when the key's last request has been answered, and gives its answer.
 * Without it a quick second tap can reach the server first: Let in arriving before the add it follows is refused (409).
 */
export function inTurn<K>() {
  const last = new Map<K, Promise<unknown>>();
  return <T>(key: K, send: () => Promise<T>): Promise<T> => {
    const before = last.get(key);
    // Nothing of the key's on its way: sent now
    const next = before ? before.catch(() => {}).then(send) : send();
    last.set(key, next);
    // Done with: the key's queue goes, unless another request joined it meanwhile
    next.then(
      () => last.get(key) === next && last.delete(key),
      () => last.get(key) === next && last.delete(key),
    );
    return next;
  };
}
