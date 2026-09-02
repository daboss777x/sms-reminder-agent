import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  // Replace with the project ref from cloud.trigger.dev → your project → Settings.
  // Looks like: proj_abcdefghijklmnop
  project: "proj_itvxfqhfmxjrhpzcyvhm",
  runtime: "node",
  logLevel: "log",
  // Default retry policy for every task; override per-task where needed.
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 30_000,
      randomize: true,
    },
  },
  maxDuration: 300, // seconds
  dirs: ["./src/trigger"],
});
