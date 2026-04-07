import { storage } from "../storage";
import { claudeService } from "./claudeService";
import type { PayrollPeriod, User, UserAvailability, Schedule, InsertSchedule } from "@shared/schema";

export interface AutomationWorkflowService {
  checkAndTriggerAutomation(): Promise<void>;
  requestAvailability(payrollPeriodId: string): Promise<void>;
  generateScheduleFromAvailability(payrollPeriodId: string): Promise<void>;
  sendScheduleForConfirmation(payrollPeriodId: string): Promise<void>;
  resolveConflictsAndFinalize(payrollPeriodId: string): Promise<void>;
  initializeDefaultSettings(createdBy: string): Promise<void>;
}

class AutomationWorkflowServiceImpl implements AutomationWorkflowService {
  
  async checkAndTriggerAutomation(): Promise<void> {
    const settings = await storage.getPayPeriodSettings();
    if (!settings?.isAutomationEnabled) {
      return;
    }

    const nextPeriod = await storage.getNextPayrollPeriod();
    if (!nextPeriod) {
      // Create the first pay period
      await this.createNewPayPeriod();
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
        await this.createNewPayPeriod();
      }
    }
  }

  async createNewPayPeriod(): Promise<PayrollPeriod> {
    try {
      const newPeriod = await storage.createNextPayPeriod();
      
      await storage.createWorkflowLog({
        payrollPeriodId: newPeriod.id,
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
      // Update workflow state
      await storage.updatePayrollPeriod(payrollPeriodId, {
        workflowState: 'availability_requested',
        availabilityNotificationSentAt: new Date()
      });

      // Log workflow step
      await storage.createWorkflowLog({
        payrollPeriodId,
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
      await storage.createWorkflowLog({
        payrollPeriodId,
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
      const availability = await storage.getAllAvailabilityForPeriod(payrollPeriodId);
      // In a real implementation, get all active users
      const allUsers: User[] = []; // Placeholder for getting all users
      
      // Check if we have availability from all active users
      const availabilityUserIds = new Set(availability.map(a => a.userId));
      const allUsersHaveSubmitted = availability.length > 0; // Simplified check for demo
      
      if (allUsersHaveSubmitted) {
        await storage.updatePayrollPeriod(payrollPeriodId, {
          workflowState: 'availability_collected'
        });
        
        await storage.createWorkflowLog({
          payrollPeriodId,
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
      // Update workflow state
      await storage.updatePayrollPeriod(payrollPeriodId, {
        workflowState: 'schedule_generated',
        scheduleGeneratedAt: new Date()
      });

      // Get availability data
      const availability = await storage.getAllAvailabilityForPeriod(payrollPeriodId);
      const period = await storage.getPayrollPeriods();
      const currentPeriod = period.find(p => p.id === payrollPeriodId);
      
      if (!currentPeriod) {
        throw new Error('Pay period not found');
      }

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

      const aiSchedule = await claudeService.createScheduleFromAvailability(scheduleRequest as any);
      
      // Create schedule entries in database
      for (const scheduleItem of aiSchedule.schedule) {
        const scheduleData: InsertSchedule = {
          userId: scheduleItem.userId,
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
      await storage.createWorkflowLog({
        payrollPeriodId,
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
      // Update workflow state
      await storage.updatePayrollPeriod(payrollPeriodId, {
        workflowState: 'schedule_sent_for_review',
        scheduleSentAt: new Date()
      });

      await storage.createWorkflowLog({
        payrollPeriodId,
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
      await storage.createWorkflowLog({
        payrollPeriodId,
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
      // In a real implementation, you'd check actual user confirmations
      await storage.updatePayrollPeriod(payrollPeriodId, {
        workflowState: 'schedule_confirmed',
        scheduleConfirmedAt: new Date()
      });

      await storage.createWorkflowLog({
        payrollPeriodId,
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
      const settings = await storage.getPayPeriodSettings();
      
      if (settings?.automaticConflictResolution) {
        // Use AI to resolve any schedule conflicts
        const schedules = await storage.getAllSchedules();
        const periodSchedules = schedules.filter(s => {
          // Filter schedules for this pay period
          return true; // Simplified for demo
        });

        // Check for conflicts and resolve with AI if needed
        // In a real implementation, you'd analyze overlapping shifts, overtime issues, etc.
      }

      // Finalize the schedule
      await storage.updatePayrollPeriod(payrollPeriodId, {
        workflowState: 'finalized',
        finalizedAt: new Date()
      });

      await storage.createWorkflowLog({
        payrollPeriodId,
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
      await storage.createWorkflowLog({
        payrollPeriodId,
        workflowStep: 'finalized',
        status: 'failed',
        details: `Failed to finalize schedule: ${(error as Error).message}`,
        metadata: { error: (error as Error).message }
      });
      throw error;
    }
  }

  async initializeDefaultSettings(createdBy: string): Promise<void> {
    try {
      const existingSettings = await storage.getPayPeriodSettings();
      
      if (!existingSettings) {
        await storage.updatePayPeriodSettings({
          intervalType: 'bi-weekly',
          isAutomationEnabled: true,
          daysBeforeNotification: 7,
          scheduleGenerationDays: 5,
          automaticConflictResolution: true,
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