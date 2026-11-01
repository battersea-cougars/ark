// What a live route may be sent (#73): read up to `max` bytes and no more, so a huge body costs the Worker nothing.
// The size it says it is counts first; one that says nothing is counted as it comes. The team app's API does the same
// (apps/team/worker/api/api.http.ts withinLimit).

/** The request with its body read, or null once it's over `max` bytes. */
export async function withinLimit(request: Request, max: number): Promise<Request | null> {
  if (!request.body) return request;
  if (Number(request.headers.get("content-length") ?? 0) > max) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return new Request(request, { body: bytes });
}
