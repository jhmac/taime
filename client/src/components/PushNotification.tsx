import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface NotificationData {
  title: string;
  body: string;
  type?: string;
  actions?: Array<{
    action: string;
    title: string;
  }>;
}

export default function PushNotification() {
  const [notification, setNotification] = useState<NotificationData | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'push-notification') {
          showNotification(event.data.notification);
        }
      });
    }

    // Mock notification for demo (remove in production)
    const timer = setTimeout(() => {
      showNotification({
        title: "Don't forget to clock out!",
        body: "We noticed you left the work location. Tap here to clock out now.",
        type: 'clock_out_reminder',
        actions: [
          { action: 'clock_out', title: 'Clock Out Now' },
          { action: 'dismiss', title: 'Dismiss' },
        ],
      });
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  const showNotification = (data: NotificationData) => {
    setNotification(data);
    setIsVisible(true);

    // Auto-hide after 5 seconds
    setTimeout(() => {
      hideNotification();
    }, 5000);
  };

  const hideNotification = () => {
    setIsVisible(false);
    setTimeout(() => {
      setNotification(null);
    }, 300);
  };

  const handleAction = (action: string) => {
    switch (action) {
      case 'clock_out':
        // Handle clock out action
        console.log('Clock out action triggered');
        break;
      case 'clock_in':
        // Handle clock in action
        console.log('Clock in action triggered');
        break;
      case 'view_task':
        // Navigate to task view
        console.log('View task action triggered');
        break;
      case 'dismiss':
      default:
        // Just dismiss the notification
        break;
    }
    hideNotification();
  };

  if (!notification) return null;

  return (
    <div
      className={cn(
        "fixed top-4 left-4 right-4 bg-card border border-border rounded-lg shadow-lg p-4 z-50 transform transition-transform duration-300",
        isVisible ? "translate-y-0" : "-translate-y-full"
      )}
      data-testid="push-notification"
      style={{ display: notification ? 'block' : 'none' }}
    >
      <div className="flex items-start space-x-3">
        <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center flex-shrink-0">
          <i className="fas fa-bell text-primary-foreground text-sm"></i>
        </div>
        <div className="flex-1">
          <p className="font-medium text-sm" data-testid="notification-title">
            {notification.title}
          </p>
          <p className="text-xs text-muted-foreground" data-testid="notification-body">
            {notification.body}
          </p>
        </div>
        <button
          className="text-muted-foreground hover:text-foreground"
          onClick={hideNotification}
          data-testid="notification-close"
        >
          <i className="fas fa-times text-sm"></i>
        </button>
      </div>

      {notification.actions && notification.actions.length > 0 && (
        <div className="flex space-x-2 mt-3 pl-11">
          {notification.actions.map((action) => (
            <Button
              key={action.action}
              onClick={() => handleAction(action.action)}
              size="sm"
              variant={action.action === 'dismiss' ? 'outline' : 'default'}
              className="text-xs"
              data-testid={`notification-action-${action.action}`}
            >
              {action.title}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
