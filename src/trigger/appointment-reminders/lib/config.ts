/**
 * Central env var reading and validation.
 *
 * Deliberately lazy: `getConfig()` is called inside a task's `run()`, never at module
 * load. Trigger.dev imports every task file during bundling/deploy, so a throw at module
 * scope would break the deploy itself rather than failing one run with a clear message.
 *
 * Nothing here ever logs a secret value.
 */

export const TIMEZONE = "Africa/Kampala";

/** East Africa Time is UTC+3 year-round and has never observed DST, so a fixed
 *  offset is exactly correct and avoids Intl timezone gymnastics. */
export const TZ_OFFSET = "+03:00";

/** 2 SMS credits. EgoSMS bills per 160 characters. */
export const MAX_SMS_CHARS = 320;

/**
 * EgoSMS requires a `senderid` on every message, so it cannot simply be omitted.
 * Accounts with no registered sender ID fall back to the platform default — this is
 * the value EgoSMS uses in its own API documentation.
 */
export const DEFAULT_SENDER_ID = "EgoSMS";

export type Config = ReturnType<typeof getConfig>;

export function getConfig() {
  // Collect every missing variable and report them together — discovering them
  // one failed run at a time is a miserable way to set this up.
  const missing: string[] = [];

  const required = (name: string): string => {
    const value = process.env[name];
    if (!value || value.trim() === "") {
      missing.push(name);
      return "";
    }
    return value.trim();
  };

  const optional = (name: string): string | undefined => {
    const value = process.env[name];
    return value && value.trim() !== "" ? value.trim() : undefined;
  };

  const config = {
    google: {
      clientEmail: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
      // dotenv stores the PEM with escaped newlines; without this swap Google
      // rejects the JWT with an opaque `invalid_grant`.
      privateKey: required("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
      sheetId: required("GOOGLE_SHEET_ID"),
      sheetName: required("GOOGLE_SHEET_NAME"),
    },
    egosms: {
      username: required("EGOSMS_USERNAME"),
      password: required("EGOSMS_PASSWORD"),
      // Optional: set this only once you have a registered sender ID.
      senderId: optional("EGOSMS_SENDER_ID") ?? DEFAULT_SENDER_ID,
    },
    openaiApiKey: required("OPENAI_API_KEY"),
    clinicName: required("CLINIC_NAME"),
    /** When set, every recipient is overridden and the sheet is left untouched. */
    testPhoneNumber: optional("TEST_PHONE_NUMBER"),
  };

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        `Add them to .env for local dev, and to the Trigger.dev dashboard ` +
        `(project → Environment Variables) for deployed runs.`,
    );
  }

  if (config.egosms.senderId.length > 11) {
    throw new Error(
      `EGOSMS_SENDER_ID must be 11 characters or fewer (got ${config.egosms.senderId.length}). ` +
        `A full international number such as 256772123456 is 12 characters — use the local ` +
        `form, a short alphanumeric ID, or leave the variable unset to use "${DEFAULT_SENDER_ID}".`,
    );
  }

  return config;
}
