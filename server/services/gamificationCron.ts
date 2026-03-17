import { gamificationService } from './gamificationService';

let cronInterval: NodeJS.Timeout | null = null;

export function startGamificationCron() {
  const FIFTEEN_MINUTES = 15 * 60 * 1000;

  cronInterval = setInterval(async () => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();

    if (hours === 2 && minutes < 15) {
      try {
        console.log('[Gamification] Running nightly score snapshot...');
        await gamificationService.saveScoreSnapshots();
        console.log('[Gamification] Nightly snapshot complete');
      } catch (err) {
        console.error('[Gamification] Nightly snapshot failed:', err);
      }
    }
  }, FIFTEEN_MINUTES);

  console.log('[Gamification] Nightly cron started (checks every 15 minutes, runs at 2am)');
}

export function stopGamificationCron() {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
    console.log('[Gamification] Nightly cron stopped');
  }
}
