import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useWebSocket } from '@/hooks/useWebSocket';
import { Button } from '@/components/ui/button';
import TimeClockWidget from '@/components/TimeClockWidget';
import ScheduleWidget from '@/components/ScheduleWidget';
import ChoresWidget from '@/components/ChoresWidget';
import TeamActivityFeed from '@/components/TeamActivityFeed';
import AIInsightsWidget from '@/components/AIInsightsWidget';
import AIChatModal from '@/components/AIChatModal';

export default function Dashboard() {
  const { user } = useAuth();
  const { isConnected } = useWebSocket();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showAIChat, setShowAIChat] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const getGreeting = () => {
    const hour = currentTime.getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-primary text-primary-foreground p-4 flex items-center justify-between relative z-10">
        <div className="flex items-center space-x-3">
          <img 
            src={user?.profileImageUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${user?.firstName} ${user?.lastName}`}
            alt="User Avatar" 
            className="w-10 h-10 rounded-full border-2 border-primary-foreground/20"
            data-testid="user-avatar"
          />
          <div>
            <p className="font-medium text-sm" data-testid="user-name">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-xs opacity-80" data-testid="user-role">
              {user?.role === 'admin' ? 'Team Manager' : 'Employee'}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button className="relative p-2" data-testid="notifications-button">
            <i className="fas fa-bell text-lg"></i>
            <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-xs rounded-full w-4 h-4 flex items-center justify-center">
              3
            </span>
          </button>
          <button className="p-2" data-testid="settings-button">
            <i className="fas fa-cog text-lg"></i>
          </button>
        </div>
      </header>

      {/* Welcome Section */}
      <section className="p-4 bg-gradient-to-r from-primary/5 to-accent/5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-foreground" data-testid="greeting">
              {getGreeting()}, {user?.firstName}!
            </h1>
            <p className="text-muted-foreground text-sm" data-testid="current-date">
              {formatDate(currentTime)} • {formatTime(currentTime)}
            </p>
            {!isConnected && (
              <p className="text-destructive text-xs mt-1">
                <i className="fas fa-exclamation-triangle mr-1"></i>
                Offline - some features may be limited
              </p>
            )}
          </div>
          
          <Button
            onClick={() => setShowAIChat(true)}
            className="ai-gradient text-primary-foreground p-3 rounded-full shadow-lg hover:scale-105 transition-transform"
            data-testid="ai-assistant-button"
          >
            <i className="fas fa-robot text-lg"></i>
          </Button>
        </div>
      </section>

      {/* Main Content */}
      <div className="space-y-4 p-4">
        {/* Time Clock Widget */}
        <TimeClockWidget />

        {/* Schedule Widget */}
        <ScheduleWidget />

        {/* AI-Assigned Chores */}
        <ChoresWidget />

        {/* AI Insights */}
        <AIInsightsWidget />

        {/* Team Activity Feed */}
        <TeamActivityFeed />

        {/* Quick Actions */}
        <section>
          <h3 className="font-semibold text-base mb-3">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              className="h-16 flex flex-col items-center justify-center"
              data-testid="view-schedule-button"
            >
              <i className="fas fa-calendar text-primary text-xl mb-1"></i>
              <span className="text-sm">View Schedule</span>
            </Button>
            
            <Button
              variant="outline"
              className="h-16 flex flex-col items-center justify-center"
              data-testid="request-time-off-button"
            >
              <i className="fas fa-umbrella-beach text-primary text-xl mb-1"></i>
              <span className="text-sm">Request Time Off</span>
            </Button>
            
            <Button
              variant="outline"
              className="h-16 flex flex-col items-center justify-center"
              data-testid="view-payroll-button"
            >
              <i className="fas fa-dollar-sign text-primary text-xl mb-1"></i>
              <span className="text-sm">View Payroll</span>
            </Button>
            
            <Button
              variant="outline"
              className="h-16 flex flex-col items-center justify-center"
              data-testid="team-chat-button"
            >
              <i className="fas fa-comments text-primary text-xl mb-1"></i>
              <span className="text-sm">Team Chat</span>
            </Button>
          </div>
        </section>
      </div>

      {/* AI Chat Modal */}
      <AIChatModal
        isOpen={showAIChat}
        onClose={() => setShowAIChat(false)}
      />
    </div>
  );
}
