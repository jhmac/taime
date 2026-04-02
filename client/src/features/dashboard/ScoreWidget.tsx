import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { Skeleton } from '@/components/ui/skeleton';
import { Trophy, Medal, Star, Award, Crown, Flame, ArrowRight } from 'lucide-react';

const TIER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  bronze: Medal, silver: Star, gold: Trophy, platinum: Award, diamond: Crown,
};
const TIER_BG: Record<string, string> = {
  bronze: 'bg-orange-500 dark:bg-orange-600',
  silver: 'bg-slate-500 dark:bg-slate-600',
  gold: 'bg-yellow-500 dark:bg-yellow-600',
  platinum: 'bg-blue-600 dark:bg-blue-700',
  diamond: 'bg-purple-600 dark:bg-purple-700',
};

export default function ScoreWidget() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const { data: scoreData, isLoading } = useQuery<{
    overallScore: number;
    tier: string;
    streakDays: number;
    rank: number;
    totalMembers: number;
  }>({
    queryKey: ['/api/gamification/my-score'],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return <Skeleton className="h-20 w-full rounded-2xl" />;
  }

  if (!scoreData) return null;

  const tier = scoreData.tier || 'bronze';
  const score = scoreData.overallScore || 0;
  const TierIcon = TIER_ICONS[tier] || Medal;
  const bgClass = TIER_BG[tier] || TIER_BG.bronze;
  const streakDays = scoreData.streakDays || 0;
  const rank = scoreData.rank || 0;
  const totalMembers = scoreData.totalMembers || 0;

  return (
    <button
      onClick={() => navigate('/my-score')}
      className={`w-full rounded-2xl ${bgClass} p-4 flex items-center gap-4 transition-transform active:scale-95 hover:brightness-110 cursor-pointer text-left`}
    >
      <div className="relative shrink-0">
        <svg width="56" height="56" className="transform -rotate-90">
          <circle cx="28" cy="28" r="22" fill="none" stroke="white" strokeOpacity="0.2" strokeWidth="5" />
          <circle cx="28" cy="28" r="22" fill="none" strokeWidth="5" strokeLinecap="round"
            stroke="white" strokeOpacity="0.9"
            strokeDasharray={2 * Math.PI * 22} strokeDashoffset={2 * Math.PI * 22 * (1 - score / 100)} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold text-white">{score}</span>
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-white">My Score</span>
          <span className="text-xs text-white/80 capitalize flex items-center gap-0.5">
            <TierIcon className="h-3.5 w-3.5" />{tier}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-white/70">
          {rank > 0 && <span>Rank #{rank} of {totalMembers}</span>}
          {streakDays > 0 && (
            <span className="flex items-center gap-0.5">
              <Flame className="h-3 w-3 text-white/80" />{streakDays}d streak
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0 text-white/80 text-xs font-semibold">
        View <ArrowRight className="h-4 w-4" />
      </div>
    </button>
  );
}
