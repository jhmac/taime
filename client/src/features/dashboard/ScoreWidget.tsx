import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Trophy, Medal, Star, Award, Crown, Flame, ChevronRight } from 'lucide-react';

const TIER_ICONS: Record<string, any> = {
  bronze: Medal, silver: Star, gold: Trophy, platinum: Award, diamond: Crown,
};
const TIER_COLORS: Record<string, string> = {
  bronze: 'text-orange-600 bg-orange-100 border-orange-300',
  silver: 'text-gray-600 bg-gray-100 border-gray-300',
  gold: 'text-yellow-600 bg-yellow-100 border-yellow-400',
  platinum: 'text-blue-600 bg-blue-100 border-blue-400',
  diamond: 'text-purple-600 bg-purple-100 border-purple-400',
};

export default function ScoreWidget() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const { data: scoreData, isLoading } = useQuery<any>({
    queryKey: ['/api/gamification/my-score'],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return <Skeleton className="h-20 w-full rounded-xl" />;
  }

  if (!scoreData) return null;

  const tier = scoreData.tier || 'bronze';
  const score = scoreData.overallScore || 0;
  const TierIcon = TIER_ICONS[tier] || Medal;
  const tierColor = TIER_COLORS[tier] || TIER_COLORS.bronze;
  const streakDays = scoreData.streakDays || 0;
  const rank = scoreData.rank || 0;
  const totalMembers = scoreData.totalMembers || 0;

  return (
    <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/my-score')}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <svg width="56" height="56" className="transform -rotate-90">
              <circle cx="28" cy="28" r="22" fill="none" stroke="currentColor" strokeWidth="5" className="text-muted/20" />
              <circle cx="28" cy="28" r="22" fill="none" strokeWidth="5" strokeLinecap="round"
                className={tier === 'diamond' ? 'stroke-purple-500' : tier === 'platinum' ? 'stroke-blue-500' : tier === 'gold' ? 'stroke-yellow-500' : tier === 'silver' ? 'stroke-gray-400' : 'stroke-orange-500'}
                strokeDasharray={2 * Math.PI * 22} strokeDashoffset={2 * Math.PI * 22 * (1 - score / 100)} />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-sm font-bold">{score}</span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold">My Score</span>
              <Badge variant="outline" className={`text-xs capitalize ${tierColor}`}>
                <TierIcon className="h-3 w-3 mr-0.5" />{tier}
              </Badge>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              {rank > 0 && <span>Rank #{rank} of {totalMembers}</span>}
              {streakDays > 0 && (
                <span className="flex items-center gap-0.5">
                  <Flame className="h-3 w-3 text-orange-500" />{streakDays}d streak
                </span>
              )}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}
