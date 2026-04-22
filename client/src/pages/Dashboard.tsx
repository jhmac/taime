import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
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
import TodaySchedulePanel from '@/components/TodaySchedulePanel';
import DailyGoalWidget from '@/components/DailyGoalWidget';
import DailyQuoteCard from '@/components/DailyQuoteCard';
import MiddayPulseCard from '@/components/MiddayPulseCard';
import KudosWidget from '@/components/KudosWidget';
import DailyDebriefSheet from '@/components/DailyDebriefSheet';
import SurfacedSOPBanner from '@/components/SurfacedSOPBanner';
import ImprovementFeedWidget from '@/components/ImprovementFeedWidget';
import type { UserWithRole, Schedule } from '@shared/schema';
import { Calendar, Users, DollarSign, MessageSquare, Clock, Bot, Sun, ClipboardList } from 'lucide-react';

export default function Dashboard() {
  const { user } = useAuth() as { user: UserWithRole | undefined, isLoading: boolean, isAuthenticated: boolean, error: any };
  const { isConnected } = useWebSocket();
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showDebrief, setShowDebrief] = useState(false);

  const { data: schedules = [] } = useQuery<Schedule[]>({
    queryKey: ['/api/schedules'],
  });

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const getGreeting = () => {
    const hour = currentTime.getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const isAdmin = user?.role?.name === 'admin' || user?.role?.name === 'owner';

  const myUpcomingShifts = schedules
    .filter(s => s.userId === user?.id && new Date(s.startTime) >= new Date())
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .slice(0, 3);

  const hasUpcomingShifts = myUpcomingShifts.length > 0;

  if (isMobile) {
    return (
      <div className="min-h-full bg-background">
        <div className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground p-5 rounded-b-2xl">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-sm font-semibold">
                {user?.profileImageUrl ? (
                  <img src={user.profileImageUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  `${(user?.firstName || '')[0] || ''}${(user?.lastName || '')[0] || ''}`
                )}
              </div>
              <div>
                <h1 className="text-base font-bold">Dashboard</h1>
              </div>
            </div>
            <Button
              onClick={() => window.dispatchEvent(new Event("open-ask-mainager"))}
              size="icon"
              className="bg-white/20 hover:bg-white/30 text-white rounded-full h-9 w-9"
            >
              <i className="fas fa-robot text-sm"></i>
            </Button>
          </div>
          <div className="text-center py-2">
            <p className="text-sm opacity-80 mb-2">{getGreeting()}</p>
            <TimeClockWidget />
          </div>
        </div>

        <div className="p-4 space-y-4">
          <SurfacedSOPBanner />
          <DailyQuoteCard />
          <MiddayPulseCard />

          {isAdmin && (
            <Card className="cursor-pointer hover:shadow-md transition-shadow bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border-amber-200/50 dark:border-amber-800/30" onClick={() => navigate('/huddle')}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
                  <Sun className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-bold">Start Morning Huddle</h3>
                  <p className="text-xs text-muted-foreground">Rally the team for today</p>
                </div>
                <i className="fas fa-chevron-right text-xs text-muted-foreground"></i>
              </CardContent>
            </Card>
          )}

          {isAdmin && <TodaySchedulePanel />}
          {isAdmin && <DailyGoalWidget />}

          <Card>
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-1">My earnings</h3>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold">$0.00</span>
                <span className="text-xs text-muted-foreground">This pay period</span>
              </div>
              <button
                onClick={() => navigate('/payroll')}
                className="text-sm text-primary font-medium mt-3 flex items-center gap-2"
              >
                View earnings details <i className="fas fa-chevron-right text-xs"></i>
              </button>
            </CardContent>
          </Card>

          {hasUpcomingShifts ? (
            <Card>
              <CardContent className="p-4">
                <h3 className="text-sm font-semibold mb-3">Upcoming shifts</h3>
                <div className="space-y-2">
                  {myUpcomingShifts.map(shift => (
                    <div key={shift.id} className="flex items-center gap-3 p-2 bg-muted/30 rounded-lg">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <i className="fas fa-calendar-day text-primary text-sm"></i>
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-medium">
                          {new Date(shift.startTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(shift.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} -
                          {new Date(shift.endTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => navigate('/schedules')}
                  className="text-sm text-primary font-medium mt-3 flex items-center gap-2"
                >
                  View all shifts <i className="fas fa-chevron-right text-xs"></i>
                </button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-6 text-center">
                <div className="mx-auto w-20 h-20 mb-3 opacity-30">
                  <svg viewBox="0 0 100 100" className="w-full h-full text-muted-foreground">
                    <rect x="10" y="10" width="30" height="30" rx="3" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5,3" />
                    <rect x="45" y="25" width="30" height="30" rx="3" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5,3" />
                    <rect x="25" y="50" width="30" height="30" rx="3" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5,3" />
                  </svg>
                </div>
                <h3 className="text-base font-bold mb-1">No upcoming shifts</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Nice, time to rest! Or time to update your availability
                </p>
                <Button
                  onClick={() => navigate('/availability')}
                  className="rounded-full px-6"
                >
                  Update availability
                </Button>
                <button
                  onClick={() => navigate('/schedules')}
                  className="text-sm text-primary font-medium mt-4 flex items-center gap-2 mx-auto"
                >
                  View all shifts <i className="fas fa-chevron-right text-xs"></i>
                </button>
              </CardContent>
            </Card>
          )}

          <KudosWidget />

          <Card className="cursor-pointer hover:shadow-md transition-shadow bg-gradient-to-r from-slate-50 to-blue-50 dark:from-slate-950/20 dark:to-blue-950/20 border-slate-200/50 dark:border-slate-800/30" onClick={() => setShowDebrief(true)}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
                <ClipboardList className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold">Daily Debrief</h3>
                <p className="text-xs text-muted-foreground">Reflect on your day before you head out</p>
              </div>
              <i className="fas fa-chevron-right text-xs text-muted-foreground"></i>
            </CardContent>
          </Card>
        </div>

        <DailyDebriefSheet open={showDebrief} onOpenChange={setShowDebrief} />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-background">
      <section className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground p-5 md:p-6 md:rounded-xl md:m-6 md:mt-4">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h1 className="text-lg md:text-xl font-bold">
              {getGreeting()}, {user?.firstName}!
            </h1>
            <p className="text-sm opacity-80">
              {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} &bull; {currentTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isConnected && (
              <span className="text-xs bg-red-500/20 text-red-200 px-2 py-1 rounded-full">
                <i className="fas fa-wifi-slash mr-1"></i>Offline
              </span>
            )}
            <Button
              onClick={() => window.dispatchEvent(new Event("open-ask-mainager"))}
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

      <div className="px-6 pb-3">
        <SurfacedSOPBanner />
      </div>

      <div className="px-6 pb-4 space-y-4">
        <DailyQuoteCard />
        <MiddayPulseCard />
      </div>

      {isAdmin ? (
        <>
          <div className="px-6 pb-4">
            <Card className="cursor-pointer hover:shadow-md transition-shadow bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border-amber-200/50 dark:border-amber-800/30" onClick={() => navigate('/huddle')}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
                  <Sun className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-bold">Start Morning Huddle</h3>
                  <p className="text-xs text-muted-foreground">Rally the team for today's standup</p>
                </div>
                <i className="fas fa-chevron-right text-xs text-muted-foreground"></i>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-12 gap-6 px-6 pb-6">
            <div className="col-span-7 space-y-6">
              <TodaySchedulePanel />
            </div>
            <div className="col-span-5 space-y-6">
              <TimeClockWidget />
              <DailyGoalWidget />
              <ChoresWidget />
            </div>
          </div>

          <div className="px-6 pb-6">
            <h3 className="font-semibold text-sm mb-3 text-muted-foreground uppercase tracking-wide">Quick Actions</h3>
            <div className="grid grid-cols-6 gap-3">
              <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/schedules')}>
                <CardContent className="p-4 flex flex-col items-center text-center">
                  <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-2">
                    <Calendar className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <span className="text-xs font-medium">Schedules</span>
                </CardContent>
              </Card>
              <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/team')}>
                <CardContent className="p-4 flex flex-col items-center text-center">
                  <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-2">
                    <Users className="h-4 w-4 text-green-600 dark:text-green-400" />
                  </div>
                  <span className="text-xs font-medium">Team</span>
                </CardContent>
              </Card>
              <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/payroll')}>
                <CardContent className="p-4 flex flex-col items-center text-center">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mb-2">
                    <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <span className="text-xs font-medium">Payroll</span>
                </CardContent>
              </Card>
              <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/communication')}>
                <CardContent className="p-4 flex flex-col items-center text-center">
                  <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mb-2">
                    <MessageSquare className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                  </div>
                  <span className="text-xs font-medium">Messages</span>
                </CardContent>
              </Card>
              <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/availability')}>
                <CardContent className="p-4 flex flex-col items-center text-center">
                  <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center mb-2">
                    <Clock className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                  </div>
                  <span className="text-xs font-medium">Availability</span>
                </CardContent>
              </Card>
              <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => window.dispatchEvent(new Event("open-ask-mainager"))}>
                <CardContent className="p-4 flex flex-col items-center text-center">
                  <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-2">
                    <Bot className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <span className="text-xs font-medium">AI Assistant</span>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-6 px-6 pb-6">
            <div className="col-span-4">
              <KudosWidget />
            </div>
            <div className="col-span-4">
              <AIInsightsWidget />
            </div>
            <div className="col-span-4">
              <TeamActivityFeed />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-6 p-6">
            <div className="space-y-6">
              <TimeClockWidget />
              <ScheduleWidget />
              <KudosWidget />
            </div>
            <div className="space-y-6">
              <ChoresWidget />
              <AIInsightsWidget />
              <Card className="cursor-pointer hover:shadow-md transition-shadow bg-gradient-to-r from-slate-50 to-blue-50 dark:from-slate-950/20 dark:to-blue-950/20 border-slate-200/50 dark:border-slate-800/30" onClick={() => setShowDebrief(true)}>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
                    <ClipboardList className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-bold">Daily Debrief</h3>
                    <p className="text-xs text-muted-foreground">Reflect on your day</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="px-6 pb-6">
            <h3 className="font-semibold text-sm mb-3 text-muted-foreground uppercase tracking-wide">Quick Actions</h3>
            <div className="grid grid-cols-4 gap-3">
              <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/schedules')}>
                <CardContent className="p-4 flex flex-col items-center text-center">
                  <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-2">
                    <Calendar className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <span className="text-xs font-medium">View Schedule</span>
                </CardContent>
              </Card>
              <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/availability')}>
                <CardContent className="p-4 flex flex-col items-center text-center">
                  <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-2">
                    <Clock className="h-4 w-4 text-green-600 dark:text-green-400" />
                  </div>
                  <span className="text-xs font-medium">Availability</span>
                </CardContent>
              </Card>
              <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/communication')}>
                <CardContent className="p-4 flex flex-col items-center text-center">
                  <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mb-2">
                    <MessageSquare className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                  </div>
                  <span className="text-xs font-medium">Team Chat</span>
                </CardContent>
              </Card>
              <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => window.dispatchEvent(new Event("open-ask-mainager"))}>
                <CardContent className="p-4 flex flex-col items-center text-center">
                  <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-2">
                    <Bot className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <span className="text-xs font-medium">AI Assistant</span>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="px-6 pb-3">
            <ImprovementFeedWidget />
          </div>

          <div className="px-6 pb-6">
            <TeamActivityFeed />
          </div>
        </>
      )}

      <DailyDebriefSheet open={showDebrief} onOpenChange={setShowDebrief} />
    </div>
  );
}
