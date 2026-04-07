import { storage } from "../storage";
import { claudeService } from "./claudeService";
import { notificationService } from "./notificationService";

class PayrollAutomationService {
  
  /**
   * Schedules the next payroll periods based on interval type
   */
  async scheduleNextPayrollPeriods(intervalType: string, lastEndDate: Date, periodsToCreate: number = 3) {
    try {
      const periods = [];
      const existingPeriods = await storage.getPayrollPeriods();
      let currentStartDate = new Date(lastEndDate);
      currentStartDate.setDate(currentStartDate.getDate() + 1);

      for (let i = 0; i < periodsToCreate; i++) {
        const endDate = this.calculateEndDate(currentStartDate, intervalType);
        
        const duplicate = existingPeriods.some(p => {
          const eStart = new Date(p.startDate).toISOString().split('T')[0];
          const eEnd = new Date(p.endDate).toISOString().split('T')[0];
          const nStart = currentStartDate.toISOString().split('T')[0];
          const nEnd = endDate.toISOString().split('T')[0];
          return eStart === nStart && eEnd === nEnd;
        });

        if (!duplicate) {
          const period = await storage.createPayrollPeriod({
            startDate: new Date(currentStartDate),
            endDate: endDate,
            workflowState: 'created',
            automationMetadata: {
              createdByAI: true,
              intervalType,
              sequence: i + 1
            }
          });
          periods.push(period);
        }
        
        currentStartDate = new Date(endDate);
        currentStartDate.setDate(currentStartDate.getDate() + 1);
      }

      console.log(`Scheduled ${periods.length} future payroll periods`);
      return periods;
    } catch (error) {
      console.error("Error scheduling payroll periods:", error);
      throw error;
    }
  }

  /**
   * Calculates end date based on interval type
   */
  private calculateEndDate(startDate: Date, intervalType: string): Date {
    const endDate = new Date(startDate);
    
    switch (intervalType) {
      case 'weekly':
        endDate.setDate(startDate.getDate() + 6);
        break;
      case 'bi-weekly':
        endDate.setDate(startDate.getDate() + 13);
        break;
      case 'monthly':
        endDate.setMonth(startDate.getMonth() + 1);
        endDate.setDate(startDate.getDate() - 1);
        break;
      default:
        endDate.setDate(startDate.getDate() + 13); // Default to bi-weekly
    }
    
    return endDate;
  }

  /**
   * Processes payroll automation workflow for a specific period
   */
  async processPayrollWorkflow(periodId: string) {
    try {
      const period = await storage.getPayrollPeriod(periodId);
      if (!period) {
        throw new Error(`Payroll period ${periodId} not found`);
      }

      const settings = await storage.getPayrollSettings();
      if (!settings || !settings.isAutomationEnabled) {
        console.log("Automation disabled, skipping workflow");
        return;
      }

      // Log workflow step
      await storage.createWorkflowLog({
        payrollPeriodId: periodId,
        workflowStep: 'automation_started',
        status: 'success',
        details: 'AI payroll automation workflow initiated',
      });

      switch (period.workflowState) {
        case 'created':
          await this.requestAvailability(periodId, settings);
          break;
        case 'availability_collected':
          await this.generateSchedule(periodId, settings);
          break;
        case 'schedule_generated':
          await this.sendScheduleForReview(periodId, settings);
          break;
        case 'schedule_confirmed':
          await this.finalizePayroll(periodId, settings);
          break;
      }
    } catch (error) {
      console.error(`Error processing workflow for period ${periodId}:`, error);
      
      // Log error
      await storage.createWorkflowLog({
        payrollPeriodId: periodId,
        workflowStep: 'automation_error',
        status: 'failed',
        details: error.message,
      });
    }
  }

  /**
   * Requests availability from team members
   */
  private async requestAvailability(periodId: string, settings: any) {
    try {
      // Get all active users
      const users = await storage.getAllUsers();
      
      // Send availability notifications
      for (const user of users) {
        await notificationService.sendAvailabilityRequest(user.id, periodId);
      }

      // Update period state
      await storage.updatePayrollPeriod(periodId, {
        workflowState: 'availability_requested',
        availabilityNotificationSentAt: new Date(),
      });

      await storage.createWorkflowLog({
        payrollPeriodId: periodId,
        workflowStep: 'availability_requested',
        status: 'success',
        details: `Availability notifications sent to ${users.length} team members`,
      });

    } catch (error) {
      console.error("Error requesting availability:", error);
      throw error;
    }
  }

  /**
   * Generates AI-optimized schedule based on availability
   */
  private async generateSchedule(periodId: string, settings: any) {
    try {
      // Get availability data
      const availabilityData = await storage.getAllAvailabilityForPeriod(periodId);
      
      // Call Claude AI to generate schedule
      const scheduleResult = await claudeService.createScheduleFromAvailability({
        payrollPeriodId: periodId,
        availabilityData,
        businessHours: {
          dailyHours: 8,
          peakHours: ['afternoon', 'evening'],
          minimumStaffing: 2,
        },
        constraints: {
          maxWeeklyHours: 40,
          overtimeThreshold: 8,
          minimumShiftLength: 4,
        },
      });

      // Update period state
      await storage.updatePayrollPeriod(periodId, {
        workflowState: 'schedule_generated',
        scheduleGeneratedAt: new Date(),
        aiAnalysis: scheduleResult.analysis,
      });

      await storage.createWorkflowLog({
        payrollPeriodId: periodId,
        workflowStep: 'schedule_generated',
        status: 'success',
        details: 'AI-generated schedule created successfully',
        metadata: scheduleResult.analysis,
      });

    } catch (error) {
      console.error("Error generating schedule:", error);
      throw error;
    }
  }

  /**
   * Sends schedule to team for review and confirmation
   */
  private async sendScheduleForReview(periodId: string, settings: any) {
    try {
      // Get all users assigned to this period
      const schedules = await storage.getSchedulesByPeriod(periodId);
      const userIds = Array.from(new Set(schedules.map(s => s.userId)));

      // Send schedule notifications
      for (const userId of userIds) {
        await notificationService.sendScheduleConfirmationRequest(userId, periodId);
      }

      // Update period state
      await storage.updatePayrollPeriod(periodId, {
        workflowState: 'schedule_sent_for_review',
        scheduleSentAt: new Date(),
      });

      await storage.createWorkflowLog({
        payrollPeriodId: periodId,
        workflowStep: 'schedule_sent_for_review',
        status: 'success',
        details: `Schedule sent to ${userIds.length} team members for confirmation`,
      });

    } catch (error) {
      console.error("Error sending schedule for review:", error);
      throw error;
    }
  }

  /**
   * Finalizes payroll and sends for verification
   */
  private async finalizePayroll(periodId: string, settings: any) {
    try {
      // Get payroll data
      const timeEntries = await storage.getTimeEntriesByPeriod(periodId);
      const schedules = await storage.getSchedulesByPeriod(periodId);

      // Generate payroll summary using AI
      const payrollSummary = await claudeService.generatePayrollSummary({
        periodId,
        timeEntries,
        schedules,
      });

      // Update period state
      await storage.updatePayrollPeriod(periodId, {
        workflowState: 'finalized',
        finalizedAt: new Date(),
        aiAnalysis: payrollSummary,
      });

      // Send verification notification to designated user
      if (settings.notificationUserId) {
        await notificationService.sendPayrollVerificationRequest(
          settings.notificationUserId, 
          periodId, 
          payrollSummary
        );
      }

      await storage.createWorkflowLog({
        payrollPeriodId: periodId,
        workflowStep: 'payroll_finalized',
        status: 'success',
        details: 'Payroll finalized and sent for verification',
        metadata: payrollSummary,
      });

      // Automatically schedule next period if needed
      await this.checkAndScheduleNextPeriod(settings);

    } catch (error) {
      console.error("Error finalizing payroll:", error);
      throw error;
    }
  }

  /**
   * Checks if we need to schedule the next payroll period
   */
  private async checkAndScheduleNextPeriod(settings: any) {
    try {
      const upcomingPeriods = await storage.getUpcomingPayrollPeriods(3);
      
      if (upcomingPeriods.length < 2) {
        // Schedule more periods if we're running low
        const lastPeriod = await storage.getLatestPayrollPeriod();
        if (lastPeriod) {
          await this.scheduleNextPayrollPeriods(
            settings.intervalType, 
            lastPeriod.endDate, 
            3 - upcomingPeriods.length
          );
        }
      }
    } catch (error) {
      console.error("Error checking next period scheduling:", error);
    }
  }

  /**
   * Manual trigger to process all pending payroll workflows
   */
  async processAllPendingWorkflows() {
    try {
      const pendingPeriods = await storage.getPendingPayrollPeriods();
      
      for (const period of pendingPeriods) {
        await this.processPayrollWorkflow(period.id);
      }
      
      console.log(`Processed ${pendingPeriods.length} pending workflows`);
    } catch (error) {
      console.error("Error processing pending workflows:", error);
    }
  }
}

export const payrollAutomationService = new PayrollAutomationService();