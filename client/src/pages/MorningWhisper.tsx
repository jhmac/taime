import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Coffee, Play, Pause, Square, Volume2, VolumeX,
  AlertTriangle, TrendingUp, Users, ClipboardCheck,
  ArrowRight, ChevronDown,
  Star,
} from "lucide-react";

interface FlaggedItem {
  flag_type: string;
  message: string;
  priority: "high" | "medium";
}

interface WhisperContent {
  greeting: string;
  headline: string;
  yesterday_summary: string;
  today_outlook: string;
  flagged_items: FlaggedItem[];
  team_highlight: string;
  closing: string;
}

interface WhisperResponse {
  whisper: WhisperContent;
  id: string;
  listened: boolean;
}

function flagIcon(type: string) {
  switch (type) {
    case "urgent_issue": return <AlertTriangle className="h-4 w-4" />;
    case "sales": return <TrendingUp className="h-4 w-4" />;
    case "staffing": return <Users className="h-4 w-4" />;
    case "sop_gap": return <ClipboardCheck className="h-4 w-4" />;
    default: return <AlertTriangle className="h-4 w-4" />;
  }
}

function flagActionLabel(type: string) {
  switch (type) {
    case "urgent_issue": return "View Issues";
    case "sop_gap": return "Review SOPs";
    case "staffing": return "Check Schedule";
    case "overdue_task": return "View Tasks";
    default: return "Take Action";
  }
}

function flagActionPath(type: string) {
  switch (type) {
    case "urgent_issue": return "/issues";
    case "sop_gap": return "/sops";
    case "staffing": return "/schedules";
    case "overdue_task": return "/tasks";
    default: return "/";
  }
}

export default function MorningWhisper() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [isPlaying, setIsPlaying] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [currentSection, setCurrentSection] = useState(0);

  useEffect(() => {
    setSpeechSupported("speechSynthesis" in window);
    return () => {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const { data, isLoading, error } = useQuery<WhisperResponse>({
    queryKey: ["/api/whisper/today"],
    staleTime: 5 * 60 * 1000,
  });

  const listenedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/whisper/today/listened");
      return res.json();
    },
  });

  const whisper = data?.whisper;

  const getSpeechSections = useCallback((): string[] => {
    if (!whisper) return [];
    return [
      whisper.greeting,
      whisper.headline,
      whisper.yesterday_summary,
      whisper.today_outlook,
      ...(whisper.flagged_items?.length > 0
        ? [`Flagged items. ${whisper.flagged_items.map(f => f.message).join(". ")}`]
        : []),
      whisper.team_highlight,
      whisper.closing,
    ];
  }, [whisper]);

  const handlePlay = useCallback(() => {
    if (!speechSupported || !whisper) return;

    if (isPlaying) {
      window.speechSynthesis.cancel();
      setIsPlaying(false);
      return;
    }

    const sections = getSpeechSections();
    let idx = 0;

    const speakNext = () => {
      if (idx >= sections.length) {
        setIsPlaying(false);
        setCurrentSection(0);
        if (!data?.listened) listenedMutation.mutate();
        return;
      }

      const utter = new SpeechSynthesisUtterance(sections[idx]);
      utter.rate = 0.95;
      utter.pitch = 1;
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(v =>
        v.name.includes("Samantha") || v.name.includes("Google") || v.name.includes("Natural")
      );
      if (preferred) utter.voice = preferred;

      utter.onstart = () => setCurrentSection(idx);
      utter.onend = () => {
        idx++;
        speakNext();
      };
      utter.onerror = () => {
        setIsPlaying(false);
        setCurrentSection(0);
      };

      synthRef.current = utter;
      window.speechSynthesis.speak(utter);
    };

    setIsPlaying(true);
    speakNext();
  }, [speechSupported, whisper, isPlaying, getSpeechSections, data?.listened, listenedMutation]);

  const handleStop = () => {
    window.speechSynthesis.cancel();
    setIsPlaying(false);
    setCurrentSection(0);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto p-6 space-y-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  if (error || !whisper) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <Coffee className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
            <h2 className="font-semibold text-lg mb-2">Morning Whisper Unavailable</h2>
            <p className="text-sm text-muted-foreground mb-4">
              {(user?.role as any)?.name === "employee"
                ? "Morning Whisper is available for managers and owners."
                : "We couldn't prepare your briefing right now. Try again shortly."}
            </p>
            <Button onClick={() => navigate("/")} variant="outline">Back to Dashboard</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-5 py-8 md:py-12 space-y-8">

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 mb-1">
              <Coffee className="h-5 w-5" />
              <span className="text-sm font-medium">Morning Whisper</span>
            </div>
            <p className="text-xs text-muted-foreground">{today}</p>
          </div>
          {speechSupported && (
            <div className="flex items-center gap-1.5">
              <Button
                onClick={handlePlay}
                variant={isPlaying ? "default" : "outline"}
                size="sm"
                className={`gap-1.5 ${isPlaying ? "bg-amber-600 hover:bg-amber-700" : ""}`}
              >
                {isPlaying ? (
                  <><Pause className="h-3.5 w-3.5" /> Pause</>
                ) : (
                  <><Volume2 className="h-3.5 w-3.5" /> Listen</>
                )}
              </Button>
              {isPlaying && (
                <Button onClick={handleStop} variant="ghost" size="icon" className="h-8 w-8">
                  <Square className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          )}
        </div>

        <div className={`transition-opacity duration-500 ${isPlaying && currentSection === 0 ? "opacity-100" : ""}`}>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight leading-snug">
            {whisper.greeting}
          </h1>
        </div>

        <div className={`bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 rounded-xl p-5 border border-amber-200 dark:border-amber-800 transition-all duration-500 ${isPlaying && currentSection === 1 ? "ring-2 ring-amber-400" : ""}`}>
          <p className="text-lg font-semibold text-amber-900 dark:text-amber-100 leading-relaxed">
            {whisper.headline}
          </p>
        </div>

        <section className={`space-y-2 transition-all duration-500 ${isPlaying && currentSection === 2 ? "ring-2 ring-blue-400 rounded-xl p-3 -m-3" : ""}`}>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            Yesterday
          </h2>
          <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
            {whisper.yesterday_summary}
          </p>
        </section>

        <section className={`space-y-2 transition-all duration-500 ${isPlaying && currentSection === 3 ? "ring-2 ring-purple-400 rounded-xl p-3 -m-3" : ""}`}>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Today's Outlook
          </h2>
          <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
            {whisper.today_outlook}
          </p>
        </section>

        {whisper.flagged_items && whisper.flagged_items.length > 0 && (
          <section className={`space-y-3 transition-all duration-500 ${isPlaying && currentSection === 4 ? "ring-2 ring-red-400 rounded-xl p-3 -m-3" : ""}`}>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              Needs Attention
            </h2>
            {whisper.flagged_items.map((flag, i) => (
              <Card key={i} className={`overflow-hidden ${flag.priority === "high" ? "border-l-4 border-l-red-500" : "border-l-4 border-l-amber-400"}`}>
                <CardContent className="p-3 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <div className={`mt-0.5 ${flag.priority === "high" ? "text-red-500" : "text-amber-500"}`}>
                      {flagIcon(flag.flag_type)}
                    </div>
                    <p className="text-sm leading-relaxed">{flag.message}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs shrink-0 h-7"
                    onClick={() => navigate(flagActionPath(flag.flag_type))}
                  >
                    {flagActionLabel(flag.flag_type)}
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </section>
        )}

        <div className={`bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-950/20 rounded-xl p-5 border border-emerald-200 dark:border-emerald-800 transition-all duration-500 ${isPlaying && currentSection >= 5 ? "ring-2 ring-emerald-400" : ""}`}>
          <div className="flex items-start gap-2.5">
            <Star className="h-5 w-5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-1">
                Team Highlight
              </h3>
              <p className="text-sm leading-relaxed text-emerald-900 dark:text-emerald-100">
                {whisper.team_highlight}
              </p>
            </div>
          </div>
        </div>

        <div className="text-center space-y-4 pt-2">
          <p className="text-sm text-muted-foreground italic">
            {whisper.closing}
          </p>
          <Button
            onClick={() => {
              if (!data?.listened) listenedMutation.mutate();
              navigate("/");
            }}
            className="gap-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700"
          >
            Start Your Day
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>

      </div>
    </div>
  );
}
