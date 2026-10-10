// Dues (ADR 0007): fees, charges, payments and adjustments, and a member's quarterly plan.
import { id, ok, rowOf, type Route } from "../api/api.route";
import {
  addAdjustment,
  addQuarterCharge,
  chargeAttendance,
  chargeQuarters,
  chargeState,
  memberExists,
  payCharge,
  paymentState,
  recordPayment,
  removeCharge,
  removePayment,
  setSubscriptionFee,
  subscriptionFees,
  unpaidOf,
  unpayCharge,
} from "./dues";
import { HttpError, body, json } from "../api/api.http";
import { quarterlyToday, setQuarterly } from "../members/members";

export const DUES_ROUTES: Route[] = [
  {
    method: "POST",
    path: /^\/api\/members\/(\d+)\/quarterly$/,
    audit: {
      event: "member.quarterly",
      subject: (c) => quarterlyToday(c.env.DB, id(c), c.today),
      about: (c) => ({ memberId: id(c) }),
    },
    action: "manage:Member",
    changes: ["members", "charges", "credits", "payments"],
    handle: async (c) => {
      const b = await body(c.request);
      if (typeof b.quarterly !== "boolean") throw new HttpError(400, "quarterly should be true or false.");
      await setQuarterly(c.env.DB, id(c), b.quarterly, c.today, c.now);
      return ok();
    },
  },
  // Dues (ADR 0007)
  {
    method: "POST",
    path: /^\/api\/subscription-fees$/,
    audit: { event: "fees.quarterly", subject: (c) => subscriptionFees(c.env.DB) },
    action: "manage:Fees",
    changes: ["subscriptionFees", "charges", "credits", "payments"],
    // { pence, from }: the quarterly rate from a date
    handle: async (c) => (await setSubscriptionFee(c.env.DB, await body(c.request)), ok()),
  },
  {
    method: "POST",
    path: /^\/api\/members\/(\d+)\/charges$/,
    audit: {
      event: "charge.added",
      subject: async (c, reply) => (reply ? chargeState(c.env.DB, reply.id as number) : null),
      about: (c) => ({ memberId: id(c) }),
    },
    action: "record:Payment",
    changes: ["charges", "credits", "payments"],
    // { quarter: "2026-Q3", pence? }: they owe for a quarter
    handle: async (c) => json(await addQuarterCharge(c.env.DB, id(c), await body(c.request), c.memberId, c.now), 201),
  },
  {
    method: "DELETE",
    path: /^\/api\/charges\/(\d+)$/,
    audit: {
      event: "charge.removed",
      subject: (c) => chargeState(c.env.DB, id(c)),
      about: (c, reply) => ({ memberId: reply.memberId }),
    },
    action: "record:Payment",
    changes: ["charges", "credits", "payments"],
    // A quarter charged by hand by mistake
    handle: async (c) => {
      const was = await chargeState(c.env.DB, id(c));
      await removeCharge(c.env.DB, id(c), c.now);
      return json({ ok: true, memberId: was?.memberId });
    },
  },
  {
    method: "POST",
    path: /^\/api\/charges\/(\d+)\/payment$/,
    audit: {
      event: "charge.paid",
      subject: (c) => chargeState(c.env.DB, id(c)),
      about: (c, reply) => ({ memberId: reply.memberId }),
    },
    action: "record:Payment",
    changes: ["charges", "credits", "payments"],
    // { via: "transfer" | "cash" }: paid
    handle: async (c) => {
      await payCharge(c.env.DB, id(c), await body(c.request), c.memberId, c.now);
      return json({ ok: true, memberId: (await chargeState(c.env.DB, id(c)))?.memberId });
    },
  },
  {
    method: "DELETE",
    path: /^\/api\/charges\/(\d+)\/payment$/,
    audit: {
      event: "charge.paid",
      subject: (c) => chargeState(c.env.DB, id(c)),
      about: (c, reply) => ({ memberId: reply.memberId }),
    },
    action: "record:Payment",
    changes: ["charges", "credits", "payments"],
    // Marked paid by mistake
    handle: async (c) => {
      await unpayCharge(c.env.DB, id(c));
      return json({ ok: true, memberId: (await chargeState(c.env.DB, id(c)))?.memberId });
    },
  },
  {
    method: "POST",
    path: /^\/api\/members\/(\d+)\/adjustments$/,
    audit: {
      event: "dues.adjusted",
      subject: async (_c, reply) => (reply ? { pence: reply.pence, reason: reply.reason, on: reply.on } : null),
      about: (c) => ({ memberId: id(c) }),
    },
    action: "record:Payment",
    changes: ["charges", "credits", "payments"],
    // { pence (above nothing: they owe more; below: less), reason, on? }
    handle: async (c) => json(await addAdjustment(c.env.DB, id(c), await body(c.request), c.memberId, c.now), 201),
  },
  {
    method: "DELETE",
    path: /^\/api\/payments\/(\d+)$/,
    audit: {
      event: "payment.removed",
      subject: (c) => paymentState(c.env.DB, id(c)),
      about: (c, reply) => ({ memberId: reply.memberId }),
    },
    action: "record:Payment",
    changes: ["charges", "credits", "payments"],
    // Recorded by mistake: taken back from the ledger
    handle: async (c) => json({ ok: true, memberId: await removePayment(c.env.DB, id(c)) }),
  },
  {
    method: "POST",
    path: /^\/api\/members\/(\d+)\/recalculate$/,
    audit: {
      event: "dues.recalculated",
      subject: rowOf("SELECT COUNT(*) charges, COALESCE(SUM(amount_pence), 0) pence FROM charges WHERE member_id = ?"),
      about: (c) => ({ memberId: id(c) }),
    },
    action: "record:Payment",
    changes: ["charges", "credits", "payments"],
    // Their dues worked out again from who came and the fees as they are now (the wrapper does it, as after any
    // change to charges); everyone's come out the same way
    // (Here, not only after it, so what it changed is on the record)
    handle: async (c) => {
      await memberExists(c.env.DB, id(c));
      await chargeAttendance(c.env.DB, c.today, c.now);
      await chargeQuarters(c.env.DB, c.today, c.now);
      return ok();
    },
  },
  {
    method: "POST",
    path: /^\/api\/members\/(\d+)\/payments$/,
    audit: {
      event: "member.paid",
      subject: (c) => unpaidOf(c.env.DB, id(c)),
      about: (c) => ({ memberId: id(c) }),
    },
    action: "record:Payment",
    changes: ["charges", "credits", "payments"],
    // { via, pence }: a lump sum, paying the oldest first (FIFO), the rest kept as credit
    handle: async (c) => (await recordPayment(c.env.DB, id(c), await body(c.request), c.memberId, c.now), ok()),
  },
];
