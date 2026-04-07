import { storage } from '../storage';
import type { MileageReimbursement } from '@shared/schema';

const METERS_PER_MILE = 1609.344;

export async function postMileageReimbursement(sessionId: string): Promise<{
  created: boolean;
  reason?: string;
  reimbursement?: MileageReimbursement;
}> {
  try {
    const existing = await storage.getMileageReimbursementBySession(sessionId);
    if (existing) {
      return { created: false, reason: 'already_exists' };
    }

    const session = await storage.getOffsiteSession(sessionId);
    if (!session) {
      return { created: false, reason: 'session_not_found' };
    }

    if (!session.ruleId) {
      return { created: false, reason: 'no_rule' };
    }

    const rule = await storage.getOffsiteRule(session.ruleId);
    if (!rule) {
      return { created: false, reason: 'rule_not_found' };
    }

    let rateCents = rule.mileageRateCents || 0;

    if (rateCents <= 0) {
      const companySettings = await storage.getCompanySettings();
      if (companySettings && companySettings.defaultMileageRateCents) {
        rateCents = companySettings.defaultMileageRateCents;
      }
    }

    const user = await storage.getUser(session.userId);
    if (user && user.mileageRateCentsOverride != null) {
      rateCents = user.mileageRateCentsOverride;
    }

    if (rateCents <= 0) {
      return { created: false, reason: 'no_mileage_rate' };
    }

    const distanceMeters = session.routeDistanceMeters;
    if (!distanceMeters || distanceMeters <= 0) {
      return { created: false, reason: 'no_distance' };
    }

    const milesDecimal = distanceMeters / METERS_PER_MILE;

    const totalCents = Math.round(milesDecimal * rateCents);

    if (totalCents <= 0) {
      return { created: false, reason: 'zero_amount' };
    }

    const hourlyRate = user ? parseFloat(String(user.hourlyRate || '0')) : 0;

    let equivalentMinutes = 0;
    if (hourlyRate > 0) {
      const totalDollars = totalCents / 100;
      equivalentMinutes = Math.round((totalDollars / hourlyRate) * 60);
    }

    const reimbursement = await storage.createMileageReimbursement({
      sessionId,
      timeEntryId: session.timeEntryId || null,
      userId: session.userId,
      milesDecimal: String(milesDecimal),
      rateCents,
      totalCents,
      equivalentMinutes,
      adjustedBy: null,
      adjustedAt: null,
      adjustedMilesDecimal: null,
    });

    if (session.timeEntryId) {
      const entry = await storage.getTimeEntry(session.timeEntryId);
      if (entry) {
        const currentMileageMinutes = Number(entry.mileageMinutes) || 0;
        const currentMileageCents = Number(entry.mileageTotalCents) || 0;
        await storage.updateTimeEntry(session.timeEntryId, {
          mileageMinutes: currentMileageMinutes + equivalentMinutes,
          mileageTotalCents: currentMileageCents + totalCents,
        });
      }
    }

    console.log(`[Mileage] Created reimbursement for session ${sessionId}: ${milesDecimal.toFixed(2)} mi × $${(rateCents / 100).toFixed(2)}/mi = $${(totalCents / 100).toFixed(2)} (+${equivalentMinutes} min)`);

    return { created: true, reimbursement };
  } catch (error) {
    console.error('[Mileage] Error posting reimbursement:', error);
    throw error;
  }
}
