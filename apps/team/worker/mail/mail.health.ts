// How each email went, written down as it's sent (MailConfig.onOutcome, @cougars/shared/mail-health), for Settings →
// Email and the admins' Home (ADR 0027). The send that finds Google has cancelled the token tells the admins' phones,
// once: nobody can sign in until one of them reconnects it.
import { all } from "@cougars/shared/d1";
import type { MailOutcome } from "@cougars/shared/email";
import { recordMail } from "@cougars/shared/mail-health";
import { notify, type PushEnv } from "../push/push";

/** Who looks after the email: whoever sets the club's settings. */
export async function mailKeepers(db: D1Database): Promise<number[]> {
  const rows = await all<{ id: number }>(
    db,
    `SELECT DISTINCT m.id FROM members m
       JOIN member_roles mr ON mr.member_id = m.id JOIN role_actions ra ON ra.role_id = mr.role_id
     WHERE m.status = 'active' AND ra.action IN ('manage:Settings', 'manage:all')`,
  );
  return rows.map((r) => r.id);
}

export async function mailOutcome(env: PushEnv, outcome: MailOutcome, now = new Date()): Promise<void> {
  if ((await recordMail(env.DB, outcome, now)) !== "cancelled") return;
  await notify(
    env,
    [
      {
        to: await mailKeepers(env.DB),
        topic: "email",
        // Nobody can get a code until it's fixed, so it can't wait for the morning
        key: "email:stopped",
        live: true,
        title: "Email has stopped",
        body: "Google cancelled the app's access, so nobody gets a sign-in code. Reconnect it in Settings → Email.",
        path: "/settings/email",
      },
    ],
    now,
  );
}
