import webpush from 'web-push';
import { storage } from '../storage';
import { config } from '../lib/config';

if (config.vapid.publicKey && config.vapid.privateKey) {
  webpush.setVapidDetails(
    'mailto:admin@taimeclock.com',
    config.vapid.publicKey,
    config.vapid.privateKey
  );
}

export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: Record<string, any>;
  actions?: Array<{
    action: string;
    title: string;
    icon?: string;
  }>;
}

export class NotificationService {
  /**
   * Send push notification to a specific user
   */
  async sendToUser(userId: string, payload: NotificationPayload): Promise<void> {
    try {
      const subscriptions = await storage.getUserPushSubscriptions(userId);
      
      if (subscriptions.length === 0) {
        console.log(`No push subscriptions found for user ${userId}`);
        return;
      }

      const notificationPayload = JSON.stringify({
        title: payload.title,
        body: payload.body,
        icon: payload.icon || '/icon-192x192.png',
        badge: payload.badge || '/badge-72x72.png',
        data: payload.data || {},
        actions: payload.actions || [],
      });

      const promises = subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            notificationPayload
          );
        } catch (error) {
          console.error(`Failed to send notification to subscription ${subscription.id}:`, error);
          // If subscription is invalid, deactivate it
          if (error.statusCode === 410) {
            await storage.deletePushSubscription(subscription.id);
          }
        }
      });

      await Promise.allSettled(promises);
    } catch (error) {
      console.error('Failed to send notifications:', error);
      throw error;
    }
  }

  /**
   * Send clock-in reminder when user arrives at work location
   */
  async sendClockInReminder(userId: string, locationName: string): Promise<void> {
    await this.sendToUser(userId, {
      title: '🕐 Clock In Reminder',
      body: `You've arrived at ${locationName}. Don't forget to clock in!`,
      data: {
        type: 'clock_in_reminder',
        locationName,
      },
      actions: [
        {
          action: 'clock_in',
          title: 'Clock In Now',
        },
        {
          action: 'dismiss',
          title: 'Dismiss',
        },
      ],
    });
  }

  /**
   * Send clock-out reminder when user leaves work location
   */
  async sendClockOutReminder(userId: string, locationName: string): Promise<void> {
    await this.sendToUser(userId, {
      title: '🕐 Clock Out Reminder',
      body: `You've left ${locationName}. Don't forget to clock out!`,
      data: {
        type: 'clock_out_reminder',
        locationName,
      },
      actions: [
        {
          action: 'clock_out',
          title: 'Clock Out Now',
        },
        {
          action: 'dismiss',
          title: 'Dismiss',
        },
      ],
    });
  }

  /**
   * Send task assignment notification
   */
  async sendTaskAssignment(userId: string, taskTitle: string, dueTime: string): Promise<void> {
    await this.sendToUser(userId, {
      title: '📋 New Task Assigned',
      body: `You have a new task: ${taskTitle}. Due: ${dueTime}`,
      data: {
        type: 'task_assignment',
        taskTitle,
        dueTime,
      },
      actions: [
        {
          action: 'view_task',
          title: 'View Task',
        },
        {
          action: 'dismiss',
          title: 'Dismiss',
        },
      ],
    });
  }

  /**
   * Send task reminder notification
   */
  async sendTaskReminder(userId: string, taskTitle: string, minutesUntilDue: number): Promise<void> {
    await this.sendToUser(userId, {
      title: '⏰ Task Reminder',
      body: `Task "${taskTitle}" is due in ${minutesUntilDue} minutes!`,
      data: {
        type: 'task_reminder',
        taskTitle,
        minutesUntilDue,
      },
      actions: [
        {
          action: 'mark_complete',
          title: 'Mark Complete',
        },
        {
          action: 'view_task',
          title: 'View Task',
        },
      ],
    });
  }

  /**
   * Send overtime warning notification
   */
  async sendOvertimeWarning(userId: string, currentHours: number, overtimeThreshold: number): Promise<void> {
    const hoursUntilOvertime = overtimeThreshold - currentHours;
    
    await this.sendToUser(userId, {
      title: '⚠️ Overtime Warning',
      body: `You'll reach overtime in ${hoursUntilOvertime.toFixed(1)} hours. Consider taking a break or clocking out early.`,
      data: {
        type: 'overtime_warning',
        currentHours,
        overtimeThreshold,
      },
      actions: [
        {
          action: 'clock_out',
          title: 'Clock Out Now',
        },
        {
          action: 'dismiss',
          title: 'Acknowledge',
        },
      ],
    });
  }

  /**
   * Send schedule update notification
   */
  async sendScheduleUpdate(userId: string, changeDescription: string): Promise<void> {
    await this.sendToUser(userId, {
      title: '📅 Schedule Updated',
      body: changeDescription,
      data: {
        type: 'schedule_update',
        changeDescription,
      },
      actions: [
        {
          action: 'view_schedule',
          title: 'View Schedule',
        },
        {
          action: 'dismiss',
          title: 'Dismiss',
        },
      ],
    });
  }

  /**
   * Send payroll ready notification
   */
  async sendPayrollReady(userId: string, periodDescription: string): Promise<void> {
    await this.sendToUser(userId, {
      title: '💰 Payroll Ready for Review',
      body: `Your timesheet for ${periodDescription} is ready for approval.`,
      data: {
        type: 'payroll_ready',
        periodDescription,
      },
      actions: [
        {
          action: 'review_payroll',
          title: 'Review Now',
        },
        {
          action: 'dismiss',
          title: 'Later',
        },
      ],
    });
  }

  /**
   * Send team announcement notification
   */
  async sendTeamAnnouncement(userIds: string[], title: string, message: string): Promise<void> {
    const payload: NotificationPayload = {
      title,
      body: message,
      data: {
        type: 'team_announcement',
      },
      actions: [
        {
          action: 'view_announcement',
          title: 'View Details',
        },
        {
          action: 'dismiss',
          title: 'Dismiss',
        },
      ],
    };

    const promises = userIds.map(userId => this.sendToUser(userId, payload));
    await Promise.allSettled(promises);
  }

  /**
   * Send AI insight notification
   */
  async sendAIInsight(userId: string, insightTitle: string, insightDescription: string, severity: string): Promise<void> {
    const emoji = severity === 'high' ? '🚨' : severity === 'medium' ? '⚠️' : 'ℹ️';
    
    await this.sendToUser(userId, {
      title: `${emoji} AI Insight`,
      body: `${insightTitle}: ${insightDescription}`,
      data: {
        type: 'ai_insight',
        insightTitle,
        insightDescription,
        severity,
      },
      actions: [
        {
          action: 'view_insight',
          title: 'View Details',
        },
        {
          action: 'dismiss',
          title: 'Dismiss',
        },
      ],
    });
  }
}

export const notificationService = new NotificationService();
