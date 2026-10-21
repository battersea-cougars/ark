// You: your own profile, next quarter's plan, the role the app opens as (ADR 0024, ADR 0007), and your data: download
// it, or delete your account (#30).
import { ok, type Route } from "../api/api.route";
import { body } from "../api/api.http";
import { choosePlan, memberStanding, planNext, setEverydayRole, updateProfile } from "./members";
import { eraseMember, memberData } from "./members.erase";
import { endLive } from "../live/live";

export const ME_ROUTES: Route[] = [
  {
    method: "GET",
    path: /^\/api\/me\/data$/,
    action: "authenticated",
    // Everything the app holds about you, as a file to keep
    handle: async (c) => memberData(c.env.DB, c.memberId, c.today),
  },
  {
    method: "DELETE",
    path: /^\/api\/me$/,
    // On the record as a change of standing only: nothing that says who they were
    audit: {
      event: "member.erased",
      subject: (c) => memberStanding(c.env.DB, c.memberId),
      about: (c) => ({ memberId: c.memberId }),
    },
    action: "authenticated",
    changes: ["members"],
    // Delete your account: you're signed out everywhere, and the club keeps only what it must, about nobody
    handle: async (c) => {
      await eraseMember(c.env.DB, c.memberId, c.today, c.now);
      await endLive(c.env, { memberId: c.memberId });
      return ok();
    },
  },
  {
    method: "PUT",
    path: /^\/api\/me$/,
    audit: { none: "a member's own profile (position, phone, bio): theirs to change" },
    action: "authenticated",
    changes: ["members"],
    // Your own phone, position and bio
    handle: async (c) => (await updateProfile(c.env.DB, c.memberId, await body(c.request)), ok()),
  },
  {
    method: "PUT",
    path: /^\/api\/me\/plan$/,
    audit: {
      event: "member.plan",
      subject: (c) => planNext(c.env.DB, c.memberId, c.today),
      about: (c) => ({ memberId: c.memberId }),
    },
    action: "authenticated",
    changes: ["members"],
    // { quarter: "2027-Q1", quarterly }: next quarter's plan, until it starts
    handle: async (c) => (await choosePlan(c.env.DB, c.memberId, await body(c.request), c.today, c.now), ok()),
  },
  {
    method: "PUT",
    path: /^\/api\/me\/everyday-role$/,
    audit: { none: "the role a member's own app opens as: theirs to choose, within what they may do" },
    action: "authenticated",
    changes: ["everydayRole"],
    // { roleId: number | null }: the role the app opens as (ADR 0024)
    handle: async (c) => (await setEverydayRole(c.env.DB, c.memberId, await body(c.request), c.actions), ok()),
  },
];
