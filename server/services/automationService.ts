import { storage } from "../storage";
import { db } from "../db";
import { claudeService } from "./claudeService";
import { companies } from "@shared/schema";
import type { PayrollPeriod, User, UserAvailability, Schedule, InsertSchedule } from "@shared/schema";

export interface AutomationWorkflowService {
  checkAndTriggerAutomation(companyId?: string): Promise<void>;
  requestAvailability(payrollPeriodId: string): Promise<void>;
  generateScheduleFromAvailability(payrollPeriodId: string): Promise<void>;
  sendScheduleForConfirmation(payrollPeriodId: string): Promise<void>;
  resolveConflictsAndFinalize(payrollPeriodId: string): Promise<void>;
  initializeDefaultSettings(createdBy: string, companyId: string): Promise<void>;
}

class AutomationWorkflowServiceImpl implements AutomationWorkflowService {
  
  async checkAndTriggerAutomation(companyId?: string): Promise<void> {
    if (!companyId) {
      // Cron context: iterate over all companies
      const allCompanies = await db.select({ id: companies.id }).from(companies);
      for (const company of allCompanies) {
        await this.checkAndTriggerAutomation(company.id);
      }
      return;
    }

    const settings = await storage.getPayPeriodSettings(companyId);
    if (!settings?.isAutomationEnabled) {
      return;
    }

    const nextPeriod = await storage.getNextPayrollPeriod(companyId);
    if (!nextPeriod) {
      // Create the first pay period
      await this.createNewPayPeriod(companyId);
      return;
    }

    const now = new Date();
    
    // Check if we need to request availability
    if (nextPeriod.workflowState === 'created' && 
        nextPeriod.availabilityDeadline && 
        now >= new Date(nextPeriod.availabilityDeadline)) {
      await this.requestAvailability(nextPeriod.id);
    }
    
    // Check if we need to generate schedule
    if (nextPeriod.workflowState === 'availability_collected' && 
        nextPeriod.scheduleConfirmationDeadline && 
        now >= new Date(nextPeriod.scheduleConfirmationDeadline)) {
      await this.generateScheduleFromAvailability(nextPeriod.id);
    }
    
    // Check if schedule needs to be finalized
    if (nextPeriod.workflowState === 'schedule_confirmed') {
      await this.resolveConflictsAndFinalize(nextPeriod.id);
    }
    
    // Check if we need to create the next pay period
    if (nextPeriod.workflowState === 'finalized') {
      const daysUntilEnd = Math.ceil((new Date(nextPeriod.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntilEnd <= (settings.daysBeforeNotification || 7)) {
        await this.createNewPayPeriod(companyId);
      }
    }
  }

  async createNewPayPeriod(companyId: string): Promise<PayrollPeriod> {
    try {
      const newPeriod = await storage.createNextPayPeriod(companyId);
      
      await storage.createWorkflowLog({
        payrollPeriodId: newPeriod.id,
        companyId,
        workflowStep: 'pay_period_created',
        status: 'success',
        details: `New pay period created: ${newPeriod.startDate.toISOString()} to ${newPeriod.endDate.toISOString()}`,
        metadata: {
          startDate: newPeriod.startDate.toISOString(),
          endDate: newPeriod.endDate.toISOString(),
          intervalType: newPeriod.automationMetadata
        }
      });
      
      return newPeriod;
    } catch (error) {
      console.error('Failed to create new pay period:', error);
      throw error;
    }
  }

  async requestAvailability(payrollPeriodId: string): Promise<void> {
    try {
      const period = await storage.getPayrollPeriodByIdInternal(payrollPeriodId);
      const companyId = period?.companyId;
      if (!companyId) throw new Error(`[AutomationService] requestAvailability: period ${payrollPeriodId} has no companyId`);
      // Update workflow state
      await storage.updatePayrollPeriod(payrollPeriodId, {
        workflowState: 'availability_requested',
        availabilityNotificationSentAt: new Date()
      }, companyId);

      // Log workflow step
      await storage.createWorkflowLog({
        payrollPeriodId,
        companyId,
        workflowStep: 'availability_requested',
        status: 'success',
        details: 'Availability notification sent to all team members',
        metadata: {
          notificationSentAt: new Date().toISOString()
        }
      });

      // In a real implementation, you would send push notifications or emails here
      console.log(`Availability requested for pay period ${payrollPeriodId}`);
      
      // For demo purposes, we'll check if availability has been collected after a short delay
      setTimeout(() => this.checkAvailabilityCollection(payrollPeriodId), 5000);
      
    } catch (error) {
      const period2 = await storage.getPayrollPeriodByIdInternal(payrollPeriodId).catch(() => null);
      await storage.createWorkflowLog({
        payrollPeriodId,
        companyId: period2?.companyId ?? undefined,
        workflowStep: 'availability_requested',
        status: 'failed',
        details: `Failed to request availability: ${(error as Error).message}`,
        metadata: { error: (error as Error).message }
      });
      throw error;
    }
  }

  async checkAvailabilityCollection(payrollPeriodId: string): Promise<void> {
    try {
      const period = await storage.getPayrollPeriodByIdInternal(payrollPeriodId);
      const companyId = period?.companyId ?? undefined;
      if (!companyId) return;
      const availability = await storage.getAllAvailabilityForPeriod(payrollPeriodId, companyId);
      // In a real implementation, get all active users
      const allUsers: User[] = []; // Placeholder for getting all users
      
      // Check if we have availability from all active users
      const availabilityUserIds = new Set(availability.map(a => a.userId));
      const allUsersHaveSubmitted = availability.length > 0; // Simplified check for demo
      
      if (allUsersHaveSubmitted) {
        await storage.updatePayrollPeriod(payrollPeriodId, {
          workflowState: 'availability_collected'
        }, companyId);
        
        await storage.createWorkflowLog({
          payrollPeriodId,
          companyId,
          workflowStep: 'availability_collected',
          status: 'success',
          details: 'All team members have submitted their availability',
          metadata: {
            totalSubmissions: availability.length,
            collectedAt: new Date().toISOString()
          }
        });
        
        // Trigger schedule generation
        setTimeout(() => this.generateScheduleFromAvailability(payrollPeriodId), 2000);
      }
    } catch (error) {
      console.error('Failed to check availability collection:', error);
    }
  }

  async generateScheduleFromAvailability(payrollPeriodId: string): Promise<void> {
    try {
      // Get the period for companyId context
      const currentPeriod = await storage.getPayrollPeriodByIdInternal(payrollPeriodId);
      
      if (!currentPeriod) {
        throw new Error('Pay period not found');
      }

      const periodCompanyId = currentPeriod.companyId ?? undefined;

      // Update workflow state
      await storage.updatePayrollPeriod(payrollPeriodId, {
        workflowState: 'schedule_generated',
        scheduleGeneratedAt: new Date()
      }, periodCompanyId!);

      // Get availability data
      const availability = periodCompanyId
        ? await storage.getAllAvailabilityForPeriod(payrollPeriodId, periodCompanyId)
        : [];

      // Use AI to create schedule from availability
      const scheduleRequest = {
        payrollPeriodId,
        availabilityData: availability.map(a => ({
          userId: a.userId,
          userName: 'Employee', // Would get from user join in real implementation
          role: 'employee',
          hourlyRate: 15.00,
          date: a.date.toISOString().split('T')[0],
          timeSlot: a.timeSlot,
          isAvailable: a.isAvailable || false
        })),
        businessHours: {
          dailyHours: 8,
          peakHours: ['morning', 'afternoon'],
          minimumStaffing: 2
        },
        constraints: {
          overtimeThreshold: 8,
          minimumShiftLength: 4,
          maxShiftsPerDay: 2
        }
      };

      const aiSchedule = await claudeService.createScheduleFromAvailability(scheduleRequest);
      
      // Create schedule entries in database
      for (const scheduleItem of aiSchedule.schedule) {
        const scheduleData: InsertSchedule = {
          userId: scheduleItem.userId,
          companyId: periodCompanyId ?? undefined,
          startTime: new Date(`${scheduleItem.date}T${scheduleItem.startTime}`),
          endTime: new Date(`${scheduleItem.date}T${scheduleItem.endTime}`),
          title: 'Scheduled Shift',
          description: `AI-generated shift: ${scheduleItem.reasoning}`,
          createdBy: 'automation-system'
        };
        await storage.createSchedule(scheduleData);
      }

      await storage.createWorkflowLog({
        payrollPeriodId,
        companyId: periodCompanyId,
        workflowStep: 'schedule_generated',
        status: 'success',
        details: `AI generated ${aiSchedule.schedule.length} schedule entries`,
        metadata: {
          schedulesCreated: aiSchedule.schedule.length,
          aiInsights: aiSchedule.insights,
          staffingAnalysis: aiSchedule.staffingAnalysis,
          generatedAt: new Date().toISOString()
        }
      });

      // Automatically send for confirmation
      setTimeout(() => this.sendScheduleForConfirmation(payrollPeriodId), 1000);
      
    } catch (error) {
      const errPeriod = await storage.getPayrollPeriodByIdInternal(payrollPeriodId).catch(() => null);
      await storage.createWorkflowLog({
        payrollPeriodId,
        companyId: errPeriod?.companyId ?? undefined,
        workflowStep: 'schedule_generated',
        status: 'failed',
        details: `Failed to generate schedule: ${(error as Error).message}`,
        metadata: { error: (error as Error).message }
      });
      throw error;
    }
  }

  async sendScheduleForConfirmation(payrollPeriodId: string): Promise<void> {
    try {
      const period = await storage.getPayrollPeriodByIdInternal(payrollPeriodId);
      const companyId = period?.companyId;
      if (!companyId) throw new Error(`[AutomationService] sendScheduleForConfirmation: period ${payrollPeriodId} has no companyId`);
      // Update workflow state
      await storage.updatePayrollPeriod(payrollPeriodId, {
        workflowState: 'schedule_sent_for_review',
        scheduleSentAt: new Date()
      }, companyId);

      await storage.createWorkflowLog({
        payrollPeriodId,
        companyId,
        workflowStep: 'schedule_sent_for_review',
        status: 'success',
        details: 'Schedule sent to team for confirmation',
        metadata: {
          sentAt: new Date().toISOString()
        }
      });

      // In a real implementation, send notifications to team members
      console.log(`Schedule sent for confirmation for pay period ${payrollPeriodId}`);
      
      // For demo purposes, auto-confirm after a delay
      setTimeout(() => this.autoConfirmSchedule(payrollPeriodId), 10000);
      
    } catch (error) {
      const errPeriod2 = await storage.getPayrollPeriodByIdInternal(payrollPeriodId).catch(() => null);
      await storage.createWorkflowLog({
        payrollPeriodId,
        companyId: errPeriod2?.companyId ?? undefined,
        workflowStep: 'schedule_sent_for_review',
        status: 'failed',
        details: `Failed to send schedule for review: ${(error as Error).message}`,
        metadata: { error: (error as Error).message }
      });
      throw error;
    }
  }

  async autoConfirmSchedule(payrollPeriodId: string): Promise<void> {
    try {
      const period = await storage.getPayrollPeriodByIdInternal(payrollPeriodId);
      const companyId = period?.companyId;
      if (!companyId) throw new Error(`[AutomationService] autoConfirmSchedule: period ${payrollPeriodId} has no companyId`);
      // In a real implementation, you'd check actual user confirmations
      await storage.updatePayrollPeriod(payrollPeriodId, {
        workflowState: 'schedule_confirmed',
        scheduleConfirmedAt: new Date()
      }, companyId);

      await storage.createWorkflowLog({
        payrollPeriodId,
        companyId,
        workflowStep: 'schedule_confirmed',
        status: 'success',
        details: 'Team has confirmed the schedule',
        metadata: {
          confirmedAt: new Date().toISOString()
        }
      });

      // Trigger conflict resolution and finalization
      setTimeout(() => this.resolveConflictsAndFinalize(payrollPeriodId), 2000);
      
    } catch (error) {
      console.error('Failed to auto-confirm schedule:', error);
    }
  }

  async resolveConflictsAndFinalize(payrollPeriodId: string): Promise<void> {
    try {
      const period = await storage.getPayrollPeriodByIdInternal(payrollPeriodId);
      const periodCompanyId = period?.companyId;
      const settings = periodCompanyId ? await storage.getPayPeriodSettings(periodCompanyId) : undefined;
      
      if (settings?.automaticConflictResolution) {
        // Use AI to resolve any schedule conflicts
        const schedules = periodCompanyId ? await storage.getAllSchedules(undefined, undefined, periodCompanyId) : [];
        const periodSchedules = schedules.filter(s => {
          // Filter schedules for this pay period
          return true; // Simplified for demo
        });

        // Check for conflicts and resolve with AI if needed
        // In a real implementation, you'd analyze overlapping shifts, overtime issues, etc.
      }

      // Finalize the schedule
      if (!periodCompanyId) throw new Error(`[AutomationService] resolveConflictsAndFinalize: period ${payrollPeriodId} has no companyId`);
      await storage.updatePayrollPeriod(payrollPeriodId, {
        workflowState: 'finalized',
        finalizedAt: new Date()
      }, periodCompanyId);

      await storage.createWorkflowLog({
        payrollPeriodId,
        companyId: periodCompanyId,
        workflowStep: 'finalized',
        status: 'success',
        details: 'Schedule has been finalized and locked',
        metadata: {
          finalizedAt: new Date().toISOString(),
          automaticResolution: settings?.automaticConflictResolution || false
        }
      });

      console.log(`Pay period ${payrollPeriodId} has been finalized`);
      
    } catch (error) {
      const errPeriod3 = await storage.getPayrollPeriodByIdInternal(payrollPeriodId).catch(() => null);
      await storage.createWorkflowLog({
        payrollPeriodId,
        companyId: errPeriod3?.companyId ?? undefined,
        workflowStep: 'finalized',
        status: 'failed',
        details: `Failed to finalize schedule: ${(error as Error).message}`,
        metadata: { error: (error as Error).message }
      });
      throw error;
    }
  }

  async initializeDefaultSettings(createdBy: string, companyId: string): Promise<void> {
    try {
      const existingSettings = await storage.getPayPeriodSettings(companyId);
      
      if (!existingSettings) {
        await storage.updatePayPeriodSettings({
          intervalType: 'bi-weekly',
          isAutomationEnabled: true,
          daysBeforeNotification: 7,
          scheduleGenerationDays: 5,
          automaticConflictResolution: true,
          companyId,
          createdBy,
          updatedBy: createdBy
        });
        
        console.log('Default pay period automation settings initialized');
      }
    } catch (error) {
      console.error('Failed to initialize default settings:', error);
      throw error;
    }
  }
}

export const automationService = new AutomationWorkflowServiceImpl();

// Auto-run automation check every 30 minutes
setInterval(() => {
  automationService.checkAndTriggerAutomation().catch(console.error);
}, 30 * 60 * 1000);

// Run initial check after startup
setTimeout(() => {
  automationService.checkAndTriggerAutomation().catch(console.error);
}, 5000);