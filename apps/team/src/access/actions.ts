// The action catalog (ADR 0024). Every route and API handler declares one of these, `authenticated` or
// `anonymous`. Roles are data: sets of actions an admin ticks in the app. `manage:all` means everything.

// Each action has a name people read and a line on what it lets them do; the key is what the code checks.
export const ACTIONS = {
  "read:Event": { name: "See events", description: "See the calendar and what's on" },
  "signup:Event": { name: "Sign up", description: "Say in or out for events" },
  "create:Event": { name: "Add events", description: "Add events to the calendar" },
  "update:Event": { name: "Edit events", description: "Edit, move or cancel events" },
  "record:Attendance": { name: "Run the register", description: "Tick people in on the night" },
  "manage:Training": { name: "Set up trainings", description: "Days, times and venue for trainings" },
  "manage:Tournament": { name: "Set up tournaments", description: "Tournaments and their dates" },
  "manage:Venue": { name: "Save venues", description: "Name, address and map link" },
  "generate:Teams": { name: "Make teams", description: "Generate and adjust teams" },
  "publish:Teams": { name: "Publish teams", description: "Put the teams out for everyone to see" },
  "read:Dues": { name: "See unpaid fees", description: "Unpaid fees: who owes what" },
  "manage:Fees": { name: "Set fees", description: "What each session or period costs" },
  "record:Payment": { name: "Record payments", description: "Mark what someone has paid" },
  "score:Match": { name: "Score games", description: "Score Kumite games" },
  "run:Draft": { name: "Run a draft", description: "Run a Kumite draft" },
  "pick:Draft": { name: "Pick in a draft", description: "Pick players in a draft (captains only)" },
  "read:Usage": { name: "See usage", description: "The club's free Cloudflare allowance" },
  "read:Errors": { name: "See errors", description: "The apps' recent errors, from Sentry" },
  "manage:Settings": { name: "Live updates", description: "How often live pages check for updates" },
  "upload:Photo": { name: "Upload photos", description: "Upload photos" },
  "upload:Video": { name: "Upload videos", description: "Upload videos (on YouTube)" },
  "publish:Media": { name: "Publish media", description: "Publish photos and videos" },
  "read:Rating": { name: "See ratings", description: "See player ratings" },
  "manage:Member": { name: "Manage members", description: "Approve and edit members" },
  "impersonate:Member": { name: "View as a member", description: "View the app as a member (read-only)" },
  "manage:Role": { name: "Edit roles", description: "Edit roles and what they can do" },
  "read:Audit": { name: "See the audit log", description: "Who changed what, and when" },
  "edit:Content": { name: "Edit the website", description: "Edit website content" },
  "manage:Quip": { name: "Edit quips", description: "The quips Home says when you sign up" },
  "post:Announcement": { name: "Post announcements", description: "A note at the top of everyone's Home" },
  "manage:all": { name: "Everything", description: "Can do everything" },
} as const satisfies Record<string, { name: string; description: string }>;

export type Action = keyof typeof ACTIONS;
export type Requirement = Action | "authenticated" | "anonymous";

export const can = (granted: ReadonlySet<Action>, needed: Requirement | undefined): boolean =>
  needed === undefined ||
  needed === "anonymous" ||
  needed === "authenticated" ||
  granted.has("manage:all") ||
  granted.has(needed);

/** Group actions by subject ("Event", "Teams", ...) for the Roles screen. */
export function actionsBySubject(): [string, Action[]][] {
  const groups = new Map<string, Action[]>();
  for (const action of Object.keys(ACTIONS) as Action[]) {
    const subject = action.split(":")[1];
    groups.set(subject, [...(groups.get(subject) ?? []), action]);
  }
  return [...groups];
}
