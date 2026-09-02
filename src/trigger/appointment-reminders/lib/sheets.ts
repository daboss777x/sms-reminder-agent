/**
 * Google Sheets access via a service account.
 *
 * Uses google-auth-library only to mint an access token, then native fetch against the
 * Sheets REST API — this avoids pulling in the whole `googleapis` client.
 */

import { JWT } from "google-auth-library";
import type { Config } from "./config.js";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

/** Exact header names from the clinic's sheet. Lookup is by name, never by position,
 *  so reordering or inserting columns cannot make us read (or write) the wrong cell. */
export const COLUMNS = {
  appointmentId: "AppointmentID",
  customerName: "Customer Name",
  phone: "Phone Number",
  animals: "Animal Name(s)",
  date: "Date",
  time: "Time",
  plan: "Consultation Plan",
  reminderSent: "Reminder Sent",
  digestSent: "Digest Sent",
} as const;

export type AppointmentRow = {
  /** 1-based row number in the sheet, used to target the write-back. */
  rowNumber: number;
  appointmentId: string;
  customerName: string;
  phone: string;
  animals: string;
  date: string;
  time: string;
  plan: string;
  reminderSent: string;
  digestSent: string;
};

export type SheetData = {
  rows: AppointmentRow[];
  /** header name -> zero-based column index */
  headerIndex: Map<string, number>;
};

async function getAccessToken(config: Config): Promise<string> {
  const jwt = new JWT({
    email: config.google.clientEmail,
    key: config.google.privateKey,
    scopes: SCOPES,
  });

  const { access_token: token } = await jwt.authorize();
  if (!token) {
    throw new Error("Google auth returned no access token");
  }
  return token;
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA" */
export function columnLetter(index: number): string {
  let n = index;
  let letter = "";
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

function cell(row: string[], index: number | undefined): string {
  if (index === undefined) return "";
  return (row[index] ?? "").trim();
}

export async function readAppointments(config: Config): Promise<SheetData> {
  const token = await getAccessToken(config);
  const range = encodeURIComponent(`${config.google.sheetName}!A:Z`);
  const url = `${SHEETS_API}/${config.google.sheetId}/values/${range}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Sheets read failed (${response.status}). Confirm the sheet is shared with ${config.google.clientEmail} as Editor. ${body}`,
    );
  }

  const data = (await response.json()) as { values?: string[][] };
  const values = data.values ?? [];
  const header = values[0];

  if (!header) {
    throw new Error(
      `Sheet tab "${config.google.sheetName}" is empty — expected a header row`,
    );
  }

  const headerIndex = new Map<string, number>();
  header.forEach((name, i) => headerIndex.set(name.trim(), i));

  const missing = Object.values(COLUMNS).filter((c) => !headerIndex.has(c));
  if (missing.length > 0) {
    throw new Error(
      `Sheet is missing required column(s): ${missing.join(", ")}. Found: ${header.join(", ")}`,
    );
  }

  const rows: AppointmentRow[] = [];
  for (let i = 1; i < values.length; i++) {
    const raw = values[i];
    if (!raw || raw.every((v) => (v ?? "").trim() === "")) continue; // skip blank rows

    rows.push({
      rowNumber: i + 1, // +1 because sheet rows are 1-based and row 1 is the header
      appointmentId: cell(raw, headerIndex.get(COLUMNS.appointmentId)),
      customerName: cell(raw, headerIndex.get(COLUMNS.customerName)),
      phone: cell(raw, headerIndex.get(COLUMNS.phone)),
      animals: cell(raw, headerIndex.get(COLUMNS.animals)),
      date: cell(raw, headerIndex.get(COLUMNS.date)),
      time: cell(raw, headerIndex.get(COLUMNS.time)),
      plan: cell(raw, headerIndex.get(COLUMNS.plan)),
      reminderSent: cell(raw, headerIndex.get(COLUMNS.reminderSent)),
      digestSent: cell(raw, headerIndex.get(COLUMNS.digestSent)),
    });
  }

  return { rows, headerIndex };
}

/**
 * Mark a set of rows in one column, in a single batch request.
 * Only ever called with rows whose SMS actually sent.
 */
export async function markRows(
  config: Config,
  headerIndex: Map<string, number>,
  columnName: string,
  rowNumbers: number[],
  value: string,
): Promise<void> {
  if (rowNumbers.length === 0) return;

  const columnIdx = headerIndex.get(columnName);
  if (columnIdx === undefined) {
    throw new Error(`Cannot write back: column "${columnName}" not found in sheet`);
  }

  const letter = columnLetter(columnIdx);
  const token = await getAccessToken(config);

  const body = {
    valueInputOption: "RAW",
    data: rowNumbers.map((rowNumber) => ({
      range: `${config.google.sheetName}!${letter}${rowNumber}`,
      values: [[value]],
    })),
  };

  const response = await fetch(
    `${SHEETS_API}/${config.google.sheetId}/values:batchUpdate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sheets write-back failed (${response.status}): ${text}`);
  }
}
