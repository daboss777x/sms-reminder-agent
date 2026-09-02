/**
 * The shared reminder pipeline. Both schedules call this with a different window
 * and a different tracking column.
 */

import { logger } from "@trigger.dev/sdk";
import { getConfig, TZ_OFFSET, type Config } from "./config.js";
import { COLUMNS, markRows, readAppointments, type AppointmentRow } from "./sheets.js";
import { normalizePhone, sendSms } from "./egosms.js";
import { draftMessage, type Stage } from "./draft-message.js";

const HOUR_MS = 60 * 60 * 1000;

/** Today's date in Kampala as YYYY-MM-DD. Safe because EAT is UTC+3 with no DST. */
export function kampalaToday(now: Date): string {
  return new Date(now.getTime() + 3 * HOUR_MS).toISOString().slice(0, 10);
}

/** Accepts YYYY-MM-DD (preferred) and DD/MM/YYYY. */
function normalizeDate(raw: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return raw;

  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (slashed) {
    const [, d, m, y] = slashed;
    return `${y}-${(m as string).padStart(2, "0")}-${(d as string).padStart(2, "0")}`;
  }

  return null;
}

/** Accepts "14:30", "9:05", "14:30:00", "2:30 PM". */
function normalizeTime(raw: string): string | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(raw.trim());
  if (!match) return null;

  const [, h, m, s, meridiem] = match;
  let hour = Number(h);
  if (meridiem) {
    const isPm = meridiem.toLowerCase() === "pm";
    if (hour === 12) hour = isPm ? 12 : 0;
    else if (isPm) hour += 12;
  }
  if (hour > 23 || Number(m) > 59) return null;

  return `${String(hour).padStart(2, "0")}:${m}:${s ?? "00"}`;
}

/** Epoch ms for an appointment, interpreting the sheet's date/time as Kampala local. */
export function appointmentInstant(date: string, time: string): number | null {
  const d = normalizeDate(date);
  const t = normalizeTime(time);
  if (!d || !t) return null;

  const ms = Date.parse(`${d}T${t}${TZ_OFFSET}`);
  return Number.isNaN(ms) ? null : ms;
}

/** Keep PII out of logs while still showing that normalisation worked. */
function maskPhone(number: string): string {
  return `${number.slice(0, 6)}***${number.slice(-3)}`;
}

/**
 * The tracking columns are populated with "No" rather than left blank, so an
 * emptiness check would treat every unsent row as already sent. Only an
 * affirmative value counts as sent.
 */
export function isSent(value: string): boolean {
  return /^(yes|y|true|1|sent|done)$/i.test(value.trim());
}

type StageSpec = {
  column: string;
  alreadySent: (row: AppointmentRow) => boolean;
  window: (now: Date) => { from: number; to: number; label: string };
};

const STAGES: Record<Stage, StageSpec> = {
  digest: {
    column: COLUMNS.digestSent,
    alreadySent: (row) => isSent(row.digestSent),
    window: (now) => ({
      from: now.getTime(),
      to: Date.parse(`${kampalaToday(now)}T23:59:59${TZ_OFFSET}`),
      label: "now until end of today (Kampala)",
    }),
  },
  "two-hour": {
    column: COLUMNS.reminderSent,
    alreadySent: (row) => isSent(row.reminderSent),
    // Everything happening within the next 2 hours. Consecutive hourly runs
    // overlap by design (an appointment 90 minutes out is in this window and the
    // next one), so the "Reminder Sent" column is what prevents a second send —
    // it is load-bearing here, not just a retry backstop. The inclusive upper
    // bound means a customer is reminded at the earliest qualifying run, i.e. as
    // close to a full 2 hours ahead as the hourly cadence allows.
    window: (now) => ({
      from: now.getTime(),
      to: now.getTime() + 2 * HOUR_MS,
      label: "now until 2 hours from now",
    }),
  },
};

export type RunSummary = {
  stage: Stage;
  scanned: number;
  matched: number;
  sent: number;
  failed: number;
  skipped: number;
  testMode: boolean;
};

export async function runReminders(stage: Stage): Promise<RunSummary> {
  const config: Config = getConfig();
  const spec = STAGES[stage];
  const now = new Date();
  const { from, to, label } = spec.window(now);
  const testMode = config.testPhoneNumber !== undefined;

  if (testMode) {
    logger.warn("TEST MODE: all messages redirected, sheet will NOT be updated", {
      redirectTo: maskPhone(config.testPhoneNumber as string),
    });
  }

  const { rows, headerIndex } = await readAppointments(config);

  logger.log("Scanning appointments", {
    stage,
    window: label,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    totalRows: rows.length,
  });

  const due: AppointmentRow[] = [];
  for (const row of rows) {
    if (spec.alreadySent(row)) continue;

    const instant = appointmentInstant(row.date, row.time);
    if (instant === null) {
      logger.warn("Skipping row with unparseable date/time", {
        row: row.rowNumber,
        appointmentId: row.appointmentId,
        date: row.date,
        time: row.time,
      });
      continue;
    }

    if (instant >= from && instant <= to) due.push(row);
  }

  logger.log(`${due.length} appointment(s) due for the ${stage} send`);

  const succeeded: number[] = [];
  let failed = 0;
  let skipped = 0;

  // Sequential on purpose: clinic volume is tens per day, and this keeps us well
  // clear of gateway rate limits while producing a readable log.
  for (const row of due) {
    try {
      const number = normalizePhone(row.phone);
      if (!number) {
        logger.warn("Skipping row with an invalid phone number", {
          row: row.rowNumber,
          appointmentId: row.appointmentId,
          value: row.phone,
        });
        skipped++;
        continue;
      }

      const draft = await draftMessage(config, row, stage);
      const recipient = config.testPhoneNumber ?? number;

      logger.log("Sending reminder", {
        row: row.rowNumber,
        appointmentId: row.appointmentId,
        to: maskPhone(recipient),
        intendedFor: testMode ? maskPhone(number) : undefined,
        chars: draft.text.length,
        draftSource: draft.source,
        message: draft.text,
      });

      const result = await sendSms(config, recipient, draft.text);

      if (result.ok) {
        succeeded.push(row.rowNumber);
        logger.log("Sent", {
          row: row.rowNumber,
          cost: result.cost,
          trackingCode: result.trackingCode,
        });
      } else {
        failed++;
        logger.error("Send failed — row left unmarked so the next run retries it", {
          row: row.rowNumber,
          appointmentId: row.appointmentId,
          error: result.error,
        });
      }
    } catch (error) {
      // One bad row must never abort the whole run.
      failed++;
      logger.error("Unexpected error processing row", {
        row: row.rowNumber,
        appointmentId: row.appointmentId,
        error: (error as Error).message,
      });
    }
  }

  if (succeeded.length > 0) {
    if (testMode) {
      logger.warn("Test mode — not writing to the sheet", {
        wouldHaveMarked: succeeded,
        column: spec.column,
      });
    } else {
      await markRows(config, headerIndex, spec.column, succeeded, "Yes");
      logger.log(`Marked ${succeeded.length} row(s) as "${spec.column}: Yes"`);
    }
  }

  return {
    stage,
    scanned: rows.length,
    matched: due.length,
    sent: succeeded.length,
    failed,
    skipped,
    testMode,
  };
}
