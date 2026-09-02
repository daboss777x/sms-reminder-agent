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
    // Production only. The default is every environment, which would make this
    // fire on its own whenever a local `trigger.dev dev` server happens to be
    // running — sending real SMS from a developer's laptop. Test runs should be
    // triggered deliberately, never by a cron nobody was watching.
    environments: ["PRODUCTION"],
  },
  run: async () => {
    return await runReminders("digest");
  },
});
