import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Trophy, Star, Target, TrendingUp, Medal, Crown,
  Flame, Zap, Award, ChevronUp, Users, Clock, Bell
} from 'lucide-react';

const TIER_CONFIG: Record<string, { color: string; bg: string; border: string; icon: React.ComponentType<{ className?: string }>; gradient: string }> = {
  bronze: { color: 'text-orange-700', bg: 'bg-orange-100', border: 'border-orange-300', icon: Medal, gradient: 'from-orange-400 to-orange-600' },
  silver: { color: 'text-gray-600', bg: 'bg-gray-100', border: 'border-gray-300', icon: Star, gradient: 'from-gray-400 to-gray-500' },
  gold: { color: 'text-yellow-600', bg: 'bg-yellow-100', border: 'border-yellow-400', icon: Trophy, gradient: 'from-yellow-400 to-yellow-600' },
  platinum: { color: 'text-blue-600', bg: 'bg-blue-100', border: 'border-blue-400', icon: Award, gradient: 'from-blue-400 to-blue-600' },
  diamond: { color: 'text-purple-600', bg: 'bg-purple-100', border: 'border-purple-400', icon: Crown, gradient: 'from-purple-400 to-purple-600' },
};

function ScoreRing({ score, tier, size = 120 }: { score: number; tier: string; size?: number }) {
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;
  const config = TIER_CONFIG[tier] || TIER_CONFIG.bronze;
  const TierIcon = config.icon;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/20" />
        <circle cx={size/2} cy={size/2} r={radius} fill="none" strokeWidth="8" strokeLinecap="round"
          stroke={`url(#gradient-${tier})`}
          strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
          className="transition-all duration-1000 ease-out" />
        <defs>
          <linearGradient id={`gradient-${tier}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={tier === 'diamond' ? '#8b5cf6' : tier === 'platinum' ? '#3b82f6' : tier === 'gold' ? '#eab308' : tier === 'silver' ? '#6b7280' : '#ea580c'} />
            <stop offset="100%" stopColor={tier === 'diamond' ? '#a855f7' : tier === 'platinum' ? '#60a5fa' : tier === 'gold' ? '#f59e0b' : tier === 'silver' ? '#9ca3af' : '#f97316'} />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <TierIcon className={`h-5 w-5 ${config.color} mb-0.5`} />
        <span className="text-2xl font-bold">{score}</span>
      </div>
    </div>
  );
}

function CategoryBar({ label, score, icon, color }: { label: string; score: number; icon: React.ComponentType<{ className?: string }>; color: string }) {
  const Icon = icon;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${color}`} />
          <span className="font-medium">{label}</span>
        </div>
        <span className="font-semibold">{score}/100</span>
      </div>
      <Progress value={score} className="h-2" />
    </div>
  );
}

interface LeaderboardEntry {
  rank: number;
  score: number;
  tier: string;
  isYou: boolean;
  streakDays: number;
}

interface AchievementData {
  achievementKey?: string;
  key?: string;
  achievementName?: string;
  name?: string;
  achievementIcon?: string;
  icon?: string;
  achievementDescription?: string;
  description?: string;
  earnedAt?: string;
}

interface ScoreHistoryEntry {
  snapshotDate: string;
  overallScore: number;
  tier: string;
}

interface ScoreData {
  overallScore: number;
  tier: string;
  breakdown: {
    attendance: { normalized: number };
    tasks: { normalized: number };
    sops: { normalized: number };
    engagement: { normalized: number };
  };
  nextTier: { nextTier: string | null; pointsNeeded: number; threshold: number } | null;
  streakDays: number;
  rank: number;
  totalMembers: number;
  achievements: AchievementData[];
  prizeEligibility: string | null;
}

function LeaderboardRow({ entry, index }: { entry: LeaderboardEntry; index: number }) {
  const config = TIER_CONFIG[entry.tier] || TIER_CONFIG.bronze;

  return (
    <div className={`flex items-center gap-3 py-3 px-3 rounded-lg ${entry.isYou ? 'bg-primary/10 border border-primary/30' : index % 2 === 0 ? 'bg-muted/30' : ''}`}>
      <div className="w-8 text-center">
        {entry.rank === 1 ? <span className="text-lg">👑</span> :
         entry.rank === 2 ? <span className="text-lg">🥈</span> :
         entry.rank === 3 ? <span className="text-lg">🥉</span> :
         <span className="text-sm font-semibold text-muted-foreground">#{entry.rank}</span>}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`${config.bg} ${config.color} ${config.border} text-xs capitalize`}>
            {entry.tier}
          </Badge>
          {entry.streakDays > 0 && (
            <span className="text-xs text-muted-foreground flex items-center gap-0.5">
              <Flame className="h-3 w-3 text-orange-500" />{entry.streakDays}d
            </span>
          )}
          {entry.isYou && <span className="text-xs font-semibold text-primary ml-auto">← You</span>}
        </div>
      </div>
      <div className="text-right">
        <span className="font-bold text-lg">{entry.score}</span>
        <span className="text-xs text-muted-foreground">/100</span>
      </div>
    </div>
  );
}

function AchievementBadge({ achievement, earned }: { achievement: AchievementData; earned: boolean }) {
  return (
    <div className={`flex flex-col items-center gap-1 p-3 rounded-xl border ${earned ? 'bg-card border-border' : 'bg-muted/30 border-transparent opacity-40'}`}>
      <span className="text-2xl">{achievement.achievementIcon || achievement.icon}</span>
      <span className="text-xs font-semibold text-center leading-tight">{achievement.achievementName || achievement.name}</span>
      {earned && achievement.earnedAt && (
        <span className="text-[10px] text-muted-foreground">{new Date(achievement.earnedAt).toLocaleDateString()}</span>
      )}
    </div>
  );
}

export default function MyScore() {
  const { user } = useAuth();
  const [historyRange, setHistoryRange] = useState('30d');
  const qc = useQueryClient();

  const { data: scoreData, isLoading } = useQuery<ScoreData>({
    queryKey: ['/api/gamification/my-score'],
    enabled: !!user,
  });

  const { data: leaderboardData, isLoading: lbLoading } = useQuery<{ leaderboard: LeaderboardEntry[] }>({
    queryKey: ['/api/gamification/leaderboard'],
    enabled: !!user,
  });

  const { data: historyData = [] } = useQuery<ScoreHistoryEntry[]>({
    queryKey: [`/api/gamification/score-history?range=${historyRange}`],
    enabled: !!user,
  });

  const { data: allAchievements = [] } = useQuery<AchievementData[]>({
    queryKey: ['/api/gamification/achievements'],
    enabled: !!user,
  });

  const { data: notifPref } = useQuery<{ scoreNotificationsEnabled: boolean }>({
    queryKey: ['/api/gamification/notification-preference'],
    enabled: !!user,
  });

  const toggleNotifMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      return await apiRequest('PUT', '/api/gamification/notification-preference', { enabled });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/gamification/notification-preference'] });
    },
  });

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  const tier = scoreData?.tier || 'bronze';
  const overallScore = scoreData?.overallScore || 0;
  const breakdown = scoreData?.breakdown;
  const nextTier = scoreData?.nextTier;
  const streakDays = scoreData?.streakDays || 0;
  const earnedAchievements = scoreData?.achievements || [];
  const earnedKeys = new Set(earnedAchievements.map((a: AchievementData) => a.achievementKey));
  const config = TIER_CONFIG[tier] || TIER_CONFIG.bronze;

  return (
    <div className="min-h-full bg-background pb-20">
      <div className={`bg-gradient-to-br ${config.gradient} text-white p-6 rounded-b-3xl md:rounded-xl md:m-6 md:mt-4`}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">My Score</h1>
            <p className="text-sm opacity-80 capitalize">{tier} Tier</p>
          </div>
          {streakDays > 0 && (
            <div className="flex items-center gap-1.5 bg-white/20 rounded-full px-3 py-1">
              <Flame className="h-4 w-4" />
              <span className="text-sm font-semibold">{streakDays} day streak</span>
            </div>
          )}
        </div>
        <div className="flex justify-center py-4">
          <ScoreRing score={overallScore} tier={tier} size={140} />
        </div>
        {nextTier?.nextTier && (
          <div className="text-center">
            <p className="text-sm opacity-80">
              <ChevronUp className="h-4 w-4 inline" /> {nextTier.pointsNeeded} points to{' '}
              <span className="font-semibold capitalize">{nextTier.nextTier}</span>
            </p>
            <Progress value={((overallScore - (TIER_CONFIG[tier] ? 0 : 0)) / nextTier.threshold) * 100} className="mt-2 h-1.5 bg-white/20" />
          </div>
        )}
        {scoreData?.prizeEligibility && (
          <div className="mt-3 bg-white/15 rounded-lg p-2 text-center text-sm">
            🎁 {scoreData.prizeEligibility}
          </div>
        )}
      </div>

      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        <Tabs defaultValue="breakdown">
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="breakdown">Score</TabsTrigger>
            <TabsTrigger value="rankings">Rank</TabsTrigger>
            <TabsTrigger value="achievements">Badges</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="breakdown" className="mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Target className="h-4 w-4 text-blue-500" /> Score Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {breakdown && (
                  <>
                    <CategoryBar label="Attendance" score={breakdown.attendance.normalized} icon={Clock} color="text-green-500" />
                    <CategoryBar label="Tasks" score={breakdown.tasks.normalized} icon={Target} color="text-blue-500" />
                    <CategoryBar label="SOPs" score={breakdown.sops.normalized} icon={Award} color="text-purple-500" />
                    <CategoryBar label="Engagement" score={breakdown.engagement.normalized} icon={Users} color="text-orange-500" />
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rankings" className="mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-yellow-500" /> Team Rankings
                  <span className="text-xs font-normal text-muted-foreground ml-auto">Anonymous</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-2">
                {lbLoading ? (
                  <div className="space-y-2">
                    {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {(leaderboardData?.leaderboard || []).map((entry: LeaderboardEntry, i: number) => (
                      <LeaderboardRow key={i} entry={entry} index={i} />
                    ))}
                    {(leaderboardData?.leaderboard || []).length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-6">No team data yet. Scores compute daily.</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="achievements" className="mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Star className="h-4 w-4 text-yellow-500" /> Achievement Badges
                  <Badge variant="outline" className="ml-auto text-xs">{earnedAchievements.length}/{allAchievements.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {earnedAchievements.map((a: AchievementData) => (
                    <AchievementBadge key={a.achievementKey} achievement={a} earned={true} />
                  ))}
                  {allAchievements.filter((a: AchievementData) => !earnedKeys.has(a.key)).map((a: AchievementData) => (
                    <AchievementBadge key={a.key} achievement={{ achievementIcon: a.icon, achievementName: a.name }} earned={false} />
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-green-500" /> Score History
                  </CardTitle>
                  <div className="flex gap-1">
                    {['7d', '30d', '90d', 'all'].map(range => (
                      <Button key={range} size="sm" variant={historyRange === range ? 'default' : 'ghost'}
                        className="h-7 text-xs px-2" onClick={() => setHistoryRange(range)}>
                        {range === 'all' ? 'All' : range}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {historyData.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No history yet. Scores are recorded daily at 2am.
                  </p>
                ) : (
                  <div className="space-y-0">
                    <div className="h-40 flex items-end gap-1">
                      {historyData.map((h: ScoreHistoryEntry, i: number) => {
                        const barHeight = Math.max(4, (h.overallScore / 100) * 100);
                        const tierC = TIER_CONFIG[h.tier] || TIER_CONFIG.bronze;
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${h.snapshotDate}: ${h.overallScore}`}>
                            <span className="text-[9px] text-muted-foreground">{h.overallScore}</span>
                            <div className={`w-full rounded-t bg-gradient-to-t ${tierC.gradient} transition-all`}
                              style={{ height: `${barHeight}%` }} />
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-1 px-1">
                      <span>{historyData[0]?.snapshotDate}</span>
                      <span>{historyData[historyData.length - 1]?.snapshotDate}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Card className="mt-4">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Score Notifications</p>
                  <p className="text-xs text-muted-foreground">Tier changes, achievements & weekly summaries</p>
                </div>
              </div>
              <Switch
                checked={notifPref?.scoreNotificationsEnabled ?? true}
                onCheckedChange={(checked) => toggleNotifMutation.mutate(checked)}
                disabled={toggleNotifMutation.isPending}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
