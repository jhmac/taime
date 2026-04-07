import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import {
  ChevronLeft, ChevronRight, Pause, Play, Star, Target,
  AlertTriangle, Heart, Rocket, X, BookOpen, CheckCircle2, XCircle
} from 'lucide-react';

const SLIDE_AUTO_ADVANCE_MS = 60000;

interface HuddleData {
  id: string;
  storeId: string;
  huddleDate: string;
  ledBy: string | null;
  attendees: string[];
  winOfTheDay: string | null;
  leanPrinciple: string | null;
  goals: string[];
  headsUp: string[];
  kudosSurfaced: any[];
  aiGeneratedContent: any;
  status: string;
  ledByName: string | null;
  attendeeNames: string[];
}

export default function MorningHuddle() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [checkedAttendees, setCheckedAttendees] = useState<string[]>([]);
  const [huddleStarted, setHuddleStarted] = useState(false);
  const [momentAnswered, setMomentAnswered] = useState(false);
  const [momentResult, setMomentResult] = useState<{ isCorrect: boolean; correctAnswerIndex: number; quizContext?: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchStartRef = useRef<number>(0);

  const { data, isLoading } = useQuery<{ success: boolean; data: HuddleData }>({
    queryKey: ['/api/rituals/huddle/today'],
  });

  const { data: teamData } = useQuery<any[]>({
    queryKey: ['/api/users'],
  });

  const { data: kudosData } = useQuery<{ success: boolean; data: any[] }>({
    queryKey: ['/api/kudos'],
  });

  const { data: momentData } = useQuery<{ success: boolean; data: any }>({
    queryKey: ['/api/ai/morning-moment'],
    retry: 1,
  });

  const answerMomentMutation = useMutation({
    mutationFn: async (selectedIndex: number) => {
      const res = await apiRequest('POST', '/api/ai/morning-moment/answer', { selectedIndex });
      return res.json();
    },
    onSuccess: (data) => {
      const result = data.data;
      setMomentResult({ isCorrect: result.isCorrect, correctAnswerIndex: result.correctAnswerIndex, quizContext: result.quizContext });
      setMomentAnswered(true);
      if (result.isCorrect && result.pointsAwarded > 0) {
        toast({ title: `+${result.pointsAwarded} points!`, description: 'Correct answer on the Learning Moment!' });
      }
      qc.invalidateQueries({ queryKey: ['/api/gamification/my-score'] });
    },
    onError: () => {
      toast({ title: 'Unable to submit answer', variant: 'destructive' });
    },
  });

  const huddle = data?.data;
  const team = teamData ?? [];
  const recentKudos = (kudosData?.data ?? []).slice(0, 5);
  const moment = momentData?.data;
  const roleName = (user as any)?.role?.name;
  const isManager = roleName === 'owner' || roleName === 'admin' || roleName === 'manager';

  const updateMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      return await apiRequest('PUT', '/api/rituals/huddle/today', payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/rituals/huddle/today'] });
    },
  });

  const hasHeadsUp = huddle?.headsUp && huddle.headsUp.length > 0;

  const slides = [
    'welcome',
    'win',
    'lean',
    'goals',
    ...(hasHeadsUp ? ['headsup'] : []),
    'kudos',
    ...(moment ? ['learning'] : []),
    'close',
  ];

  const totalSlides = slides.length;

  useEffect(() => {
    if (!isPaused && huddleStarted && currentSlide < totalSlides - 1) {
      timerRef.current = setInterval(() => {
        setCurrentSlide(prev => Math.min(prev + 1, totalSlides - 1));
      }, SLIDE_AUTO_ADVANCE_MS);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPaused, huddleStarted, currentSlide, totalSlides]);

  const goNext = useCallback(() => {
    if (currentSlide < totalSlides - 1) setCurrentSlide(prev => prev + 1);
  }, [currentSlide, totalSlides]);

  const goPrev = useCallback(() => {
    if (currentSlide > 0) setCurrentSlide(prev => prev - 1);
  }, [currentSlide]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const diff = touchStartRef.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 60) {
      if (diff > 0) goNext();
      else goPrev();
    }
  };

  const startHuddle = () => {
    setHuddleStarted(true);
    updateMutation.mutate({ status: 'in_progress', attendees: checkedAttendees });
  };

  const completeHuddle = () => {
    updateMutation.mutate({ status: 'completed', attendees: checkedAttendees });
    navigate('/');
  };

  const toggleAttendee = (id: string) => {
    setCheckedAttendees(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center z-50">
        <div className="space-y-4 w-64">
          <Skeleton className="h-8 w-48 mx-auto" />
          <Skeleton className="h-4 w-32 mx-auto" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (!huddle) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center z-50">
        <div className="text-center p-6">
          <Star className="h-12 w-12 text-amber-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">No Huddle Ready</h2>
          <p className="text-muted-foreground mb-6">Today's huddle hasn't been generated yet. Check back soon!</p>
          <Button onClick={() => navigate('/')} variant="outline">Back to Dashboard</Button>
        </div>
      </div>
    );
  }

  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const aiContent = huddle.aiGeneratedContent as any;

  const slideContent = slides[currentSlide];

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-full bg-black/10 dark:bg-white/10 text-foreground hover:bg-black/20"
          onClick={() => setIsPaused(p => !p)}
        >
          {isPaused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-full bg-black/10 dark:bg-white/10 text-foreground hover:bg-black/20"
          onClick={() => navigate('/')}
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex gap-1 px-6 pt-3">
        {slides.map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-all duration-300 ${
              i <= currentSlide ? 'bg-amber-500' : 'bg-black/10 dark:bg-white/10'
            }`}
          />
        ))}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 overflow-auto">
        {slideContent === 'welcome' && (
          <div className="w-full max-w-lg text-center space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-gray-900 dark:to-gray-800 fixed inset-0 flex flex-col items-center justify-center px-6">
            <div className="text-5xl mb-2">&#127775;</div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
              Good Morning!
            </h1>
            <p className="text-lg text-muted-foreground">{dateStr}</p>

            <div className="w-full max-w-sm text-left space-y-3 bg-white/60 dark:bg-white/5 rounded-2xl p-5 backdrop-blur">
              <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Who's here today?</p>
              <div className="space-y-2 max-h-[40vh] overflow-auto">
                {team.filter((u: any) => u.isActive !== false).map((u: any) => {
                  const name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email;
                  return (
                    <label key={u.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer">
                      <Checkbox
                        checked={checkedAttendees.includes(u.id)}
                        onCheckedChange={() => toggleAttendee(u.id)}
                      />
                      <div className="h-8 w-8 rounded-full bg-amber-200 dark:bg-amber-800 flex items-center justify-center text-xs font-bold shrink-0">
                        {(u.firstName?.[0] || '').toUpperCase()}{(u.lastName?.[0] || '').toUpperCase()}
                      </div>
                      <span className="text-sm font-medium">{name}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {!huddleStarted && (
              <Button
                size="lg"
                className="rounded-full px-10 py-6 text-lg font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-lg"
                onClick={startHuddle}
              >
                Start Huddle
              </Button>
            )}
            {huddleStarted && (
              <Button size="lg" className="rounded-full px-10 py-6 text-lg font-bold" onClick={goNext}>
                Let's Go <ChevronRight className="h-5 w-5 ml-1" />
              </Button>
            )}
          </div>
        )}

        {slideContent === 'win' && (
          <div className="w-full max-w-lg text-center space-y-6 animate-in fade-in slide-in-from-right-8 duration-500 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 fixed inset-0 flex flex-col items-center justify-center px-6">
            <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center mx-auto">
              <Star className="h-10 w-10 text-green-600 dark:text-green-400" />
            </div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-green-600 dark:text-green-400">Win of the Day</p>
            <h2 className="text-2xl md:text-3xl font-extrabold leading-snug px-4">
              {aiContent?.win_of_the_day || huddle.winOfTheDay || "Every day we're getting better!"}
            </h2>
          </div>
        )}

        {slideContent === 'lean' && (
          <div className="w-full max-w-lg text-center space-y-6 animate-in fade-in slide-in-from-right-8 duration-500 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 fixed inset-0 flex flex-col items-center justify-center px-6">
            <div className="w-20 h-20 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center mx-auto">
              <Target className="h-10 w-10 text-blue-600 dark:text-blue-400" />
            </div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">Today's Lean Principle</p>
            <h2 className="text-2xl md:text-3xl font-extrabold leading-snug px-4">
              {(() => {
                const principle = aiContent?.lean_principle || huddle.leanPrinciple || '';
                const parts = principle.split(':');
                if (parts.length > 1) {
                  return (
                    <>
                      <span className="block text-blue-600 dark:text-blue-400 mb-2">{parts[0].trim()}</span>
                      <span className="block text-lg font-medium text-muted-foreground">{parts.slice(1).join(':').trim()}</span>
                    </>
                  );
                }
                return principle || "Continuous improvement — always seek a better way.";
              })()}
            </h2>
          </div>
        )}

        {slideContent === 'goals' && (
          <div className="w-full max-w-lg text-center space-y-6 animate-in fade-in slide-in-from-right-8 duration-500 bg-gradient-to-br from-purple-50 to-violet-50 dark:from-purple-950/30 dark:to-violet-950/30 fixed inset-0 flex flex-col items-center justify-center px-6">
            <div className="w-20 h-20 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center mx-auto">
              <Rocket className="h-10 w-10 text-purple-600 dark:text-purple-400" />
            </div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-purple-600 dark:text-purple-400">Today's Goals</p>
            <div className="text-left w-full max-w-sm mx-auto space-y-3">
              {(aiContent?.goals || huddle.goals || ['Have a great day!']).map((goal: string, i: number) => (
                <div key={i} className="flex items-start gap-3 bg-white/60 dark:bg-white/5 rounded-xl p-4 backdrop-blur">
                  <span className="w-8 h-8 rounded-full bg-purple-200 dark:bg-purple-800 flex items-center justify-center text-sm font-bold text-purple-700 dark:text-purple-300 shrink-0">
                    {i + 1}
                  </span>
                  <p className="text-base font-medium pt-1">{goal}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {slideContent === 'headsup' && (
          <div className="w-full max-w-lg text-center space-y-6 animate-in fade-in slide-in-from-right-8 duration-500 bg-gradient-to-br from-orange-50 to-red-50 dark:from-orange-950/30 dark:to-red-950/30 fixed inset-0 flex flex-col items-center justify-center px-6">
            <div className="w-20 h-20 rounded-full bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center mx-auto">
              <AlertTriangle className="h-10 w-10 text-orange-600 dark:text-orange-400" />
            </div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600 dark:text-orange-400">Heads Up</p>
            <div className="text-left w-full max-w-sm mx-auto space-y-3">
              {(aiContent?.heads_up || huddle.headsUp || []).map((item: string, i: number) => (
                <div key={i} className="flex items-start gap-3 bg-white/60 dark:bg-white/5 rounded-xl p-4 backdrop-blur">
                  <AlertTriangle className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
                  <p className="text-base font-medium">{item}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {slideContent === 'kudos' && (
          <div className="w-full max-w-lg text-center space-y-6 animate-in fade-in slide-in-from-right-8 duration-500 bg-gradient-to-br from-pink-50 to-rose-50 dark:from-pink-950/30 dark:to-rose-950/30 fixed inset-0 flex flex-col items-center justify-center px-6">
            <div className="w-20 h-20 rounded-full bg-pink-100 dark:bg-pink-900/40 flex items-center justify-center mx-auto">
              <Heart className="h-10 w-10 text-pink-600 dark:text-pink-400" />
            </div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-pink-600 dark:text-pink-400">Quick Kudos</p>
            {recentKudos.length === 0 ? (
              <p className="text-lg text-muted-foreground">No kudos yet — be the first to recognize someone today!</p>
            ) : (
              <div className="text-left w-full max-w-sm mx-auto space-y-3">
                {recentKudos.map((k: any) => (
                  <div key={k.id} className="bg-white/60 dark:bg-white/5 rounded-xl p-4 backdrop-blur">
                    <p className="text-sm">
                      <span className="font-bold">{k.fromName}</span>
                      <span className="text-muted-foreground"> &rarr; </span>
                      <span className="font-bold">{k.toName}</span>
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">"{k.message}"</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {slideContent === 'learning' && moment && (
          <div className="w-full max-w-lg text-center space-y-5 animate-in fade-in slide-in-from-right-8 duration-500 bg-gradient-to-br from-teal-50 to-cyan-50 dark:from-teal-950/30 dark:to-cyan-950/30 fixed inset-0 flex flex-col items-center justify-center px-6 overflow-auto py-8">
            <div className="w-20 h-20 rounded-full bg-teal-100 dark:bg-teal-900/40 flex items-center justify-center mx-auto shrink-0">
              <BookOpen className="h-10 w-10 text-teal-600 dark:text-teal-400" />
            </div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-600 dark:text-teal-400">Learning Moment</p>
            <p className="text-sm font-medium text-muted-foreground px-2">{moment.tip}</p>
            {moment.quizQuestion && (
              <div className="w-full max-w-sm text-left space-y-3">
                <p className="text-base font-semibold text-center">{moment.quizQuestion}</p>
                {(moment.quizAnswerChoices as string[] || []).map((choice: string, idx: number) => {
                  let extraClass = "";
                  if (momentAnswered && momentResult) {
                    if (idx === momentResult.correctAnswerIndex) extraClass = "border-green-500 bg-green-100/60 dark:bg-green-900/30";
                    else if (momentAnswered) extraClass = "border-border opacity-60";
                  }
                  return (
                    <button
                      key={idx}
                      className={`w-full text-left rounded-xl border-2 px-4 py-3 text-sm font-medium transition-all bg-white/60 dark:bg-white/5 backdrop-blur ${
                        extraClass || "border-border hover:border-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/20"
                      }`}
                      onClick={() => {
                        if (!momentAnswered) {
                          answerMomentMutation.mutate(idx);
                          setIsPaused(true);
                        }
                      }}
                      disabled={momentAnswered || answerMomentMutation.isPending}
                    >
                      <span className="flex items-center gap-2">
                        {momentAnswered && momentResult && idx === momentResult.correctAnswerIndex && (
                          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                        )}
                        {choice}
                      </span>
                    </button>
                  );
                })}
                {momentAnswered && momentResult && (
                  <div className={`rounded-xl p-3 text-sm ${momentResult.isCorrect ? 'bg-green-100/80 dark:bg-green-900/30 text-green-800 dark:text-green-200' : 'bg-rose-100/80 dark:bg-rose-900/30 text-rose-800 dark:text-rose-200'}`}>
                    <p className="font-semibold mb-1">{momentResult.isCorrect ? 'Correct! +10 pts' : 'Not quite!'}</p>
                    {momentResult.quizContext && <p className="text-xs">{momentResult.quizContext}</p>}
                  </div>
                )}
                {momentAnswered && (
                  <Button size="sm" className="w-full mt-1" onClick={() => { setIsPaused(false); goNext(); }}>
                    Continue <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                )}
                {isManager && moment.quizCorrectIndex !== undefined && !momentAnswered && (
                  <p className="text-xs text-center text-muted-foreground">Manager: answer {moment.quizCorrectIndex + 1} is correct</p>
                )}
              </div>
            )}
          </div>
        )}

        {slideContent === 'close' && (
          <div className="w-full max-w-lg text-center space-y-8 animate-in fade-in zoom-in-95 duration-500 bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/30 fixed inset-0 flex flex-col items-center justify-center px-6">
            <div className="text-6xl">&#128170;</div>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">Let's Go!</h1>
            <p className="text-lg text-muted-foreground">Have an amazing day, team.</p>
            <Button
              size="lg"
              className="rounded-full px-12 py-6 text-lg font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-lg"
              onClick={completeHuddle}
            >
              Close Huddle
            </Button>
          </div>
        )}
      </div>

      {slideContent !== 'welcome' && (
        <div className="absolute bottom-8 left-0 right-0 flex items-center justify-between px-8 z-10">
          <Button
            variant="ghost"
            size="lg"
            className="h-14 w-14 rounded-full bg-black/10 dark:bg-white/10 hover:bg-black/20"
            onClick={goPrev}
            disabled={currentSlide === 0}
          >
            <ChevronLeft className="h-7 w-7" />
          </Button>
          <span className="text-sm text-muted-foreground font-medium">
            {currentSlide + 1} / {totalSlides}
          </span>
          <Button
            variant="ghost"
            size="lg"
            className="h-14 w-14 rounded-full bg-black/10 dark:bg-white/10 hover:bg-black/20"
            onClick={goNext}
            disabled={currentSlide >= totalSlides - 1}
          >
            <ChevronRight className="h-7 w-7" />
          </Button>
        </div>
      )}
    </div>
  );
}
