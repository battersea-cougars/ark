import { ribbonFor } from "@cougars/shared/ribbon";

// Which copy of the app this is (ADR 0010): deploy.yml builds it with VITE_SITE_ENV (dev or production); your machine's
// dev server has none and is Vite's DEV. A build on your machine without VITE_SITE_ENV shows nothing, as production.
export const ribbon = ribbonFor(import.meta.env.VITE_SITE_ENV, import.meta.env.DEV);
