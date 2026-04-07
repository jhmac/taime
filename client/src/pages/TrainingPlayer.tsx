import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  ArrowLeft, ArrowRight, CheckCircle2, XCircle, Flag, MessageSquare,
  BookOpen, Lightbulb, Users, ClipboardList, Loader2, RefreshCw,
} from "lucide-react";

interface TrainingLesson {
  id: string;
  type: "concept" | "script_practice" | "scenario" | "quiz";
  title: string;
  contentJson: Record<string, unknown>;
  orderIndex: number;
  questions: TrainingQuestion[];
  progress: { status: string; quizScore?: number } | null;
}

interface TrainingQuestion {
  id: string;
  questionText: string;
  answerChoices: string[];
  correctAnswerIndex: number;
  coachingText?: string;
}

interface ModuleData {
  module: { id: string; title: string; description?: string };
  lessons: TrainingLesson[];
}

const LESSON_TYPE_CONFIG = {
  concept: { label: "Concept Card", icon: Lightbulb, color: "bg-blue-500" },
  script_practice: { label: "Script Practice", icon: Users, color: "bg-green-500" },
  scenario: { label: "Scenario", icon: BookOpen, color: "bg-purple-500" },
  quiz: { label: "Knowledge Check", icon: ClipboardList, color: "bg-amber-500" },
};

function ConceptCard({ lesson }: { lesson: TrainingLesson }) {
  const content = lesson.contentJson as { body?: string; highlight?: string };
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 text-center space-y-6">
      <div className="w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
        <Lightbulb className="h-8 w-8 text-blue-600 dark:text-blue-400" />
      </div>
      <h2 className="text-xl font-bold">{lesson.title}</h2>
      {content.highlight && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-4 max-w-sm w-full">
          <p className="font-semibold text-blue-800 dark:text-blue-200 text-sm">{content.highlight}</p>
        </div>
      )}
      {content.body && (
        <p className="text-muted-foreground leading-relaxed max-w-sm">{content.body as string}</p>
      )}
    </div>
  );
}

function QuestionSlide({
  question,
  onAnswer,
  isPending,
}: {
  question: TrainingQuestion;
  onAnswer: (idx: number) => void;
  isPending: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<"correct" | "wrong" | null>(null);

  const handleSelect = (idx: number) => {
    if (result !== null) return;
    setSelected(idx);
    const isCorrect = idx === question.correctAnswerIndex;
    setResult(isCorrect ? "correct" : "wrong");
  };

  const handleContinue = () => {
    if (selected === null) return;
    onAnswer(selected);
  };

  return (
    <div className="flex-1 flex flex-col px-6 py-6 space-y-4">
      <p className="text-base font-semibold text-center">{question.questionText}</p>
      <div className="space-y-3">
        {question.answerChoices.map((choice, idx) => {
          let variant = "outline";
          let extraClass = "";
          if (result !== null) {
            if (idx === question.correctAnswerIndex) {
              extraClass = "border-green-500 bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-200";
            } else if (idx === selected) {
              extraClass = "border-red-500 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200";
            }
          }
          return (
            <button
              key={idx}
              className={`w-full text-left rounded-xl border-2 px-4 py-3 text-sm font-medium transition-all ${
                extraClass || "border-border hover:border-primary/50 hover:bg-accent"
              } ${result !== null ? "cursor-default" : "cursor-pointer"}`}
              onClick={() => handleSelect(idx)}
              disabled={result !== null}
            >
              <span className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0">
                  {String.fromCharCode(65 + idx)}
                </span>
                {choice}
                {result !== null && idx === question.correctAnswerIndex && (
                  <CheckCircle2 className="h-4 w-4 text-green-500 ml-auto" />
                )}
                {result === "wrong" && idx === selected && idx !== question.correctAnswerIndex && (
                  <XCircle className="h-4 w-4 text-red-500 ml-auto" />
                )}
              </span>
            </button>
          );
        })}
      </div>

      {result === "wrong" && question.coachingText && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
          <p className="text-xs text-amber-800 dark:text-amber-200 font-medium">Coaching tip:</p>
          <p className="text-sm text-amber-900 dark:text-amber-100 mt-1">{question.coachingText}</p>
        </div>
      )}

      {result !== null && (
        <Button onClick={handleContinue} disabled={isPending} className="w-full">
          {result === "wrong" ? "Try Again" : "Continue"}
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      )}
    </div>
  );
}

function QuizLesson({
  lesson,
  onComplete,
  isPending,
}: {
  lesson: TrainingLesson;
  onComplete: (score: number) => void;
  isPending: boolean;
}) {
  const [currentQ, setCurrentQ] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const questions = lesson.questions;

  const handleAnswer = (selectedIdx: number) => {
    const isCorrect = selectedIdx === questions[currentQ].correctAnswerIndex;
    const newCorrect = correctCount + (isCorrect ? 1 : 0);

    if (currentQ < questions.length - 1) {
      setCorrectCount(newCorrect);
      setCurrentQ(q => q + 1);
    } else {
      const score = Math.round((newCorrect / questions.length) * 100);
      onComplete(score);
    }
  };

  if (questions.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center space-y-4">
        <ClipboardList className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">No quiz questions configured for this lesson.</p>
        <Button onClick={() => onComplete(100)}>Mark Complete</Button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="px-6 pt-2 pb-1">
        <p className="text-xs text-muted-foreground text-center">
          Question {currentQ + 1} of {questions.length}
        </p>
        <Progress value={((currentQ) / questions.length) * 100} className="h-1.5 mt-1" />
      </div>
      <QuestionSlide question={questions[currentQ]} onAnswer={handleAnswer} isPending={isPending} />
    </div>
  );
}

export default function TrainingPlayer() {
  const { moduleId } = useParams<{ moduleId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [currentLessonIdx, setCurrentLessonIdx] = useState(0);
  const [showFlag, setShowFlag] = useState(false);
  const [flagReason, setFlagReason] = useState("");
  const [quizResult, setQuizResult] = useState<{ score: number; passed: boolean } | null>(null);

  const { data, isLoading } = useQuery<{ success: boolean; data: ModuleData }>({
    queryKey: ["/api/training/modules", moduleId, "player"],
    queryFn: () => fetch(`/api/training/modules/${moduleId}/player`, { credentials: "include" }).then(r => r.json()),
  });

  const progressMutation = useMutation({
    mutationFn: async (payload: { lessonId: string; moduleId: string; status: string; quizScore?: number }) => {
      const res = await apiRequest("POST", `/api/training/lessons/${payload.lessonId}/progress`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/training/dashboard"] });
    },
  });

  const flagMutation = useMutation({
    mutationFn: async (payload: { lessonId: string; moduleId: string; reason: string }) => {
      const res = await apiRequest("POST", `/api/training/lessons/${payload.lessonId}/flag`, payload);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Flagged for review", description: "A manager will review this content." });
      setShowFlag(false);
      setFlagReason("");
    },
  });

  const module = data?.data;
  const lessons = module?.lessons ?? [];
  const currentLesson = lessons[currentLessonIdx];
  const progressPercent = lessons.length > 0 ? ((currentLessonIdx) / lessons.length) * 100 : 0;

  const handleLessonComplete = async (quizScore?: number) => {
    if (!currentLesson || !module) return;

    if (currentLesson.type === "quiz" && quizScore !== undefined) {
      const passed = quizScore >= 70;
      setQuizResult({ score: quizScore, passed });
      await progressMutation.mutateAsync({
        lessonId: currentLesson.id,
        moduleId: module.module.id,
        status: "completed",
        quizScore,
      });
    } else {
      await progressMutation.mutateAsync({
        lessonId: currentLesson.id,
        moduleId: module.module.id,
        status: "completed",
      });
      goNext();
    }
  };

  const goNext = () => {
    setQuizResult(null);
    if (currentLessonIdx < lessons.length - 1) {
      setCurrentLessonIdx(i => i + 1);
    } else {
      toast({ title: "Module complete!", description: "Great job! You've finished this training module." });
      navigate("/training");
    }
  };

  const goPrev = () => {
    if (currentLessonIdx > 0) {
      setCurrentLessonIdx(i => i - 1);
      setQuizResult(null);
    }
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!module) {
    return (
      <div className="fixed inset-0 bg-background flex flex-col items-center justify-center gap-4 p-6">
        <BookOpen className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Module not found.</p>
        <Button variant="outline" onClick={() => navigate("/training")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Training
        </Button>
      </div>
    );
  }

  const typeConfig = currentLesson ? LESSON_TYPE_CONFIG[currentLesson.type] : null;
  const TypeIcon = typeConfig?.icon ?? BookOpen;

  if (quizResult !== null) {
    return (
      <div className="fixed inset-0 bg-background flex flex-col items-center justify-center px-6 text-center space-y-6">
        {quizResult.passed ? (
          <CheckCircle2 className="h-16 w-16 text-green-500" />
        ) : (
          <XCircle className="h-16 w-16 text-amber-500" />
        )}
        <div>
          <h2 className="text-2xl font-bold mb-2">
            {quizResult.passed ? "Knowledge Check Passed!" : "Keep Practicing"}
          </h2>
          <p className="text-muted-foreground">
            Score: {quizResult.score}% {quizResult.passed ? "(70% required)" : "— Try again to pass"}
          </p>
        </div>
        <div className="flex gap-3">
          {!quizResult.passed && (
            <Button variant="outline" onClick={() => { setQuizResult(null); }}>
              <RefreshCw className="h-4 w-4 mr-2" /> Retry Quiz
            </Button>
          )}
          <Button onClick={goNext}>
            {quizResult.passed ? (currentLessonIdx < lessons.length - 1 ? "Next Section" : "Finish Module") : "Continue Anyway"}
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-background flex flex-col">
      <div className="flex items-center gap-3 px-4 pt-4 pb-2 border-b">
        <Button variant="ghost" size="icon" className="shrink-0" onClick={() => navigate("/training")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground truncate">{module.module.title}</p>
          <Progress value={progressPercent} className="h-1.5 mt-1" />
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          {currentLessonIdx + 1}/{lessons.length}
        </span>
      </div>

      {currentLesson && (
        <div className="px-4 pt-3 pb-1 flex items-center gap-2">
          {typeConfig && (
            <Badge className={`${typeConfig.color} text-white text-xs`}>
              <TypeIcon className="h-3 w-3 mr-1" />
              {typeConfig.label}
            </Badge>
          )}
          <span className="text-sm font-medium truncate">{currentLesson.title}</span>
        </div>
      )}

      <div className="flex-1 overflow-auto flex flex-col">
        {currentLesson?.type === "concept" && <ConceptCard lesson={currentLesson} />}
        {currentLesson?.type === "script_practice" && (
          <QuestionSlide
            question={currentLesson.questions[0] ?? { id: "", questionText: "No question configured", answerChoices: [], correctAnswerIndex: 0 }}
            onAnswer={() => handleLessonComplete()}
            isPending={progressMutation.isPending}
          />
        )}
        {currentLesson?.type === "scenario" && (
          <QuestionSlide
            question={currentLesson.questions[0] ?? { id: "", questionText: "No question configured", answerChoices: [], correctAnswerIndex: 0 }}
            onAnswer={() => handleLessonComplete()}
            isPending={progressMutation.isPending}
          />
        )}
        {currentLesson?.type === "quiz" && (
          <QuizLesson
            lesson={currentLesson}
            onComplete={handleLessonComplete}
            isPending={progressMutation.isPending}
          />
        )}
      </div>

      <div className="border-t px-4 py-3 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={goPrev} disabled={currentLessonIdx === 0}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Prev
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setShowFlag(f => !f)}
        >
          <Flag className="h-4 w-4 mr-1" /> Flag
        </Button>

        {currentLesson?.type === "concept" && (
          <Button size="sm" onClick={() => handleLessonComplete()} disabled={progressMutation.isPending}>
            {progressMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Next <ArrowRight className="h-4 w-4 ml-1" /></>}
          </Button>
        )}
        {currentLesson?.type !== "concept" && currentLesson?.type !== "quiz" && (
          <div className="w-16" />
        )}
        {currentLesson?.type === "quiz" && <div className="w-16" />}
      </div>

      {showFlag && (
        <div className="border-t px-4 py-3 bg-muted/50">
          <p className="text-xs font-medium mb-2">What's confusing about this content?</p>
          <textarea
            className="w-full text-sm border rounded-lg p-2 bg-background resize-none h-20"
            placeholder="Describe what's unclear or needs improvement..."
            value={flagReason}
            onChange={e => setFlagReason(e.target.value)}
          />
          <div className="flex gap-2 mt-2">
            <Button size="sm" variant="outline" onClick={() => { setShowFlag(false); setFlagReason(""); }}>Cancel</Button>
            <Button
              size="sm"
              disabled={flagMutation.isPending}
              onClick={() => {
                if (currentLesson) {
                  flagMutation.mutate({ lessonId: currentLesson.id, moduleId: module.module.id, reason: flagReason });
                }
              }}
            >
              {flagMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit Flag"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
