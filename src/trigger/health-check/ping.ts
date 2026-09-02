import { logger, task } from "@trigger.dev/sdk";

/**
 * Scaffold smoke test. Trigger this once to confirm the dev server, project ref,
 * and API key are all wired up correctly. Safe to delete once real tasks exist.
 */
export const ping = task({
  id: "ping",
  run: async (payload: { message?: string }) => {
    logger.log("ping received", { message: payload.message ?? "(none)" });
    return {
      ok: true,
      echo: payload.message ?? "pong",
      at: new Date().toISOString(),
    };
  },
});
