// Who asked for a Sanity read in `astro dev` (ADR 0116): the middleware runs each request inside this, and
// sanity-live.ts logs every read with it, so the next spike points at its source (a page, a headless browser, a loop).
import { AsyncLocalStorage } from "node:async_hooks";

export const asking = new AsyncLocalStorage<{ route: string; userAgent: string | null }>();
