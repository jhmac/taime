import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import TimeClockWidget from '@/components/TimeClockWidget';
import ScheduleWidget from '@/components/ScheduleWidget';
import ChoresWidget from '@/components/ChoresWidget';
import TeamActivityFeed from '@/components/TeamActivityFeed';
import AIInsightsWidget from '@/components/AIInsightsWidget';
import AIChatModal from '@/components/AIChatModal';
import type { UserWithRole } from '@shared/schema';

export default function Dashboard() {
  const { user } = useAuth() as { user: UserWithRole | undefined, isLoading: boolean, isAuthenticated: boolean, error: any };
  const { isConnected } = useWebSocket();
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showAIChat, setShowAIChat] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date: Date) =>
    date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });

  const formatDate = (date: Date) =>
    date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const getGreeting = () => {
    const hour = currentTime.getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div className="min-h-full bg-background">
      <section className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground p-5 md:p-6 md:rounded-xl md:m-6 md:mt-4">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h1 className="text-lg md:text-xl font-bold">
              {getGreeting()}, {user?.firstName}!
            </h1>
            <p className="text-sm opacity-80">
              {formatDate(currentTime)} &bull; {formatTime(currentTime)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isConnected && (
              <span className="text-xs bg-red-500/20 text-red-200 px-2 py-1 rounded-full">
                <i className="fas fa-wifi-slash mr-1"></i>Offline
              </span>
            )}
            <Button
              onClick={() => setShowAIChat(true)}
              size="icon"
              className="bg-white/20 hover:bg-white/30 text-white rounded-full h-10 w-10"
              data-testid="ai-assistant-button"
            >
              <i className="fas fa-robot"></i>
            </Button>
          </div>
        </div>
        <p className="text-xs opacity-60 mt-0.5">
          {user?.role?.displayName || user?.role?.name || 'Employee'}
        </p>
      </section>

      <div className={isMobile ? "space-y-4 p-4" : "grid grid-cols-2 gap-6 p-6"}>
        <div className="space-y-4 md:space-y-6">
          <TimeClockWidget />
          <ScheduleWidget />
        </div>

        <div className="space-y-4 md:space-y-6">
          <ChoresWidget />
          <AIInsightsWidget />
        </div>
      </div>

      <div className={isMobile ? "px-4 pb-4" : "px-6 pb-6"}>
        <h3 className="font-semibold text-sm mb-3 text-muted-foreground uppercase tracking-wide">Quick Actions</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/schedules')}>
            <CardContent className="p-4 flex flex-col items-center text-center">
              <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-2">
                <i className="fas fa-calendar text-blue-600 dark:text-blue-400"></i>
              </div>
              <span className="text-xs font-medium">View Schedule</span>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/availability')}>
            <CardContent className="p-4 flex flex-col items-center text-center">
              <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-2">
                <i className="fas fa-clock text-green-600 dark:text-green-400"></i>
              </div>
              <span className="text-xs font-medium">Availability</span>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/communication')}>
            <CardContent className="p-4 flex flex-col items-center text-center">
              <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mb-2">
                <i className="fas fa-comments text-purple-600 dark:text-purple-400"></i>
              </div>
              <span className="text-xs font-medium">Team Chat</span>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setShowAIChat(true)}>
            <CardContent className="p-4 flex flex-col items-center text-center">
              <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-2">
                <i className="fas fa-robot text-amber-600 dark:text-amber-400"></i>
              </div>
              <span className="text-xs font-medium">AI Assistant</span>
            </CardContent>
          </Card>
        </div>
      </div>

      {!isMobile && (
        <div className="px-6 pb-6">
          <TeamActivityFeed />
        </div>
      )}

      <AIChatModal isOpen={showAIChat} onClose={() => setShowAIChat(false)} />
    </div>
  );
}
