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
  },
  run: async () => {
    return await runReminders("two-hour");
  },
});
