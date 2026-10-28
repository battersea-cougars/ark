// The club's settings for the app (ADR 0072): one row. For now, how often live pages (a game being scored, the
// tournament's home, the draft room) check for updates. Each check is a request against the club's free daily
// allowance, so it's the admins' call: faster feels live, slower lasts the day. No row yet means the default. And the
// club's bank details (ADR 0007), where members pay: on every member's Dues page and in reminders; and how many days
// before a quarter its Quarterly Members are told its fee is due (#187).
import { first, run } from "@cougars/shared/d1";
import { HttpError, int } from "../api/api.http";

export const LIVE_REFRESH_DEFAULT = 10;
export const LIVE_REFRESH_MIN = 5;
export const LIVE_REFRESH_MAX = 120;
/** Days before a quarter starts that its Quarterly Members are told (dues/plan-reminders.ts): five unless set. */
export const PLAN_REMINDER_DAYS = { default: 5, min: 1, max: 30 } as const;

/** Where members pay by transfer. The sort code as a bank prints it, 12-34-56. */
export interface Bank {
  name: string;
  sortCode: string;
  account: string;
}

export interface Settings {
  liveRefreshSeconds: number;
  /** Null until whoever sets fees fills them in: no reminder goes out without them. */
  bank: Bank | null;
  /** How many days before a quarter starts its Quarterly Members are told its fee is due. */
  planReminderDays: number;
}

export interface SettingsRow {
  live_refresh_seconds: number;
  bank_name: string | null;
  bank_sort_code: string | null;
  bank_account: string | null;
  plan_reminder_days: number;
}

/** The bank details in a settings row, if they're all there. */
export const bankFrom = (r: Partial<SettingsRow> | null | undefined): Bank | null =>
  r?.bank_name && r.bank_sort_code && r.bank_account
    ? {
        name: r.bank_name,
        sortCode: r.bank_sort_code.replace(/^(\d\d)(\d\d)(\d\d)$/, "$1-$2-$3"),
        account: r.bank_account,
      }
    : null;

/** The club's settings as read (api.club.ts): its one row, or the defaults before anyone has set them. */
export function settingsFrom(rows: SettingsRow[]): Settings {
  return {
    liveRefreshSeconds: rows[0]?.live_refresh_seconds ?? LIVE_REFRESH_DEFAULT,
    bank: bankFrom(rows[0]),
    planReminderDays: rows[0]?.plan_reminder_days ?? PLAN_REMINDER_DAYS.default,
  };
}

/** { name, sortCode, account }: where members pay. A UK sort code is six digits and an account number eight. */
export async function saveBank(db: D1Database, o: Record<string, unknown>) {
  const text = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim().replace(/\s+/g, " ") : "");
  const name = text("name");
  const sortCode = text("sortCode").replace(/[\s-]/g, "");
  const account = text("account").replace(/\s/g, "");
  if (!name || name.length > 60) throw new HttpError(400, "The account's name, as the bank has it (up to 60 letters).");
  if (!/^\d{6}$/.test(sortCode)) throw new HttpError(400, "A sort code is six digits, like 12-34-56.");
  if (!/^\d{8}$/.test(account)) throw new HttpError(400, "An account number is eight digits.");
  await run(
    db,
    `INSERT INTO club_settings (id, bank_name, bank_sort_code, bank_account) VALUES (1, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET bank_name = excluded.bank_name, bank_sort_code = excluded.bank_sort_code,
       bank_account = excluded.bank_account`,
    [name, sortCode, account],
  );
}

export async function saveSettings(db: D1Database, o: Record<string, unknown>) {
  const seconds = int(o, "liveRefreshSeconds", { min: LIVE_REFRESH_MIN, max: LIVE_REFRESH_MAX })!;
  await run(
    db,
    `INSERT INTO club_settings (id, live_refresh_seconds) VALUES (1, ?)
     ON CONFLICT (id) DO UPDATE SET live_refresh_seconds = excluded.live_refresh_seconds`,
    [seconds],
  );
}

/** { days }: how many days before a quarter starts its Quarterly Members are told its fee is due (#187). */
export async function savePlanReminder(db: D1Database, o: Record<string, unknown>) {
  const days = int(o, "days", { min: PLAN_REMINDER_DAYS.min, max: PLAN_REMINDER_DAYS.max })!;
  await run(
    db,
    `INSERT INTO club_settings (id, plan_reminder_days) VALUES (1, ?)
     ON CONFLICT (id) DO UPDATE SET plan_reminder_days = excluded.plan_reminder_days`,
    [days],
  );
}

/** The lead time as the record keeps it, before and after a change. */
export const planReminderDays = async (db: D1Database) => ({
  days:
    (await first<{ days: number }>(db, "SELECT plan_reminder_days days FROM club_settings WHERE id = 1"))?.days ??
    PLAN_REMINDER_DAYS.default,
});
