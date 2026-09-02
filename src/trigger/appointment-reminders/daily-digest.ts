import { schedules } from "@trigger.dev/sdk";
import { runReminders } from "./lib/run-reminders.js";

/**
 * 07:00 Kampala every morning: text every customer whose appointment falls later today.
 * Tracked in the "Digest Sent" column.
 */
export const dailyDigest = schedules.task({
  id: "daily-digest",
  cron: {
    pattern: "0 7 * * *",
    // Without this the schedule runs in UTC and would fire at 10:00 Kampala time.
    timezone: "Africa/Kampala",
  },
  run: async () => {
    return await runReminders("digest");
  },
});
