import type { StructureBuilder, StructureResolver } from "sanity/structure";

// Singleton documents: one each, with a fixed _id equal to the type name (the website and the team app find
// them by it).
export const SINGLETONS = new Set(["club", "fridays", "pub", "team", "kumite"]);

// Not edited here, so not shown: events and players are the club's data, kept in the team app (ADR 0042, ADR 0043),
// and videos come from the club's YouTube playlists (Club → YouTube playlists, ADR 0016). The types stay in the schema
// so the website's queries still read (and find none), but they're off the sidebar and the "New document" menu.
export const NOT_EDITED_HERE = new Set(["event", "player", "video"]);

const singleton = (S: StructureBuilder, type: string, title: string) =>
  S.listItem().title(title).id(type).child(S.document().schemaType(type).documentId(type).title(title));

// Sidebar in the order a club volunteer thinks about it: the Friday night first, the rarely-changed basics last.
export const structure: StructureResolver = (S) =>
  S.list()
    .title("Cougars website")
    .items([
      singleton(S, "fridays", "Fridays"),
      singleton(S, "pub", "Pub"),
      S.listItem()
        .title("Kumite")
        .id("kumite-folder")
        .child(
          S.list()
            .title("Kumite")
            .items([singleton(S, "kumite", "About the Kumite")]),
        ),
      singleton(S, "team", "About the team"),
      S.divider(),
      singleton(S, "club", "Club"),
      S.documentTypeListItem("sponsor").title("Sponsors"),
    ]);
