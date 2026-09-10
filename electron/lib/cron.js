/**
 * Drive the background job loop for the standalone desktop app.
 *
 * In cloud deployments Vercel cron hits /api/cron/scheduler and
 * /api/cron/worker every minute. The desktop app has no external cron, so
 * without this loop scheduled briefs and meeting-scheduling negotiations
 * would never run. While the app is open we tick both routes on the local
 * server once a minute (scheduler first so freshly due jobs are picked up
 * by the worker in the same pass).
 */

async function tick(port, secret, path) {
  const resp = await fetch(`http://localhost:${port}${path}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`${path} -> ${resp.status} ${body.slice(0, 200)}`);
  }
  return resp.json();
}

function startCronLoop({ port, secret, intervalMs = 60_000, log }) {
  let inFlight = false;
  let stopped = false;

  const run = async () => {
    if (inFlight || stopped) return;
    inFlight = true;
    try {
      await tick(port, secret, "/api/cron/scheduler");
      const worker = await tick(port, secret, "/api/cron/worker");
      const stats = worker && worker.result;
      if (stats && stats.claimed > 0) {
        log(
          `[cron] worker: claimed=${stats.claimed} done=${stats.done} failed=${stats.failed}`,
        );
      }
    } catch (err) {
      // Transient failures are fine; the next tick retries.
      log("[cron] tick failed:", err && err.message);
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(run, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  run();

  return {
    /** Catch-up tick, e.g. right after the machine wakes from sleep
     *  (timers don't fire while macOS has the app suspended). */
    runNow: run,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

module.exports = { startCronLoop };
