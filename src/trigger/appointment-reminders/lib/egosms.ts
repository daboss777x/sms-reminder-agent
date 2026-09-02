/**
 * EgoSMS gateway client.
 *
 * API contract (EgoSMS official docs):
 *   POST https://comms.egosms.co/api/v1/json/
 *   { "method": "SendSms",
 *     "userdata": { "username": <api username>, "password": <API KEY> },
 *     "msgdata": [{ "number": "256772123456", "message": ...,
 *                   "senderid": ..., "priority": "0" }] }
 *
 * Auth goes in the body, not a header. Note that `password` takes the account's
 * API KEY, not the web login password.
 */

import type { Config } from "./config.js";

const EGOSMS_URL = "https://comms.egosms.co/api/v1/json/";

/**
 * Pack a phone number into the format EgoSMS expects: country code, digits only, no `+`.
 *
 *   0772123456      -> 256772123456
 *   +256 772 123456 -> 256772123456
 *   772123456       -> 256772123456
 *   00256772123456  -> 256772123456
 *
 * Returns null for anything that isn't a valid Ugandan mobile number, so the caller
 * can skip the row rather than hand the gateway something it will silently drop.
 */
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits === "") return null;

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  if (digits.startsWith("256")) {
    // already country-coded
  } else if (digits.startsWith("0")) {
    digits = `256${digits.slice(1)}`;
  } else if (digits.length === 9) {
    digits = `256${digits}`;
  } else {
    return null;
  }

  // Ugandan mobile numbers are 256 + 9 digits.
  return /^256\d{9}$/.test(digits) ? digits : null;
}

export type SendResult =
  | { ok: true; cost?: string | number; trackingCode?: string }
  | { ok: false; error: string };

type EgoSmsResponse = {
  Status?: string;
  // The gateway returns Cost as a number in practice, despite the docs showing a string.
  Cost?: string | number;
  MsgFollowUpUniqueCode?: string;
  Message?: string;
};

export async function sendSms(
  config: Config,
  number: string,
  message: string,
): Promise<SendResult> {
  let response: Response;
  try {
    response = await fetch(EGOSMS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "SendSms",
        userdata: {
          username: config.egosms.username,
          password: config.egosms.password,
        },
        msgdata: [
          {
            number,
            message,
            senderid: config.egosms.senderId,
            priority: "0",
          },
        ],
      }),
    });
  } catch (error) {
    return {
      ok: false,
      error: `Network error reaching EgoSMS: ${(error as Error).message}`,
    };
  }

  const text = await response.text();

  if (!response.ok) {
    return { ok: false, error: `EgoSMS HTTP ${response.status}: ${text}` };
  }

  // The gateway returns HTTP 200 even when the send fails, so the body is
  // what actually determines success.
  let parsed: EgoSmsResponse;
  try {
    parsed = JSON.parse(text) as EgoSmsResponse;
  } catch {
    return { ok: false, error: `EgoSMS returned non-JSON body: ${text}` };
  }

  if (parsed.Status?.toUpperCase() === "OK") {
    return {
      ok: true,
      cost: parsed.Cost,
      trackingCode: parsed.MsgFollowUpUniqueCode,
    };
  }

  // These two are operational, not code bugs — surface them verbatim so the
  // fix (top up the account / correct the credentials) is obvious from the log.
  const detail = parsed.Message ?? text;
  return { ok: false, error: `EgoSMS rejected the send: ${detail}` };
}
