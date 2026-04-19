import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Skeleton } from '@/components/ui/skeleton';
import ErrorWithRetry from '@/components/ErrorWithRetry';
import { useOnlineRetry } from '@/hooks/useOnlineRetry';
import {
  BookOpen, ChevronRight, CheckCircle, XCircle, Trophy, Flame,
  Star, Zap, Crown, Users, Medal, X
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DQQuestion {
  id: string;
  questionText: string;
  questionType: 'multiple_choice' | 'true_false' | 'scenario';
  contextParagraph?: string;
  answerChoices: string[];
  correctAnswerIndex?: number;
  coachingText: string;
}

interface DQQuestionnaire {
  id: string;
  topic: string;
  quizDate: string;
  xpReward: number;
  questionCount: number;
  questions: DQQuestion[];
}

interface DQTodayData {
  questionnaire: DQQuestionnaire | null;
  completed: boolean;
  userResponse: { score: number; xpEarned: number } | null;
  teamCompletionCount: number;
  teamTotalCount: number;
  userBadges: Array<{ badgeType: string; topic?: string | null }>;
  noQuestionnaire?: boolean;
  userStreak: number;
}

interface DQSubmitResult {
  score: number;
  xpEarned: number;
  correctAnswers: number;
  totalQuestions: number;
  newBadges: Array<{ type: string; label: string; emoji: string; description: string }>;
  questionsWithAnswers: DQQuestion[];
}

interface LeaderEntry {
  totalXp?: number;
  userId: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  weeklyXp: number;
  completionCount: number;
  avgScore: number;
  rank: number;
  streak?: number;
  isMe: boolean;
  badges: Array<{ badgeType: string; emoji?: string }>;
}

interface LeaderboardData {
  weeklyLeaders: LeaderEntry[];
  seasonLeaders: LeaderEntry[];
  weekStart: string;
  currentUserId: string;
}

// ── Badge helpers ──────────────────────────────────────────────────────────────

const BADGE_EMOJI: Record<string, string> = {
  first_perfect_score: '🏆',
  seven_day_streak: '🔥',
  top_of_week: '👑',
  subject_matter_expert: '⭐',
  speed_demon: '⚡',
};

const BADGE_LABEL: Record<string, string> = {
  first_perfect_score: 'Perfect Score',
  seven_day_streak: '7-Day Streak',
  top_of_week: 'Top of Week',
  subject_matter_expert: 'Expert',
  speed_demon: 'Speed Demon',
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-yellow-500 font-extrabold text-lg">🥇</span>;
  if (rank === 2) return <span className="text-slate-400 font-extrabold text-lg">🥈</span>;
  if (rank === 3) return <span className="text-orange-600 font-extrabold text-lg">🥉</span>;
  return <span className="text-sm font-bold text-muted-foreground w-7 text-center">{rank}</span>;
}

function Avatar({ user }: { user: { firstName?: string | null; lastName?: string | null; profileImageUrl?: string | null } }) {
  const initials = `${(user.firstName || '?')[0]}${(user.lastName || '')[0] || ''}`.toUpperCase();
  if (user.profileImageUrl) {
    return <img src={user.profileImageUrl} alt={initials} className="w-9 h-9 rounded-full object-cover" />;
  }
  return (
    <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center text-sm font-extrabold text-primary">
      {initials}
    </div>
  );
}

// ── Leaderboard Modal ──────────────────────────────────────────────────────────

function LeaderboardModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'weekly' | 'season'>('weekly');

  const { data, isLoading } = useQuery<{ success: boolean; data: LeaderboardData }>({
    queryKey: ['/api/daily-questionnaire/leaderboard'],
    staleTime: 60_000,
  });

  const leaders = tab === 'weekly' ? (data?.data?.weeklyLeaders ?? []) : (data?.data?.seasonLeaders ?? []);

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-end justify-center sm:items-center" onClick={onClose}>
      <div
        className="bg-background w-full max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[80vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5 border-b border-border flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Team Standings</p>
            <h3 className="text-lg font-extrabold text-foreground">Training Leaderboard</h3>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex gap-1 p-3 border-b border-border">
          {(['weekly', 'season'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
            >
              {t === 'weekly' ? 'This Week' : 'All Time'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-14 w-full rounded-2xl" />)}
            </div>
          ) : leaders.length === 0 ? (
            <div className="text-center py-12">
              <Trophy className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-base font-bold text-foreground">No entries yet</p>
              <p className="text-sm text-muted-foreground mt-1">Complete today's training to appear here!</p>
            </div>
          ) : (
            leaders.map(leader => (
              <div
                key={leader.userId}
                className={`flex items-center gap-3 p-3 rounded-2xl transition-all ${leader.isMe ? 'bg-primary/8 border border-primary/20' : 'bg-muted/50'}`}
                style={leader.isMe ? { background: 'hsl(var(--primary) / 0.08)', border: '1px solid hsl(var(--primary) / 0.2)' } : undefined}
              >
                <RankBadge rank={leader.rank} />
                <Avatar user={leader} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">
                    {leader.firstName} {leader.lastName}
                    {leader.isMe && <span className="ml-1.5 text-xs text-primary font-semibold">(you)</span>}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {leader.badges.slice(0, 3).map((b, i) => (
                      <span key={i} className="text-xs" title={BADGE_LABEL[b.badgeType] ?? b.badgeType}>
                        {b.emoji ?? BADGE_EMOJI[b.badgeType] ?? '🏅'}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-extrabold text-foreground">{leader.weeklyXp ?? leader.totalXp ?? 0} XP</p>
                  <div className="flex items-center gap-1.5 justify-end mt-0.5">
                    {leader.streak != null && leader.streak > 1 && (
                      <span className="text-xs font-bold" style={{ color: 'hsl(30 90% 55%)' }}>🔥{leader.streak}</span>
                    )}
                    {leader.avgScore > 0 && (
                      <p className="text-xs text-muted-foreground">{leader.avgScore}% avg</p>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Badge Unlock Screen ────────────────────────────────────────────────────────

function BadgeUnlockScreen({ badges, onContinue }: {
  badges: Array<{ type: string; label: string; emoji: string; description: string }>;
  onContinue: () => void;
}) {
  return (
    <div className="py-4 space-y-5 text-center">
      <p className="text-xs font-bold uppercase tracking-wider text-primary">New Badges Unlocked!</p>
      <div className="space-y-4">
        {badges.map(badge => (
          <div
            key={badge.type}
            className="rounded-2xl p-5 space-y-2"
            style={{ background: 'linear-gradient(135deg, hsl(45 100% 60% / 0.12), hsl(25 90% 60% / 0.08))', border: '1px solid hsl(45 100% 60% / 0.3)' }}
          >
            <div className="text-5xl">{badge.emoji}</div>
            <p className="text-lg font-extrabold text-foreground">{badge.label}</p>
            <p className="text-sm text-muted-foreground">{badge.description}</p>
          </div>
        ))}
      </div>
      <button
        onClick={onContinue}
        className="w-full py-3 rounded-2xl bg-primary text-primary-foreground font-bold"
      >
        View Leaderboard →
      </button>
    </div>
  );
}

// ── Completion Screen ──────────────────────────────────────────────────────────

function CompletionScreen({ result, onShowLeaderboard, onClose }: {
  result: DQSubmitResult;
  onShowLeaderboard: () => void;
  onClose: () => void;
}) {
  const [showBadges, setShowBadges] = useState(result.newBadges.length > 0);

  if (showBadges && result.newBadges.length > 0) {
    return <BadgeUnlockScreen badges={result.newBadges} onContinue={() => { setShowBadges(false); onShowLeaderboard(); }} />;
  }

  const emoji = result.score === 100 ? '🏆' : result.score >= 80 ? '🎯' : result.score >= 60 ? '👍' : '📚';

  return (
    <div className="py-4 space-y-4">
      <div className="text-center space-y-2">
        <div className="text-6xl">{emoji}</div>
        <p className="text-3xl font-extrabold text-foreground">{result.score}%</p>
        <p className="text-muted-foreground">{result.correctAnswers} / {result.totalQuestions} correct</p>
      </div>

      <div className="rounded-2xl p-4 text-center" style={{ background: 'linear-gradient(135deg, hsl(45 100% 60% / 0.15), hsl(25 90% 60% / 0.08))', border: '1px solid hsl(45 100% 60% / 0.3)' }}>
        <p className="text-2xl font-extrabold text-foreground">+{result.xpEarned} XP</p>
        <p className="text-sm text-muted-foreground mt-0.5">Training points earned</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={onShowLeaderboard}
          className="py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2"
          style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--foreground))' }}
        >
          <Trophy className="h-4 w-4" /> Leaderboard
        </button>
        <button
          onClick={onClose}
          className="py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm"
        >
          Done
        </button>
      </div>
    </div>
  );
}

interface CheckAnswerResult {
  isCorrect: boolean;
  correctAnswerIndex: number;
  coachingText: string;
}

// ── Question Flow ──────────────────────────────────────────────────────────────

const RESUME_KEY_PREFIX = 'dq_progress_';

function QuestionFlow({
  questionnaire,
  onComplete,
  onClose,
}: {
  questionnaire: DQQuestionnaire;
  onComplete: (result: DQSubmitResult) => void;
  onClose: () => void;
}) {
  const resumeKey = `${RESUME_KEY_PREFIX}${questionnaire.id}`;

  function loadSavedProgress() {
    try {
      const saved = sessionStorage.getItem(resumeKey);
      if (saved) {
        const p = JSON.parse(saved);
        return { qIndex: p.qIndex ?? 0, userAnswers: p.userAnswers ?? [], startTime: p.startTime ?? Date.now() };
      }
    } catch { /* ignore */ }
    return null;
  }

  const savedProgress = loadSavedProgress();
  const [qIndex, setQIndex] = useState(savedProgress?.qIndex ?? 0);
  const [userAnswers, setUserAnswers] = useState<Array<{ questionIndex: number; selectedIndex: number }>>(savedProgress?.userAnswers ?? []);
  const [selected, setSelected] = useState<number | null>(null);
  const [checkResult, setCheckResult] = useState<CheckAnswerResult | null>(null);
  const startTimeRef = useRef<number>(savedProgress?.startTime ?? Date.now());

  function saveProgress(newQIndex: number, newAnswers: Array<{ questionIndex: number; selectedIndex: number }>) {
    try {
      sessionStorage.setItem(resumeKey, JSON.stringify({ qIndex: newQIndex, userAnswers: newAnswers, startTime: startTimeRef.current }));
    } catch { /* ignore */ }
  }

  function clearProgress() {
    try { sessionStorage.removeItem(resumeKey); } catch { /* ignore */ }
  }

  const queryClient = useQueryClient();

  const checkAnswerMutation = useMutation<{ success: boolean; data: CheckAnswerResult }, Error, { questionnaireId: string; questionIndex: number; selectedIndex: number }>({
    mutationFn: async (payload) => {
      const res = await apiRequest('POST', '/api/daily-questionnaire/check-answer', payload);
      return res.json();
    },
    onSuccess: (data) => {
      setCheckResult(data.data);
    },
  });

  const submitMutation = useMutation<{ success: boolean; data: DQSubmitResult & { alreadyCompleted?: boolean } }, Error, { questionnaireId: string; answers: Array<{ questionIndex: number; selectedIndex: number }>; durationSeconds: number }>({
    mutationFn: async (payload) => {
      const res = await apiRequest('POST', '/api/daily-questionnaire/submit', payload);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/daily-questionnaire/today'] });
      queryClient.invalidateQueries({ queryKey: ['/api/daily-questionnaire/leaderboard'] });
      if (data.data.alreadyCompleted) {
        // Duplicate submission — close the flow gracefully
        onClose();
        return;
      }
      onComplete(data.data);
    },
  });

  const questions = questionnaire.questions;
  const currentQ = questions[qIndex];
  const progress = ((qIndex) / questions.length) * 100;
  const showFeedback = checkResult !== null;
  const isCorrect = checkResult?.isCorrect ?? false;

  function handleSelect(idx: number) {
    if (selected !== null || checkAnswerMutation.isPending) return;
    setSelected(idx);
    setCheckResult(null);
    checkAnswerMutation.mutate({
      questionnaireId: questionnaire.id,
      questionIndex: qIndex,
      selectedIndex: idx,
    });
  }

  function handleNext() {
    const newAnswers = [...userAnswers, { questionIndex: qIndex, selectedIndex: selected! }];
    setUserAnswers(newAnswers);

    if (qIndex === questions.length - 1) {
      clearProgress();
      const durationSeconds = Math.round((Date.now() - startTimeRef.current) / 1000);
      submitMutation.mutate({
        questionnaireId: questionnaire.id,
        answers: newAnswers,
        durationSeconds,
      });
    } else {
      const nextIndex = qIndex + 1;
      saveProgress(nextIndex, newAnswers);
      setQIndex(nextIndex);
      setSelected(null);
      setCheckResult(null);
    }
  }

  if (submitMutation.isPending) {
    return (
      <div className="py-16 flex flex-col items-center gap-4">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
        <p className="text-sm text-muted-foreground font-semibold">Calculating your score...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{questionnaire.topic}</p>
          <p className="text-lg font-extrabold text-foreground">Question {qIndex + 1} of {questions.length}</p>
        </div>
        <button onClick={onClose} className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {currentQ?.questionType === 'scenario' && currentQ.contextParagraph && (
        <div className="rounded-2xl p-4" style={{ background: 'hsl(210 80% 60% / 0.08)', border: '1px solid hsl(210 80% 60% / 0.2)' }}>
          <p className="text-xs font-bold text-blue-600 dark:text-blue-400 mb-1 uppercase tracking-wide">Scenario</p>
          <p className="text-sm text-foreground leading-relaxed">{currentQ.contextParagraph}</p>
        </div>
      )}

      <div className="rounded-2xl p-4" style={{ background: 'hsl(var(--muted))' }}>
        <p className="text-base font-bold text-foreground leading-snug">{currentQ?.questionText}</p>
        {currentQ?.questionType === 'true_false' && (
          <p className="text-xs text-muted-foreground mt-1 font-medium">True or False?</p>
        )}
      </div>

      <div className="space-y-2.5">
        {currentQ?.answerChoices.map((choice, i) => {
          const isSelected = selected === i;
          const isCorrectChoice = showFeedback && i === checkResult?.correctAnswerIndex;
          const isWrongSelected = showFeedback && isSelected && !isCorrect;
          return (
            <button
              key={i}
              onClick={() => handleSelect(i)}
              disabled={selected !== null}
              className="w-full text-left px-4 py-3.5 rounded-2xl font-semibold text-sm transition-all"
              style={{
                background: isCorrectChoice
                  ? 'hsl(142 60% 50% / 0.15)'
                  : isWrongSelected
                    ? 'hsl(0 90% 60% / 0.15)'
                    : isSelected
                      ? 'hsl(var(--primary) / 0.1)'
                      : 'hsl(var(--muted))',
                border: `2px solid ${isCorrectChoice
                  ? 'hsl(142 60% 50%)'
                  : isWrongSelected
                    ? 'hsl(0 90% 60%)'
                    : isSelected
                      ? 'hsl(var(--primary))'
                      : 'transparent'}`,
              }}
            >
              <span className="flex items-center gap-2">
                {isCorrectChoice && <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />}
                {isWrongSelected && <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />}
                {choice}
              </span>
            </button>
          );
        })}
      </div>

      {checkAnswerMutation.isPending && (
        <div className="flex items-center justify-center py-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
        </div>
      )}

      {showFeedback && (
        <div
          className="rounded-2xl p-4 space-y-2"
          style={{ background: isCorrect ? 'hsl(142 60% 50% / 0.08)' : 'hsl(0 90% 60% / 0.08)' }}
        >
          <p className="font-bold text-sm" style={{ color: isCorrect ? 'hsl(142 60% 35%)' : 'hsl(0 90% 45%)' }}>
            {isCorrect ? '✓ Correct!' : '✗ Not quite'}
          </p>
          {checkResult?.coachingText && (
            <p className="text-sm text-muted-foreground leading-relaxed">{checkResult.coachingText}</p>
          )}
          <button
            onClick={handleNext}
            className="mt-2 w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm"
          >
            {qIndex < questions.length - 1 ? 'Next Question →' : 'See Results →'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main DailyQuestionnaireCard ────────────────────────────────────────────────

export default function DailyQuestionnaireCard() {
  const [modalOpen, setModalOpen] = useState(false);
  const [flowState, setFlowState] = useState<'intro' | 'questions' | 'complete' | 'leaderboard'>('intro');
  const [submitResult, setSubmitResult] = useState<DQSubmitResult | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<{ success: boolean; data: DQTodayData }>({
    queryKey: ['/api/daily-questionnaire/today'],
    staleTime: 60_000,
  });

  const today = data?.data;

  useOnlineRetry(refetch, isError);

  if (isLoading) return <Skeleton className="h-24 w-full rounded-3xl" />;

  if (isError) {
    return <ErrorWithRetry onRetry={() => refetch()} message="Could not load today's training" className="rounded-3xl" />;
  }

  if (!today?.questionnaire || today.noQuestionnaire) return null;

  const { questionnaire, completed, userResponse, teamCompletionCount, teamTotalCount, userStreak } = today;

  const hasResumeData = !completed && (() => {
    try {
      const saved = sessionStorage.getItem(`${RESUME_KEY_PREFIX}${questionnaire.id}`);
      if (!saved) return false;
      const p = JSON.parse(saved);
      return (p.qIndex ?? 0) > 0;
    } catch { return false; }
  })();

  function handleOpen() {
    setModalOpen(true);
    if (completed) {
      setFlowState('complete');
    } else {
      setFlowState('questions');
    }
  }

  function handleComplete(result: DQSubmitResult) {
    setSubmitResult(result);
    setFlowState('complete');
  }

  const topicLabel = questionnaire.topic.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <>
      <button
        onClick={handleOpen}
        className="w-full rounded-3xl p-4 text-left transition-all active:scale-[0.98]"
        style={{
          background: completed
            ? 'linear-gradient(135deg, hsl(142 60% 50% / 0.08), hsl(142 60% 50% / 0.04))'
            : 'linear-gradient(135deg, hsl(25 91% 57% / 0.12), hsl(340 80% 60% / 0.07))',
          border: `1px solid ${completed ? 'hsl(142 60% 50% / 0.25)' : 'hsl(25 91% 57% / 0.3)'}`,
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: completed ? 'hsl(142 60% 50% / 0.15)' : 'hsl(25 91% 57% / 0.15)' }}
          >
            {completed
              ? <CheckCircle className="h-5 w-5 text-green-500" />
              : <BookOpen className="h-5 w-5" style={{ color: 'hsl(25 91% 57%)' }} />
            }
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-extrabold text-foreground">
              {completed ? 'Daily Training Done!' : 'Daily Training'}
            </p>
            <p className="text-sm text-muted-foreground truncate">
              {completed
                ? `Score: ${userResponse?.score ?? 0}% · +${userResponse?.xpEarned ?? 0} XP earned`
                : hasResumeData
                  ? `In progress · ${topicLabel} · ${questionnaire.xpReward} XP on offer`
                  : `${topicLabel} · ${questionnaire.xpReward} XP on offer`
              }
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {userStreak > 1 && (
              <span className="flex items-center gap-1 text-xs font-extrabold" style={{ color: 'hsl(30 90% 55%)' }}>
                🔥 {userStreak} day streak
              </span>
            )}
            {teamTotalCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground font-semibold">
                <Users className="h-3 w-3" />
                {teamCompletionCount}/{teamTotalCount}
              </span>
            )}
            {!completed && (
              <span className="text-xs font-bold px-2.5 py-1 rounded-full text-white" style={{ background: hasResumeData ? 'hsl(220 80% 55%)' : 'hsl(25 91% 57%)' }}>
                {hasResumeData ? 'Resume' : 'Start'}
              </span>
            )}
            {completed && <ChevronRight className="h-4 w-4 text-muted-foreground/50" />}
          </div>
        </div>
      </button>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background sm:bg-black/60 sm:items-center sm:justify-center" onClick={() => setModalOpen(false)}>
          <div
            className="bg-background w-full h-full sm:h-auto sm:max-w-lg sm:rounded-3xl sm:max-h-[90vh] overflow-y-auto flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-5 flex-1">
              {flowState === 'questions' && !completed && (
                <QuestionFlow
                  questionnaire={questionnaire}
                  onComplete={handleComplete}
                  onClose={() => setModalOpen(false)}
                />
              )}

              {(flowState === 'complete' || completed) && submitResult && (
                <CompletionScreen
                  result={submitResult}
                  onShowLeaderboard={() => { setShowLeaderboard(true); }}
                  onClose={() => setModalOpen(false)}
                />
              )}

              {(flowState === 'complete' || completed) && !submitResult && (
                <div className="py-6 space-y-4 text-center">
                  <div className="text-5xl">✅</div>
                  <p className="text-xl font-extrabold">Already completed today!</p>
                  <p className="text-muted-foreground">
                    Score: {userResponse?.score ?? 0}% · +{userResponse?.xpEarned ?? 0} XP earned
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setShowLeaderboard(true)}
                      className="py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2"
                      style={{ background: 'hsl(var(--muted))' }}
                    >
                      <Trophy className="h-4 w-4" /> Leaderboard
                    </button>
                    <button
                      onClick={() => setModalOpen(false)}
                      className="py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showLeaderboard && <LeaderboardModal onClose={() => setShowLeaderboard(false)} />}
    </>
  );
}
