import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { User } from '@shared/schema';

const CATEGORY_LABELS: Record<string, string> = {
  attendance: 'Attendance',
  breaks: 'Breaks',
  tasks: 'Tasks',
  chores: 'Chores',
  availability: 'Availability',
  other: 'Other',
};

const CATEGORY_ICONS: Record<string, string> = {
  attendance: 'fas fa-clock',
  breaks: 'fas fa-coffee',
  tasks: 'fas fa-check-square',
  chores: 'fas fa-broom',
  availability: 'fas fa-calendar-check',
  other: 'fas fa-star',
};

const CATEGORY_COLORS: Record<string, string> = {
  attendance: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  breaks: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  tasks: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  chores: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  availability: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',
  other: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
};

function getDateRange(period: string) {
  const now = new Date();
  let startDate: Date;
  switch (period) {
    case '7d':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case '90d':
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    default:
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  return { startDate: startDate.toISOString(), endDate: now.toISOString() };
}

export default function Performance() {
  const { user } = useAuth();
  const [period, setPeriod] = useState('30d');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const roleName = (user as any)?.role?.name || '';
  const canViewAll = ['admin', 'owner', 'manager', 'full_admin', 'shift_lead'].includes(roleName);

  const { startDate, endDate } = getDateRange(period);

  const scoresUrl = `/api/performance/scores?startDate=${startDate}&endDate=${endDate}`;
  const { data: scores = [], isLoading: scoresLoading } = useQuery<any[]>({
    queryKey: [scoresUrl],
  });

  const { data: allUsers = [] } = useQuery<User[]>({
    queryKey: ['/api/users'],
    enabled: canViewAll,
  });

  const viewUserId = selectedUserId || user?.id;

  const detailUrl = viewUserId
    ? `/api/performance/scores/${viewUserId}?startDate=${startDate}&endDate=${endDate}`
    : null;
  const { data: userDetail, isLoading: detailLoading } = useQuery<any>({
    queryKey: [detailUrl],
    enabled: !!detailUrl,
  });

  const getUserName = (userId: string) => {
    const u = allUsers.find((u: any) => u.id === userId);
    return u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email : userId.slice(0, 8);
  };

  const getRankBadge = (rank: number) => {
    if (rank === 1) return <Badge className="bg-yellow-500 text-white"><i className="fas fa-trophy mr-1" />1st</Badge>;
    if (rank === 2) return <Badge className="bg-gray-400 text-white"><i className="fas fa-medal mr-1" />2nd</Badge>;
    if (rank === 3) return <Badge className="bg-amber-700 text-white"><i className="fas fa-medal mr-1" />3rd</Badge>;
    return <Badge variant="outline">#{rank}</Badge>;
  };

  const getScoreColor = (points: number) => {
    if (points >= 50) return 'text-green-600 dark:text-green-400';
    if (points >= 0) return 'text-blue-600 dark:text-blue-400';
    return 'text-red-600 dark:text-red-400';
  };

  return (
    <div className="p-4 pb-24 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Performance</h1>
          <p className="text-sm text-muted-foreground">
            {canViewAll ? 'Team performance scores and rankings' : 'Your performance overview'}
          </p>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue={canViewAll ? "rankings" : "my-score"}>
        <TabsList className="grid w-full grid-cols-2">
          {canViewAll && <TabsTrigger value="rankings">Team Rankings</TabsTrigger>}
          <TabsTrigger value="my-score">{canViewAll ? 'Individual Detail' : 'My Score'}</TabsTrigger>
          {!canViewAll && <TabsTrigger value="events">Recent Events</TabsTrigger>}
        </TabsList>

        {canViewAll && (
          <TabsContent value="rankings" className="space-y-4">
            {scoresLoading ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  <i className="fas fa-spinner fa-spin mr-2" />Loading rankings...
                </CardContent>
              </Card>
            ) : scores.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  <i className="fas fa-chart-bar mr-2" />
                  No performance data yet. Events will appear as employees clock in, complete tasks, and more.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {scores.map((score: any, index: number) => (
                  <Card
                    key={score.userId}
                    className={`cursor-pointer hover:shadow-md transition-shadow ${
                      selectedUserId === score.userId ? 'ring-2 ring-primary' : ''
                    }`}
                    onClick={() => setSelectedUserId(score.userId)}
                  >
                    <CardContent className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        {getRankBadge(index + 1)}
                        <div>
                          <p className="font-medium text-foreground">{getUserName(score.userId)}</p>
                          <p className="text-xs text-muted-foreground">{score.eventCount} events</p>
                        </div>
                      </div>
                      <div className={`text-xl font-bold ${getScoreColor(score.totalPoints)}`}>
                        {score.totalPoints > 0 ? '+' : ''}{score.totalPoints}
                        <span className="text-xs font-normal text-muted-foreground ml-1">pts</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        )}

        <TabsContent value="my-score" className="space-y-4">
          {canViewAll && (
            <div className="mb-4">
              <Select value={selectedUserId || user?.id || ''} onValueChange={setSelectedUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {allUsers.map((u: any) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.firstName || ''} {u.lastName || ''} ({u.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {detailLoading ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <i className="fas fa-spinner fa-spin mr-2" />Loading...
              </CardContent>
            </Card>
          ) : !userDetail ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                No performance data available.
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center justify-between">
                    <span>
                      <i className="fas fa-star text-primary mr-2" />
                      Overall Score
                    </span>
                    <span className={`text-2xl ${getScoreColor(userDetail.totalPoints)}`}>
                      {userDetail.totalPoints > 0 ? '+' : ''}{userDetail.totalPoints} pts
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Based on {userDetail.eventCount} events across {Object.keys(userDetail.categoryBreakdown || {}).length} categories
                  </p>
                </CardContent>
              </Card>

              {userDetail.categoryBreakdown && Object.keys(userDetail.categoryBreakdown).length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Category Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {Object.entries(userDetail.categoryBreakdown).map(([category, data]: [string, any]) => (
                      <div key={category} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${CATEGORY_COLORS[category] || CATEGORY_COLORS.other}`}>
                            <i className={`${CATEGORY_ICONS[category] || CATEGORY_ICONS.other} text-xs`} />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{CATEGORY_LABELS[category] || category}</p>
                            <p className="text-xs text-muted-foreground">{data.count} events</p>
                          </div>
                        </div>
                        <span className={`font-bold ${getScoreColor(data.points)}`}>
                          {data.points > 0 ? '+' : ''}{data.points}
                        </span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {userDetail.recentEvents && userDetail.recentEvents.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Recent Events</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {userDetail.recentEvents.map((event: any) => (
                        <div key={event.id} className="flex items-center justify-between py-2 border-b last:border-0">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${
                              (event.pointValue || 0) > 0 ? 'bg-green-500' :
                              (event.pointValue || 0) < 0 ? 'bg-red-500' : 'bg-gray-400'
                            }`} />
                            <div>
                              <p className="text-sm font-medium">{event.eventType.replace(/-/g, ' ')}</p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(event.createdAt).toLocaleString()}
                              </p>
                            </div>
                          </div>
                          <span className={`text-sm font-bold ${getScoreColor(event.pointValue || 0)}`}>
                            {(event.pointValue || 0) > 0 ? '+' : ''}{event.pointValue || 0}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {!canViewAll && (
          <TabsContent value="events" className="space-y-4">
            {detailLoading ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  <i className="fas fa-spinner fa-spin mr-2" />Loading...
                </CardContent>
              </Card>
            ) : !userDetail?.recentEvents?.length ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  No events recorded yet.
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="pt-4">
                  <div className="space-y-2 max-h-[70vh] overflow-y-auto">
                    {userDetail.recentEvents.map((event: any) => (
                      <div key={event.id} className="flex items-center justify-between py-2 border-b last:border-0">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${
                            (event.pointValue || 0) > 0 ? 'bg-green-500' :
                            (event.pointValue || 0) < 0 ? 'bg-red-500' : 'bg-gray-400'
                          }`} />
                          <div>
                            <p className="text-sm font-medium capitalize">{event.eventType.replace(/-/g, ' ')}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(event.createdAt).toLocaleString()}
                            </p>
                          </div>
                        </div>
                        <span className={`text-sm font-bold ${getScoreColor(event.pointValue || 0)}`}>
                          {(event.pointValue || 0) > 0 ? '+' : ''}{event.pointValue || 0}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
