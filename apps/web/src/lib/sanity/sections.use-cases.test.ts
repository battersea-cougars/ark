// Which parts of the website are on, as the build asks (getSections in content.ts): the team and the Kumite are
// switches in the Studio, off until the team manager turns them on. The Studio is faked: its answer to the club facts.
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("astro:env/server", () => ({
  SANITY_PROJECT_ID: "club",
  SANITY_DATASET: "production",
  SANITY_API_TOKEN: undefined,
  DEMO_CONTENT: false,
  YOUTUBE_API_KEY: undefined,
}));

/** The website's build, with the Studio's team and Kumite switches as given (null: never ticked). */
async function built(switches: { team: boolean | null; kumite: boolean | null }, { onMachine = false } = {}) {
  vi.resetModules();
  vi.stubEnv("ENV_RIBBON", onMachine ? JSON.stringify({ env: "LOCAL" }) : "");
  vi.stubGlobal("fetch", async () =>
    Response.json({ result: { team: { onWebsite: switches.team }, kumite: { onWebsite: switches.kumite } } }),
  );
  const { getSections } = await import("./content");
  return getSections();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("the website's sections", () => {
  it("the team and the Kumite are on only once they're switched on in the Studio", async () => {
    expect(await built({ team: null, kumite: null })).toMatchObject({ team: false, kumite: false });
    expect(await built({ team: true, kumite: false })).toMatchObject({ team: true, kumite: false });
    expect(await built({ team: false, kumite: true })).toMatchObject({ team: false, kumite: true });
  });

  it("the results are on while the Kumite is", async () => {
    expect((await built({ team: false, kumite: true })).results).toBe(true);
  });

  it("the results are on while there are results to show, even with the Kumite off", async () => {
    const { sectionsOf } = await import("./content");
    expect(sectionsOf({ team: false, kumite: false }, 1)).toEqual({ team: false, kumite: false, results: true });
    expect(sectionsOf({ team: false, kumite: false }, 0).results).toBe(false);
  });

  it("on your machine every section is on, whatever the Studio says, so each can be looked at", async () => {
    expect(await built({ team: false, kumite: false }, { onMachine: true })).toEqual({
      team: true,
      kumite: true,
      results: true,
    });
  });

  it("a section that's off has no page, so its address is not found", () => {
    for (const section of ["team", "kumite", "results"])
      expect(read(`../../pages/${section}/[...page].astro`)).toContain(`(await getSections()).${section} ?`);
  });

  it("there's no news: no page for it, nor a type in the Studio", () => {
    expect(readdirSync(new URL("../../pages/", import.meta.url))).not.toContain("news");
    expect(readdirSync(new URL("../../../../studio/schemaTypes/", import.meta.url)).join()).not.toMatch(/post|news/);
  });
});
