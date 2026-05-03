import { useEffect, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  GraduationCap, BookMarked, History, Film, BarChart3,
  Trophy, Flame, Sparkles, Lightbulb, Video, Heart, ShieldCheck,
  ChevronRight, Award, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrainingModule, EmployeeTrainingProgress } from "@shared/schema";
import Learning from "./Learning";
import KnowledgeBase from "./KnowledgeBase";
import SOPRevisions from "./SOPRevisions";
import ImprovementFeed from "./ImprovementFeed";
import LeanBoard from "./LeanBoard";
import UnifiedSearch, { useSearchFocus } from "@/components/learning-center/UnifiedSearch";

type TabKey = "my-learning" | "knowledge-base" | "sop-revisions" | "improvements" | "lean-board";

const TABS: Array<{ key: TabKey; label: string; icon: any; aria: string }> = [
  { key: "my-learning", label: "My Learning", icon: GraduationCap, aria: "My Learning tab" },
  { key: "knowledge-base", label: "Knowledge Base", icon: BookMarked, aria: "Knowledge Base tab" },
  { key: "sop-revisions", label: "SOP Revisions", icon: History, aria: "SOP Revisions tab" },
  { key: "improvements", label: "Improvements", icon: Film, aria: "Improvements tab" },
  { key: "lean-board", label: "Lean Board", icon: BarChart3, aria: "Lean Board tab" },
];

const VALID_TABS = TABS.map(t => t.key) as TabKey[];

function getXpLevel(completed: number): { level: number; xp: number; nextLevelXp: number; xpInLevel: number } {
  // 100 XP per completed module, level threshold doubles every 5 levels
  const xp = completed * 100;
  let level = 1;
  let cumulative = 0;
  let perLevel = 200;
  while (cumulative + perLevel <= xp) {
    cumulative += perLevel;
    level += 1;
    if (level % 5 === 0) perLevel = Math.round(perLevel * 1.5);
  }
  const xpInLevel = xp - cumulative;
  const nextLevelXp = perLevel;
  return { level, xp, nextLevelXp, xpInLevel };
}

interface LeanMetrics {
  improvements_submitted: number;
  videos_uploaded: number;
  kudos_given: number;
  sop_completion_rate: number;
}
interface LeanBoardData {
  currentMetrics: LeanMetrics | null;
}

function HeroBanner({ activeTab, onContinue }: { activeTab: TabKey; onContinue: () => void }) {
  const { user } = useAuth();
  const { data: modules = [] } = useQuery<TrainingModule[]>({ queryKey: ["/api/training/modules"] });
  const { data: progress = [] } = useQuery<EmployeeTrainingProgress[]>({ queryKey: ["/api/training/progress"] });

  const activeModules = modules.filter(m => m.isActive);
  const completedCount = activeModules.filter(m => progress.find(p => p.moduleId === m.id)?.status === "completed").length;
  const completionPct = activeModules.length > 0 ? Math.round((completedCount / activeModules.length) * 100) : 0;
  const { level, xp, nextLevelXp, xpInLevel } = getXpLevel(completedCount);

  // Streak: count distinct days from completedAt entries within the last 14 days
  const streak = useMemo(() => {
    const days = new Set<string>();
    const now = new Date();
    progress.forEach(p => {
      if (p.completedAt) {
        const d = new Date(p.completedAt);
        const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
        if (diffDays >= 0 && diffDays <= 14) days.add(d.toISOString().slice(0, 10));
      }
    });
    let s = 0;
    for (let i = 0; i < 14; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      if (days.has(d.toISOString().slice(0, 10))) s++;
      else if (i > 0) break;
    }
    return s;
  }, [progress]);

  const firstName = user?.firstName || "there";
  const hasIncomplete = activeModules.some(m => progress.find(p => p.moduleId === m.id)?.status !== "completed");

  return (
    <div className="rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-600 text-white p-5 md:p-6 shadow-lg">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-widest text-white/70 mb-1">Learning Center</p>
          <h1 className="text-2xl md:text-3xl font-extrabold leading-tight">
            Welcome back, {firstName}
          </h1>
          <p className="text-sm text-white/80 mt-1">
            {activeModules.length === 0
              ? "Your training library will appear here as your team adds content."
              : completionPct === 100
                ? "You're fully up to speed. Keep building skills with the team."
                : `You're ${completionPct}% through your training — keep going!`}
          </p>

          <div className="flex flex-wrap items-center gap-2 md:gap-3 mt-4">
            <div className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur-sm rounded-full px-3 py-1 text-xs font-semibold">
              <Award className="h-3.5 w-3.5" /> Level {level}
            </div>
            <div className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur-sm rounded-full px-3 py-1 text-xs font-semibold">
              <Sparkles className="h-3.5 w-3.5" /> {xp} XP
            </div>
            {streak > 0 && (
              <div className="inline-flex items-center gap-1.5 bg-orange-400/30 backdrop-blur-sm rounded-full px-3 py-1 text-xs font-semibold">
                <Flame className="h-3.5 w-3.5" /> {streak}-day streak
              </div>
            )}
            <div className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur-sm rounded-full px-3 py-1 text-xs font-semibold">
              <Trophy className="h-3.5 w-3.5" /> {completedCount}/{activeModules.length} modules
            </div>
          </div>

          {/* XP progress to next level */}
          <div className="mt-3 max-w-md">
            <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full transition-all"
                style={{ width: `${Math.min(100, (xpInLevel / nextLevelXp) * 100)}%` }}
              />
            </div>
            <p className="text-[10px] text-white/70 mt-1">
              {Math.max(0, nextLevelXp - xpInLevel)} XP to Level {level + 1}
            </p>
          </div>

          {/* Unified search across all Learning Center sections */}
          <div className="mt-4 max-w-xl">
            <UnifiedSearch />
          </div>
        </div>

        {/* Progress ring + CTA */}
        <div className="flex items-center gap-4 shrink-0">
          <div className="relative w-20 h-20">
            <svg width="80" height="80" className="transform -rotate-90">
              <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="6" />
              <circle
                cx="40" cy="40" r="34" fill="none" stroke="white" strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 34}
                strokeDashoffset={2 * Math.PI * 34 * (1 - completionPct / 100)}
                className="transition-all duration-500"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-extrabold">{completionPct}%</span>
              <span className="text-[9px] uppercase tracking-wider text-white/70">Done</span>
            </div>
          </div>
          {hasIncomplete && activeTab !== "my-learning" && (
            <button
              onClick={onContinue}
              className="hidden md:inline-flex items-center gap-1.5 bg-white text-violet-700 hover:bg-white/95 font-semibold text-sm px-4 py-2 rounded-full shadow-sm"
              data-testid="hero-continue-learning"
            >
              Continue Learning <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {hasIncomplete && (
        <button
          onClick={onContinue}
          className="md:hidden mt-4 w-full inline-flex items-center justify-center gap-1.5 bg-white text-violet-700 hover:bg-white/95 font-semibold text-sm px-4 py-2.5 rounded-full"
          data-testid="hero-continue-learning-mobile"
        >
          Continue Learning <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function PulseCard({ icon: Icon, label, value, suffix, color, bgColor }: {
  icon: any; label: string; value: number | string; suffix?: string; color: string; bgColor: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5 rounded-xl border bg-card p-3 min-w-[150px] flex-shrink-0", bgColor)}>
      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", color)}>
        <Icon className="h-4 w-4 text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">{label}</p>
        <p className="text-base font-bold leading-tight">{value}{suffix}</p>
      </div>
    </div>
  );
}

function TeamPulseStrip() {
  const { data, isLoading } = useQuery<LeanBoardData>({
    queryKey: ["/api/lean-board", "week"],
    queryFn: async () => {
      const res = await fetch("/api/lean-board?period=week", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex gap-2 overflow-x-auto pb-1">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 min-w-[150px] rounded-xl flex-shrink-0" />)}
      </div>
    );
  }

  const m = data?.currentMetrics;
  if (!m) {
    return (
      <div className="rounded-xl border border-dashed bg-card/50 p-3 text-xs text-muted-foreground text-center">
        Team Pulse will appear after your first nightly snapshot.
      </div>
    );
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
      <PulseCard icon={Lightbulb} label="Improvements" value={m.improvements_submitted} color="bg-amber-500" bgColor="border-amber-200/60 dark:border-amber-900/40" />
      <PulseCard icon={Video} label="Videos Shared" value={m.videos_uploaded} color="bg-blue-500" bgColor="border-blue-200/60 dark:border-blue-900/40" />
      <PulseCard icon={ShieldCheck} label="SOP Completion" value={m.sop_completion_rate} suffix="%" color="bg-emerald-500" bgColor="border-emerald-200/60 dark:border-emerald-900/40" />
      <PulseCard icon={Heart} label="Kudos Given" value={m.kudos_given} color="bg-pink-500" bgColor="border-pink-200/60 dark:border-pink-900/40" />
    </div>
  );
}

function QuickLinks({ onSelect }: { onSelect: (tab: TabKey) => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" aria-label="Quick links">
      {TABS.map(t => {
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            onClick={() => onSelect(t.key)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border bg-card hover:bg-muted/60 hover:border-primary/30 transition-colors flex-shrink-0"
            data-testid={`quick-link-${t.key}`}
          >
            <Icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        );
      })}
    </div>
  );
}

function TabBar({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Learning Center sections"
      className="sticky top-0 z-20 -mx-4 md:-mx-6 px-4 md:px-6 py-2 bg-background/95 backdrop-blur border-b"
    >
      <div className="flex gap-1 overflow-x-auto" data-testid="learning-center-tabs">
        {TABS.map(t => {
          const Icon = t.icon;
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tab-panel-${t.key}`}
              id={`tab-${t.key}`}
              onClick={() => onChange(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all flex-shrink-0",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
              data-testid={`tab-${t.key}`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface LeaderboardEntry {
  userId: string;
  name: string;
  modules: number;
  total: number;
}

function TopContributorsCard() {
  const { data: progress = [] } = useQuery<EmployeeTrainingProgress[]>({
    queryKey: ["/api/training/progress/all"],
    queryFn: async () => {
      const res = await fetch("/api/training/progress/all", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    retry: false,
  });

  const leaderboard: LeaderboardEntry[] = useMemo(() => {
    const map = new Map<string, LeaderboardEntry>();
    progress.forEach((p: any) => {
      if (p.status !== "completed") return;
      const userId = p.userId;
      const entry = map.get(userId) || { userId, name: p.userName || "Teammate", modules: 0, total: 0 };
      entry.modules += 1;
      entry.total = entry.modules;
      map.set(userId, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 5);
  }, [progress]);

  if (leaderboard.length === 0) return null;

  return (
    <Card className="mt-4">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Users className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          <h2 className="text-sm font-bold">Top Contributors</h2>
        </div>
        <ol className="space-y-2">
          {leaderboard.map((e, i) => (
            <li key={e.userId} className="flex items-center gap-3">
              <span className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                i === 0 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                  : i === 1 ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    : i === 2 ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
                      : "bg-muted text-muted-foreground"
              )}>{i + 1}</span>
              <span className="flex-1 text-sm truncate">{e.name}</span>
              <span className="text-xs text-muted-foreground">
                {e.modules} module{e.modules !== 1 ? "s" : ""}
              </span>
            </li>
          ))}
        </ol>
        <p className="text-[10px] text-muted-foreground mt-3">
          Ranked by training modules completed.
        </p>
      </CardContent>
    </Card>
  );
}

export default function LearningCenter() {
  const [, navigate] = useLocation();
  const search = useSearch();

  const params = new URLSearchParams(search);
  const tabParam = params.get("tab") as TabKey | null;
  const activeTab: TabKey = tabParam && VALID_TABS.includes(tabParam) ? tabParam : "my-learning";

  // Sync invalid tab params to a valid tab without leaving a junky URL
  useEffect(() => {
    if (tabParam && !VALID_TABS.includes(tabParam)) {
      navigate("/learning", { replace: true });
    }
  }, [tabParam, navigate]);

  function setTab(tab: TabKey) {
    if (tab === "my-learning") navigate("/learning");
    else navigate(`/learning?tab=${tab}`);
  }

  // Scroll to & flash an item when arriving from the unified search
  useSearchFocus(search);

  function handleContinueLearning() {
    setTab("my-learning");
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 0);
  }

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-4 md:py-6 space-y-4">
      <HeroBanner activeTab={activeTab} onContinue={handleContinueLearning} />

      {activeTab === "my-learning" && (
        <div className="space-y-3">
          <TeamPulseStrip />
          <QuickLinks onSelect={setTab} />
        </div>
      )}

      <TabBar active={activeTab} onChange={setTab} />

      <div
        role="tabpanel"
        id={`tab-panel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
        className="-mx-4 md:-mx-6"
        data-testid={`tab-panel-${activeTab}`}
      >
        {activeTab === "my-learning" && <Learning />}
        {activeTab === "knowledge-base" && <KnowledgeBase />}
        {activeTab === "sop-revisions" && <SOPRevisions />}
        {activeTab === "improvements" && <ImprovementFeed />}
        {activeTab === "lean-board" && (
          <>
            <LeanBoard />
            <div className="max-w-4xl mx-auto px-4">
              <TopContributorsCard />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
