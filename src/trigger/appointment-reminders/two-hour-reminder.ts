import { schedules } from "@trigger.dev/sdk";
import { runReminders } from "./lib/run-reminders.js";

/**
 * Hourly: text every customer whose appointment is roughly two hours away.
 * Tracked in the "Reminder Sent" column.
 */
export const twoHourReminder = schedules.task({
  id: "two-hour-reminder",
  cron: {
    pattern: "0 * * * *",
    timezone: "Africa/Kampala",
    // Production only — see the note in daily-digest.ts. This one is hourly, so
    // a dev server left running would fire it 24 times a day.
    environments: ["PRODUCTION"],
  },
  run: async () => {
    return await runReminders("two-hour");
  },
});
