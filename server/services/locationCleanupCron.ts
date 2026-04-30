import { cleanupStaleLocationPermissions } from "./locationPermissionStore";

let cronInterval: NodeJS.Timeout | null = null;

export function startLocationCleanupCron() {
  const ONE_HOUR = 60 * 60 * 1000;

  const runCleanup = async () => {
    try {
      const deleted = await cleanupStaleLocationPermissions();
      if (deleted > 0) {
        console.log(`[LocationCleanup] Removed ${deleted} stale location permission record(s)`);
      }
    } catch (err) {
      console.error('[LocationCleanup] Cleanup failed:', err);
    }
  };

  runCleanup();

  cronInterval = setInterval(runCleanup, ONE_HOUR);
  console.log('[LocationCleanup] Hourly cleanup cron started');
}

export function stopLocationCleanupCron() {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
    console.log('[LocationCleanup] Hourly cleanup cron stopped');
  }
}
