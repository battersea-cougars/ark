// A URL slug for a series or a tournament type (apps/team/worker/training/README.md): its name, lower case, unique in its table.
import { first } from "@cougars/shared/d1";

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "item";

export async function freeSlug(db: D1Database, table: string, base: string, id = 0) {
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (slug !== "new" && !(await first(db, `SELECT 1 FROM ${table} WHERE slug = ? AND id != ?`, [slug, id])))
      return slug;
  }
}
