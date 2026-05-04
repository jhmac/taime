import type { ComponentType, SVGProps } from "react";
import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient as qc } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import {
  Upload,
  FileText,
  Loader2,
  Trash2,
  CheckCircle,
  AlertCircle,
  Clock,
  X,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Check,
  BookOpen,
  ClipboardList,
  GraduationCap,
  Library,
  Plus,
  RefreshCw,
  Send,
  Pencil,
  Paperclip,
  Zap,
  ListChecks,
  ArrowRight,
  PartyPopper,
  Keyboard,
  ExternalLink,
} from "lucide-react";
import type { KnowledgeDocument, AiGeneratedItem, QuizQuestion } from "@shared/schema";

// ── Ara branding ────────────────────────────────────────────────────────────

function AraAvatar({ size = "sm" }: { size?: "xs" | "sm" | "md" | "lg" }) {
  const sizes = { xs: "w-5 h-5", sm: "w-7 h-7", md: "w-9 h-9", lg: "w-12 h-12" };
  const iconSizes = { xs: "w-2.5 h-2.5", sm: "w-3.5 h-3.5", md: "w-4.5 h-4.5", lg: "w-6 h-6" };
  return (
    <div className={`${sizes[size]} rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-sm`}>
      <Sparkles className={`${iconSizes[size]} text-white`} />
    </div>
  );
}

// ── Shared types & constants ─────────────────────────────────────────────────

const STATUS_CONFIG = {
  pending: { icon: Clock, label: "Pending", class: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  processing: { icon: Loader2, label: "Reading…", class: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  ready: { icon: CheckCircle, label: "Ready", class: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  failed: { icon: AlertCircle, label: "Failed", class: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
};

const OUTPUT_TYPES = [
  { id: "sops", label: "SOPs", description: "Step-by-step standard operating procedures", icon: ClipboardList },
  { id: "training", label: "Training Modules", description: "Structured learning content with exercises", icon: GraduationCap },
  { id: "tasks", label: "Task Lists", description: "Actionable checklists for daily operations", icon: CheckCircle },
  { id: "knowledge_base", label: "Knowledge Base", description: "Searchable reference articles", icon: Library },
];

type LucideIcon = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;

const TYPE_CONFIG: Record<string, { label: string; icon: LucideIcon; color: string; accent: string }> = {
  sop: { label: "SOP", icon: ClipboardList, color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200", accent: "bg-blue-500" },
  training: { label: "Training", icon: GraduationCap, color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200", accent: "bg-purple-500" },
  task: { label: "Task List", icon: CheckCircle, color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", accent: "bg-green-500" },
  knowledge_base: { label: "Knowledge Base", icon: Library, color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200", accent: "bg-orange-500" },
};

interface UploadingFile {
  id: string;
  name: string;
  progress: "uploading" | "done" | "error";
  error?: string;
}

interface AiItemUpdatePayload {
  title?: string;
  content?: Record<string, unknown>;
  status?: "in_review" | "approved" | "discarded";
  feedbackNotes?: string;
}

interface RefinePayload {
  feedback: string;
  sectionKey?: string;
}

interface GeneratePayload {
  selectedDocumentIds: string[];
  outputTypes: string[];
  targetRoles: string[];
  aiDecide?: boolean;
}

type SopStep = { title: string; description: string; decisionOptions?: Array<{ condition: string; action: string }> };
type SopContent = { role?: string; summary?: string; steps?: SopStep[]; tags?: string[] };
type TrainingContent = { role?: string; description?: string; objectives?: string[]; markdownContent?: string; exercises?: Array<{ scenario: string; question: string; guidance: string }>; estimatedMinutes?: number };
type TaskItem = { title: string; description?: string; estimatedMinutes?: number; isRequired?: boolean };
type TaskContent = { role?: string; description?: string; frequency?: string; tasks?: TaskItem[] };
type KbParagraph = { heading?: string; body: string };
type KbContent = { category?: string; summary?: string; paragraphs?: KbParagraph[]; tags?: string[] };

type QuickActionResult =
  | { action: "create_tasks"; summary: string; count: number; tasks: { id: string; title: string; dayOfWeek?: string; timeOfDay?: string }[] }
  | { action: "answer"; text: string }
  | null;

// ── Pipeline Progress Bar ────────────────────────────────────────────────────

type PipelineStage = "upload" | "generate" | "review";

function PipelineProgressBar({ stage }: { stage: PipelineStage }) {
  const stages: { id: PipelineStage; label: string; icon: LucideIcon }[] = [
    { id: "upload", label: "Upload", icon: Upload },
    { id: "generate", label: "Generate", icon: Sparkles },
    { id: "review", label: "Review & Publish", icon: BookOpen },
  ];

  const stageIndex = stages.findIndex((s) => s.id === stage);

  return (
    <div className="flex items-center gap-0 w-full">
      {stages.map((s, i) => {
        const isComplete = i < stageIndex;
        const isActive = i === stageIndex;
        const Icon = s.icon;
        return (
          <div key={s.id} className="flex items-center flex-1">
            <div className="flex items-center gap-2 flex-1">
              {i > 0 && (
                <div className={`h-0.5 flex-1 transition-colors duration-500 ${isComplete || isActive ? "bg-primary" : "bg-border"}`} />
              )}
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-300 whitespace-nowrap ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : isComplete
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground"
              }`}>
                {isComplete ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <Icon className={`w-3 h-3 ${isActive ? "animate-pulse" : ""}`} />
                )}
                {s.label}
              </div>
              {i < stages.length - 1 && (
                <div className={`h-0.5 flex-1 transition-colors duration-500 ${isComplete ? "bg-primary" : "bg-border"}`} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Quick Action Panel (unchanged) ───────────────────────────────────────────

function QuickActionPanel() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState("");
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [result, setResult] = useState<QuickActionResult>(null);
  const [loading, setLoading] = useState(false);

  const handleFile = (file: File) => setAttachedFile(file);

  const removeFile = () => {
    setAttachedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const run = async () => {
    if (!prompt.trim()) {
      toast({ title: "Enter a prompt first", variant: "destructive" });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("prompt", prompt.trim());
      if (attachedFile) formData.append("file", attachedFile);

      const res = await fetch("/api/ai-studio/quick-action", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? "Request failed");
      }
      const data = await res.json();
      setResult(data);
      if (data.action === "create_tasks") {
        toast({ title: `Created ${data.count} tasks`, description: data.summary });
        qc.invalidateQueries({ queryKey: ["/api/tasks"] });
      }
    } catch (err: unknown) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Something went wrong", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const DAY_LABELS: Record<string, string> = {
    monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu",
    friday: "Fri", saturday: "Sat", sunday: "Sun",
  };

  const grouped = result?.action === "create_tasks"
    ? result.tasks.reduce<Record<string, typeof result.tasks>>((acc, t) => {
        const key = t.dayOfWeek ?? "unscheduled";
        if (!acc[key]) acc[key] = [];
        acc[key].push(t);
        return acc;
      }, {})
    : null;

  return (
    <Card className="border-primary/20 bg-primary/[0.02] dark:bg-primary/[0.04]">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          Quick Action
          <span className="text-xs font-normal text-muted-foreground ml-1">
            Attach a file and describe what you want to do
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.jpg,.jpeg,.png"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          {attachedFile ? (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md text-sm flex-1 min-w-0">
              <FileText className="w-4 h-4 text-primary shrink-0" />
              <span className="truncate flex-1">{attachedFile.name}</span>
              <button onClick={removeFile} className="text-muted-foreground hover:text-foreground shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-muted-foreground"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="w-4 h-4" />
              Attach file
            </Button>
          )}
        </div>

        <div className="flex gap-2">
          <Textarea
            placeholder='e.g. "Scan this chore list and create recurring weekly tasks assigned to each day"'
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            className="resize-none flex-1 text-sm"
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); }}
          />
          <Button onClick={run} disabled={loading || !prompt.trim()} className="self-end gap-1.5 shrink-0">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {loading ? "Running…" : "Run"}
          </Button>
        </div>

        {result?.action === "create_tasks" && grouped && (
          <div className="mt-2 space-y-3 animate-in fade-in-0 duration-300">
            <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400">
              <ListChecks className="w-4 h-4" />
              {result.summary}
            </div>
            {Object.entries(grouped).map(([day, dayTasks]) => (
              <div key={day} className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {DAY_LABELS[day] ?? day}
                </p>
                <div className="grid gap-1">
                  {dayTasks.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 text-sm px-2 py-1 rounded bg-muted/60">
                      <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      <span className="flex-1 truncate">{t.title}</span>
                      {t.timeOfDay && (
                        <Badge variant="outline" className="text-xs capitalize shrink-0">{t.timeOfDay}</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {result?.action === "answer" && (
          <div className="mt-2 p-3 bg-muted rounded-md text-sm animate-in fade-in-0 duration-300">
            {result.text}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Source Library (enhanced) ────────────────────────────────────────────────

interface KbNotification {
  id: string;
  fileName: string;
  suggestedAction: string | null;
}

const QUICK_ACTION_CONFIG: Record<string, { label: string; description: string; icon: LucideIcon; queryParam: string }> = {
  supply_list: {
    label: "Create Supply Checklist",
    description: "Turn this supply list into a reusable checklist",
    icon: ListChecks,
    queryParam: "tasks",
  },
  chore_list: {
    label: "Create Chore List",
    description: "Convert this into daily chore tasks",
    icon: ListChecks,
    queryParam: "tasks",
  },
  task_list: {
    label: "Create Task List",
    description: "Turn this into recurring daily tasks",
    icon: ListChecks,
    queryParam: "tasks",
  },
  sop: {
    label: "Generate SOPs",
    description: "Create step-by-step SOPs from this document",
    icon: ClipboardList,
    queryParam: "sops",
  },
  training: {
    label: "Generate Training Module",
    description: "Create a training module from this content",
    icon: GraduationCap,
    queryParam: "training",
  },
};

function SourceLibrary({ onStartGenerate }: { onStartGenerate: (preselectedOutputType?: string) => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [kbNotifications, setKbNotifications] = useState<KbNotification[]>([]);

  const { data: docsResponse, isLoading } = useQuery<{ success: boolean; data: KnowledgeDocument[] }>({
    queryKey: ["/api/ai-studio/documents"],
    refetchInterval: (query) => {
      const docs = query.state.data?.data ?? [];
      const hasPending = docs.some((d) => d.processingStatus === "pending" || d.processingStatus === "processing");
      return hasPending ? 3000 : false;
    },
  });

  const docs = docsResponse?.data ?? [];
  const allReady = docs.length > 0 && docs.every((d) => d.processingStatus === "ready");
  const hasProcessing = docs.some((d) => d.processingStatus === "pending" || d.processingStatus === "processing");

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/ai-studio/documents/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ai-studio/documents"] });
      toast({ title: "Document removed" });
    },
  });

  const uploadFile = async (file: File) => {
    const id = Math.random().toString(36).slice(2);
    setUploadingFiles((prev) => [...prev, { id, name: file.name, progress: "uploading" }]);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/ai-studio/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      const suggestedAction: string | null = data?.suggestedAction ?? null;
      qc.invalidateQueries({ queryKey: ["/api/ai-studio/documents"] });
      setUploadingFiles((prev) => prev.map((f) => f.id === id ? { ...f, progress: "done" } : f));
      setKbNotifications((prev) => [...prev, { id, fileName: file.name, suggestedAction }]);
      setTimeout(() => setUploadingFiles((prev) => prev.filter((f) => f.id !== id)), 2000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setUploadingFiles((prev) => prev.map((f) => f.id === id ? { ...f, progress: "error", error: message } : f));
    }
  };

  const handleFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach(uploadFile);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const READING_LABELS = ["Extracting structure…", "Summarizing…", "Analyzing content…", "Classifying document…"];

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 ${
          isDragOver
            ? "border-primary bg-primary/5 scale-[1.01]"
            : "border-border hover:border-primary/40 hover:bg-muted/30"
        }`}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        <div className="w-10 h-10 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-3">
          <Upload className="w-5 h-5 text-muted-foreground" />
        </div>
        <p className="font-semibold mb-1 text-foreground">Drop files here or click to upload</p>
        <p className="text-sm text-muted-foreground mb-4">PDF, DOCX, TXT, JPG, PNG — up to 50MB</p>
        <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
          <Upload className="w-4 h-4 mr-2" />
          Choose Files
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.docx,.txt,.jpg,.jpeg,.png"
          multiple
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {/* Uploading indicators */}
      {uploadingFiles.length > 0 && (
        <div className="space-y-2">
          {uploadingFiles.map((f) => (
            <div key={f.id} className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg text-sm">
              {f.progress === "uploading" && <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />}
              {f.progress === "done" && <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />}
              {f.progress === "error" && <AlertCircle className="w-4 h-4 text-destructive shrink-0" />}
              <span className="truncate flex-1">{f.name}</span>
              {f.progress === "uploading" && <span className="text-xs text-muted-foreground">Uploading…</span>}
              {f.progress === "error" && <span className="text-xs text-destructive">{f.error}</span>}
            </div>
          ))}
        </div>
      )}

      {/* KB added confirmation + quick action suggestions */}
      {kbNotifications.length > 0 && (
        <div className="space-y-2">
          {kbNotifications.map((n) => {
            const qaCfg = n.suggestedAction ? QUICK_ACTION_CONFIG[n.suggestedAction] : null;
            const QaIcon = qaCfg?.icon;
            return (
              <div key={n.id} className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-3 animate-in fade-in-0 duration-300">
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                      Added to Knowledge Center
                    </p>
                    <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-0.5 truncate">
                      "{n.fileName}" will appear in the Knowledge Base once Ara finishes reading it.
                    </p>
                    <button
                      onClick={() => navigate("/learning?tab=knowledge-base")}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:underline mt-1"
                    >
                      View Knowledge Base <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                  <button
                    onClick={() => setKbNotifications((prev) => prev.filter((x) => x.id !== n.id))}
                    className="shrink-0 text-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-300"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {qaCfg && QaIcon && (
                  <div className="mt-3 pt-3 border-t border-emerald-200 dark:border-emerald-800">
                    <p className="text-xs text-emerald-700 dark:text-emerald-400 mb-2 font-medium">Quick action detected:</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1.5 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                      onClick={() => onStartGenerate(qaCfg.queryParam)}
                    >
                      <QaIcon className="w-3.5 h-3.5" />
                      {qaCfg.label}
                    </Button>
                    <p className="text-xs text-muted-foreground mt-1">{qaCfg.description}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      ) : docs.length === 0 ? (
        <div className="text-center py-10 rounded-xl border border-dashed border-border">
          <FileText className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
          <p className="font-medium text-muted-foreground">No documents yet</p>
          <p className="text-sm text-muted-foreground/60 mt-1 max-w-xs mx-auto">
            Upload your training manuals, SOPs, or reference documents above — Ara will read and understand them.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((doc, idx) => {
            const status = STATUS_CONFIG[doc.processingStatus as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;
            const StatusIcon = status.icon;
            const isProcessing = doc.processingStatus === "pending" || doc.processingStatus === "processing";
            const readingLabel = READING_LABELS[idx % READING_LABELS.length];
            return (
              <div key={doc.id} className="flex items-start gap-3 p-3 border border-border rounded-xl bg-card transition-all">
                {/* Ara reading animation */}
                <div className="shrink-0 mt-0.5">
                  {isProcessing ? (
                    <div className="relative w-7 h-7">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center animate-pulse">
                        <Sparkles className="w-3.5 h-3.5 text-white" />
                      </div>
                    </div>
                  ) : (
                    <FileText className="w-4 h-4 text-muted-foreground mt-0.5" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">{doc.originalFileName}</span>
                    <Badge className={`text-xs flex items-center gap-1 ${status.class}`}>
                      <StatusIcon className={`w-3 h-3 ${isProcessing ? "animate-spin" : ""}`} />
                      {isProcessing ? readingLabel : status.label}
                    </Badge>
                  </div>
                  {doc.summaryFromClaude && !isProcessing && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{doc.summaryFromClaude}</p>
                  )}
                  {isProcessing && (
                    <p className="text-xs text-violet-600 dark:text-violet-400 mt-1">Ara is reading this document…</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-destructive hover:text-destructive shrink-0"
                  onClick={() => deleteMutation.mutate(doc.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* Post-upload CTA — only when all docs ready */}
      {allReady && (
        <div className="rounded-2xl border-2 border-violet-200 dark:border-violet-800 bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-violet-950/30 dark:to-indigo-950/30 p-6 text-center animate-in fade-in-0 slide-in-from-bottom-2 duration-500">
          <div className="flex items-center justify-center gap-2 mb-3">
            <AraAvatar size="md" />
            <span className="font-bold text-lg text-violet-800 dark:text-violet-200">Ready to generate!</span>
          </div>
          <p className="text-sm text-violet-700 dark:text-violet-300 mb-1 font-medium">
            Ara has read {docs.length} document{docs.length !== 1 ? "s" : ""} and is ready to create your knowledge base.
          </p>
          <p className="text-xs text-muted-foreground mb-5">
            She'll generate SOPs, training modules, task lists, and knowledge base articles — all tailored to your content.
          </p>
          <Button
            size="lg"
            className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white gap-2 shadow-lg shadow-violet-500/20 px-8"
            onClick={() => onStartGenerate()}
          >
            <Sparkles className="w-5 h-5" />
            Generate Knowledge Base with Ara
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Processing state message */}
      {hasProcessing && docs.length > 0 && !allReady && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800">
          <AraAvatar size="sm" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-violet-800 dark:text-violet-200">Ara is reading your documents…</p>
            <p className="text-xs text-violet-600 dark:text-violet-400 mt-0.5">She'll be ready to generate in a moment.</p>
          </div>
          <Loader2 className="w-4 h-4 animate-spin text-violet-500 shrink-0" />
        </div>
      )}
    </div>
  );
}

// ── Generation Wizard ────────────────────────────────────────────────────────

function GenerationWizard({ onComplete, preselectedOutputType }: { onComplete: () => void; preselectedOutputType?: string }) {
  const { toast } = useToast();
  const [step, setStep] = useState(() => {
    try { return parseInt(localStorage.getItem("aiStudio.step") || "0", 10) || 0; } catch { return 0; }
  });
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [selectedOutputTypes, setSelectedOutputTypes] = useState<string[]>(
    preselectedOutputType ? [preselectedOutputType] : ["sops"]
  );
  useEffect(() => {
    if (preselectedOutputType) {
      setSelectedOutputTypes([preselectedOutputType]);
    }
  }, [preselectedOutputType]);
  const [targetRoles, setTargetRoles] = useState(["New Associate", "Lead", "Manager"]);
  const [roleInput, setRoleInput] = useState("");
  const [jobId, setJobId] = useState<string | null>(() => {
    try { return localStorage.getItem("aiStudio.jobId") || null; } catch { return null; }
  });
  const [progressLog, setProgressLog] = useState<string[]>([]);

  const persistStep = (s: number) => {
    setStep(s);
    try { if (s === 0) { localStorage.removeItem("aiStudio.step"); localStorage.removeItem("aiStudio.jobId"); } else { localStorage.setItem("aiStudio.step", String(s)); } } catch {}
  };
  const persistJobId = (id: string | null) => {
    setJobId(id);
    try { if (id) { localStorage.setItem("aiStudio.jobId", id); } else { localStorage.removeItem("aiStudio.jobId"); } } catch {}
  };
  const logEndRef = useRef<HTMLDivElement>(null);

  const { data: docsResponse } = useQuery<{ success: boolean; data: KnowledgeDocument[] }>({
    queryKey: ["/api/ai-studio/documents"],
  });
  const docs = (docsResponse?.data ?? []).filter((d) => d.processingStatus === "ready");

  const { data: recentJobsData } = useQuery<{ success: boolean; jobs: Array<{ jobId: string; status: string; itemsGenerated: number; totalDocuments: number; updatedAt: string }> }>({
    queryKey: ["/api/ai-studio/jobs/recent"],
    enabled: step === 0,
  });
  const resumableJob = recentJobsData?.jobs?.find((j) => j.status === "failed" && j.itemsGenerated > 0);

  const generateMutation = useMutation({
    mutationFn: (data: GeneratePayload) => apiRequest("POST", "/api/ai-studio/generate", data),
    onSuccess: async (res) => {
      const data = await res.json();
      persistJobId(data.jobId);
      persistStep(2);
    },
    onError: () => {
      toast({ title: "Generation failed", variant: "destructive" });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: (failedJobId: string) => apiRequest("POST", `/api/ai-studio/jobs/${failedJobId}/resume`, {}),
    onSuccess: async (res) => {
      const data = await res.json();
      if (data.jobId) {
        persistJobId(data.jobId);
        setProgressLog([]);
      } else {
        toast({ title: "All documents already processed", description: "Nothing left to resume." });
        onComplete();
      }
    },
    onError: () => {
      toast({ title: "Resume failed", variant: "destructive" });
    },
  });

  const { data: jobStatus } = useQuery<{ jobId: string; status: string; progressLog: string[]; itemsGenerated: number; totalDocuments: number }>({
    queryKey: ["/api/ai-studio/jobs", jobId, "status"],
    enabled: !!jobId && step === 2,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "complete" || s === "failed" ? false : 2000;
    },
  });

  useEffect(() => {
    if (jobStatus?.progressLog) {
      setProgressLog(jobStatus.progressLog);
    }
  }, [jobStatus]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [progressLog]);

  useEffect(() => {
    if (jobStatus?.status === "complete") {
      qc.invalidateQueries({ queryKey: ["/api/ai-studio/items"] });
      try { localStorage.removeItem("aiStudio.step"); localStorage.removeItem("aiStudio.jobId"); } catch {}
      setTimeout(() => onComplete(), 1500);
    }
  }, [jobStatus?.status]);

  const toggleDoc = (id: string) => {
    setSelectedDocIds((prev) => prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]);
  };

  const toggleOutputType = (id: string) => {
    setSelectedOutputTypes((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]);
  };

  const addRole = () => {
    const trimmed = roleInput.trim();
    if (trimmed && !targetRoles.includes(trimmed)) {
      setTargetRoles((prev) => [...prev, trimmed]);
    }
    setRoleInput("");
  };

  const handleGenerate = (aiDecide = false) => {
    generateMutation.mutate({
      selectedDocumentIds: selectedDocIds,
      outputTypes: aiDecide ? ["sops"] : selectedOutputTypes,
      targetRoles,
      aiDecide,
    });
  };

  if (step === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <AraAvatar size="sm" />
          <p className="text-sm font-medium text-foreground">Select documents for Ara to analyze</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Only <strong>Ready</strong> documents are available. Ara will read each one and generate content.
        </p>

        {resumableJob && (
          <div className="flex items-start gap-3 p-3 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Previous generation was interrupted</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                {resumableJob.itemsGenerated} items saved — click Continue to process the remaining documents.
              </p>
            </div>
            <Button
              size="sm"
              className="shrink-0 bg-amber-600 hover:bg-amber-700 text-white text-xs"
              onClick={() => {
                persistStep(2);
                persistJobId(resumableJob.jobId);
                resumeMutation.mutate(resumableJob.jobId);
              }}
              disabled={resumeMutation.isPending}
            >
              {resumeMutation.isPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : "Continue"}
            </Button>
          </div>
        )}

        {docs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm border border-dashed rounded-xl">
            No ready documents available. Upload and wait for Ara to finish reading them.
          </div>
        ) : (
          <div className="space-y-2">
            <button
              className="text-xs text-primary underline-offset-2 hover:underline mb-1"
              onClick={() => setSelectedDocIds(docs.map(d => d.id))}
            >
              Select all
            </button>
            {docs.map((doc) => (
              <label
                key={doc.id}
                className={`flex items-center gap-3 p-3 border rounded-xl cursor-pointer transition-colors ${selectedDocIds.includes(doc.id) ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
              >
                <Checkbox
                  checked={selectedDocIds.includes(doc.id)}
                  onCheckedChange={() => toggleDoc(doc.id)}
                />
                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{doc.originalFileName}</p>
                  {doc.summaryFromClaude && (
                    <p className="text-xs text-muted-foreground line-clamp-1">{doc.summaryFromClaude}</p>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}
        <div className="flex justify-end pt-2">
          <Button
            onClick={() => persistStep(1)}
            disabled={selectedDocIds.length === 0}
          >
            Next: Choose Outputs
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => handleGenerate(true)}
          disabled={generateMutation.isPending}
          className="w-full flex items-start gap-4 p-4 rounded-xl border-2 border-violet-300 dark:border-violet-700 bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-violet-950/30 dark:to-indigo-950/30 hover:from-violet-100 hover:to-indigo-100 dark:hover:from-violet-950/50 dark:hover:to-indigo-950/50 transition-colors text-left group"
        >
          <AraAvatar size="md" />
          <div className="flex-1">
            <p className="font-semibold text-sm text-violet-800 dark:text-violet-200">Let Ara Decide</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Ara reads each document and automatically picks the best format — SOPs for scripts and processes, Training for skills content, Tasks for operational checklists, Knowledge Base for reference material.
            </p>
          </div>
          {generateMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin text-violet-600 shrink-0 ml-auto mt-1" />
          ) : (
            <ChevronRight className="w-4 h-4 text-violet-500 shrink-0 ml-auto mt-1 opacity-60 group-hover:opacity-100 transition-opacity" />
          )}
        </button>

        <div className="relative flex items-center">
          <div className="flex-1 border-t border-border" />
          <span className="px-3 text-xs text-muted-foreground">or choose manually</span>
          <div className="flex-1 border-t border-border" />
        </div>

        <div>
          <p className="text-sm font-medium mb-3">What would you like Ara to generate?</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {OUTPUT_TYPES.map((type) => {
              const Icon = type.icon;
              return (
                <label
                  key={type.id}
                  className={`flex items-start gap-3 p-3 border rounded-xl cursor-pointer transition-colors ${selectedOutputTypes.includes(type.id) ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
                >
                  <Checkbox
                    checked={selectedOutputTypes.includes(type.id)}
                    onCheckedChange={() => toggleOutputType(type.id)}
                    className="mt-0.5"
                  />
                  <Icon className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">{type.label}</p>
                    <p className="text-xs text-muted-foreground">{type.description}</p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium mb-2">Target roles</p>
          <div className="flex flex-wrap gap-2 mb-2">
            {targetRoles.map((role) => (
              <span
                key={role}
                className="inline-flex items-center gap-1 text-xs bg-secondary text-secondary-foreground px-2 py-1 rounded-full"
              >
                {role}
                <button onClick={() => setTargetRoles((prev) => prev.filter((r) => r !== role))}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={roleInput}
              onChange={(e) => setRoleInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addRole()}
              placeholder="Add a role..."
              className="h-8 text-sm"
            />
            <Button size="sm" variant="outline" onClick={addRole} className="h-8">
              <Plus className="w-3 h-3" />
            </Button>
          </div>
        </div>

        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={() => persistStep(0)}>
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          <Button
            onClick={() => handleGenerate(false)}
            disabled={selectedOutputTypes.length === 0 || generateMutation.isPending}
            className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
          >
            {generateMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Starting…</>
            ) : (
              <><Sparkles className="w-4 h-4 mr-2" />Generate with Ara</>
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 p-4 rounded-xl bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800">
        <AraAvatar size="md" />
        <div>
          <p className="font-semibold text-violet-800 dark:text-violet-200">Ara is generating your content…</p>
          <p className="text-xs text-violet-600 dark:text-violet-400 mt-0.5">This may take a minute. You can watch her work below.</p>
        </div>
      </div>

      <div className="bg-muted/50 rounded-xl p-4 font-mono text-xs space-y-1.5 max-h-64 overflow-y-auto">
        {progressLog.map((line, i) => (
          <div key={i} className="flex items-start gap-2">
            {i === progressLog.length - 1 && jobStatus?.status === "running" ? (
              <Loader2 className="w-3 h-3 animate-spin text-violet-500 shrink-0 mt-0.5" />
            ) : (
              <Check className="w-3 h-3 text-green-500 shrink-0 mt-0.5" />
            )}
            <span className="text-foreground/80">{line}</span>
          </div>
        ))}
        {progressLog.length === 0 && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Initializing…</span>
          </div>
        )}
        <div ref={logEndRef} />
      </div>

      {jobStatus?.status === "complete" && (
        <div className="flex items-center gap-2 text-green-600 dark:text-green-400 font-medium text-sm p-3 rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
          <CheckCircle className="w-5 h-5" />
          Generation complete! Opening Review Theater…
        </div>
      )}

      {jobStatus?.status === "failed" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-destructive font-medium text-sm">
            <AlertCircle className="w-5 h-5" />
            Generation was interrupted.
            {(jobStatus.itemsGenerated ?? 0) > 0 && (
              <span className="text-muted-foreground font-normal ml-1">
                {jobStatus.itemsGenerated} item{jobStatus.itemsGenerated !== 1 ? "s" : ""} already saved.
              </span>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {(jobStatus.itemsGenerated ?? 0) > 0 && jobId && (
              <Button
                size="sm"
                className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"
                onClick={() => resumeMutation.mutate(jobId)}
                disabled={resumeMutation.isPending}
              >
                <RefreshCw className={`w-4 h-4 ${resumeMutation.isPending ? "animate-spin" : ""}`} />
                Continue Generation
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={() => { persistStep(0); persistJobId(null); setProgressLog([]); }}
            >
              Start Over
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Inline text field ────────────────────────────────────────────────────────

function InlineTextField({
  value,
  onSave,
  editable,
  multiline,
  className,
}: {
  value: string;
  onSave: (v: string) => void;
  editable: boolean;
  multiline?: boolean;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const handleSave = () => {
    onSave(draft);
    setEditing(false);
    setSaving(true);
    setJustSaved(false);
    setTimeout(() => { setSaving(false); setJustSaved(true); }, 600);
    setTimeout(() => setJustSaved(false), 2200);
  };

  if (!editable) {
    return <span className={className}>{value}</span>;
  }

  if (editing) {
    return (
      <div className="space-y-1">
        {multiline ? (
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="text-sm min-h-[60px]"
            autoFocus
            rows={3}
            onKeyDown={(e) => { if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
          />
        ) : (
          <input
            className="w-full border border-input rounded px-2 py-1 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
          />
        )}
        <div className="flex gap-1.5 items-center">
          <Button size="sm" className="h-6 text-xs" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => { setDraft(value); setEditing(false); }}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <span
      className={`${className || ""} cursor-pointer hover:bg-primary/10 hover:rounded px-0.5 -mx-0.5 transition-colors group`}
      title="Click to edit"
      onClick={() => { setDraft(value); setEditing(true); }}
    >
      {value}
      {justSaved ? (
        <Check className="w-2.5 h-2.5 inline ml-1 text-emerald-500 shrink-0" />
      ) : (
        <Pencil className="w-2.5 h-2.5 inline ml-1 opacity-0 group-hover:opacity-50 shrink-0" />
      )}
    </span>
  );
}

// ── Full-page document renderer ──────────────────────────────────────────────

function DocumentFullPage({
  item,
  onUpdate,
}: {
  item: AiGeneratedItem;
  onUpdate: (id: string, data: AiItemUpdatePayload) => void;
}) {
  const contentRaw = item.content as Record<string, unknown>;
  const sopContent = contentRaw as SopContent;
  const trainingContent = contentRaw as TrainingContent;
  const taskContent = contentRaw as TaskContent;
  const kbContent = contentRaw as KbContent;

  const isDiscarded = item.status === "discarded";
  const isPublished = item.status === "published";
  const editable = !isPublished && !isDiscarded;

  const typeConf = TYPE_CONFIG[item.type] || TYPE_CONFIG.sop;
  const TypeIcon = typeConf.icon;

  const handleFieldSave = (fieldKey: string, newValue: unknown) => {
    onUpdate(item.id, { content: { ...contentRaw, [fieldKey]: newValue } });
  };

  const handleStepFieldSave = (stepIndex: number, fieldKey: string, newValue: string) => {
    const newSteps = [...(sopContent.steps || [])];
    newSteps[stepIndex] = { ...newSteps[stepIndex], [fieldKey]: newValue };
    onUpdate(item.id, { content: { ...contentRaw, steps: newSteps } });
  };

  const handleTaskFieldSave = (taskIndex: number, fieldKey: string, newValue: string) => {
    const newTasks = [...(taskContent.tasks || [])];
    newTasks[taskIndex] = { ...newTasks[taskIndex], [fieldKey]: newValue };
    onUpdate(item.id, { content: { ...contentRaw, tasks: newTasks } });
  };

  const handleParaFieldSave = (paraIndex: number, fieldKey: string, newValue: string) => {
    const newParas = [...(kbContent.paragraphs || [])];
    newParas[paraIndex] = { ...newParas[paraIndex], [fieldKey]: newValue };
    onUpdate(item.id, { content: { ...contentRaw, paragraphs: newParas } });
  };

  const handleTitleSave = (newTitle: string) => {
    onUpdate(item.id, { title: newTitle });
  };

  const renderSop = () => (
    <div className="space-y-8">
      {sopContent.role && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">For role</span>
          <Badge variant="outline" className="text-xs">{sopContent.role}</Badge>
        </div>
      )}
      {sopContent.summary !== undefined && (
        <div className="p-4 rounded-xl bg-muted/40 border-l-4 border-primary">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Summary</p>
          <InlineTextField value={sopContent.summary || ""} onSave={(v) => handleFieldSave("summary", v)} editable={editable} multiline className="text-base text-foreground/90 leading-relaxed" />
        </div>
      )}
      {Array.isArray(sopContent.steps) && sopContent.steps.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-foreground mb-5 pb-2 border-b border-border">Steps</h2>
          <div className="space-y-4">
            {sopContent.steps.map((step, i) => (
              <div key={i} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="w-9 h-9 rounded-full bg-primary/10 text-primary text-sm flex items-center justify-center shrink-0 font-bold border-2 border-primary/20">
                    {i + 1}
                  </div>
                  {i < (sopContent.steps?.length ?? 0) - 1 && (
                    <div className="w-0.5 flex-1 bg-border mt-2 min-h-[24px]" />
                  )}
                </div>
                <div className="flex-1 min-w-0 pb-4">
                  <InlineTextField value={step.title || ""} onSave={(v) => handleStepFieldSave(i, "title", v)} editable={editable} className="font-semibold text-base text-foreground block mb-1" />
                  <InlineTextField value={step.description || ""} onSave={(v) => handleStepFieldSave(i, "description", v)} editable={editable} multiline className="text-sm text-muted-foreground leading-relaxed block" />
                  {step.decisionOptions && step.decisionOptions.length > 0 && (
                    <div className="mt-3 space-y-1.5 pl-2 border-l-2 border-amber-300 dark:border-amber-700">
                      {step.decisionOptions.map((opt, j) => (
                        <div key={j} className="text-xs bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-1.5">
                          <span className="font-semibold text-amber-800 dark:text-amber-300">{opt.condition}</span>
                          <span className="text-muted-foreground mx-2">→</span>
                          <span>{opt.action}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {Array.isArray(sopContent.tags) && sopContent.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-2">
          {sopContent.tags.map((tag) => (
            <span key={tag} className="text-xs bg-secondary text-secondary-foreground px-2.5 py-1 rounded-full">{tag}</span>
          ))}
        </div>
      )}
    </div>
  );

  const renderTraining = () => (
    <div className="space-y-8">
      {trainingContent.role && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">For role</span>
          <Badge variant="outline" className="text-xs">{trainingContent.role}</Badge>
        </div>
      )}
      {trainingContent.estimatedMinutes && (
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Clock className="w-4 h-4" />
          <span>~{trainingContent.estimatedMinutes} minutes</span>
        </div>
      )}
      {trainingContent.description !== undefined && (
        <div className="p-4 rounded-xl bg-muted/40 border-l-4 border-purple-400">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Overview</p>
          <InlineTextField value={trainingContent.description || ""} onSave={(v) => handleFieldSave("description", v)} editable={editable} multiline className="text-base text-foreground/90 leading-relaxed" />
        </div>
      )}
      {Array.isArray(trainingContent.objectives) && trainingContent.objectives.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-foreground mb-4 pb-2 border-b border-border">Learning Objectives</h2>
          <ul className="space-y-2.5">
            {trainingContent.objectives.map((obj, i) => (
              <li key={i} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center shrink-0 mt-0.5">
                  <Check className="w-3 h-3 text-green-600 dark:text-green-400" />
                </div>
                <InlineTextField value={obj} onSave={(v) => { const newObjs = [...(trainingContent.objectives ?? [])]; newObjs[i] = v; handleFieldSave("objectives", newObjs); }} editable={editable} className="text-sm text-foreground/90 leading-relaxed flex-1" />
              </li>
            ))}
          </ul>
        </div>
      )}
      {trainingContent.markdownContent !== undefined && (
        <div>
          <h2 className="text-lg font-bold text-foreground mb-4 pb-2 border-b border-border">Training Content</h2>
          <InlineTextField value={trainingContent.markdownContent || ""} onSave={(v) => handleFieldSave("markdownContent", v)} editable={editable} multiline className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap block" />
        </div>
      )}
      {Array.isArray(trainingContent.exercises) && trainingContent.exercises.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-foreground mb-4 pb-2 border-b border-border">Practice Exercises</h2>
          <div className="space-y-4">
            {trainingContent.exercises.map((ex, i) => (
              <div key={i} className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-widest text-purple-600 dark:text-purple-400">Scenario {i + 1}</p>
                <p className="font-semibold text-sm text-foreground">{ex.scenario}</p>
                <p className="text-sm text-muted-foreground italic">{ex.question}</p>
                <div className="mt-2 p-2 rounded-lg bg-green-50 dark:bg-green-950/30 text-xs text-green-700 dark:text-green-300">
                  <strong>Guidance:</strong> {ex.guidance}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderTask = () => (
    <div className="space-y-8">
      {taskContent.role && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">For role</span>
          <Badge variant="outline" className="text-xs">{taskContent.role}</Badge>
        </div>
      )}
      {taskContent.description !== undefined && (
        <div className="p-4 rounded-xl bg-muted/40 border-l-4 border-green-400">
          <InlineTextField value={taskContent.description || ""} onSave={(v) => handleFieldSave("description", v)} editable={editable} multiline className="text-base text-foreground/90 leading-relaxed" />
        </div>
      )}
      {taskContent.frequency && (
        <Badge variant="outline" className="text-xs capitalize">{taskContent.frequency}</Badge>
      )}
      {Array.isArray(taskContent.tasks) && taskContent.tasks.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-foreground mb-4 pb-2 border-b border-border">Task Items</h2>
          <div className="space-y-2">
            {taskContent.tasks.map((task, i) => (
              <div key={i} className="flex items-start gap-3 p-3.5 border border-border rounded-xl bg-card hover:bg-muted/20 transition-colors">
                <div className="w-5 h-5 border-2 border-border rounded mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <InlineTextField value={task.title || ""} onSave={(v) => handleTaskFieldSave(i, "title", v)} editable={editable} className="font-semibold text-sm text-foreground block" />
                  {task.description !== undefined && (
                    <InlineTextField value={task.description || ""} onSave={(v) => handleTaskFieldSave(i, "description", v)} editable={editable} multiline className="text-xs text-muted-foreground block mt-0.5" />
                  )}
                  {task.estimatedMinutes && (
                    <p className="text-xs text-muted-foreground mt-1">{task.estimatedMinutes} min</p>
                  )}
                </div>
                {task.isRequired && (
                  <Badge variant="outline" className="text-xs shrink-0">Required</Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderKnowledgeBase = () => (
    <div className="space-y-8">
      {kbContent.category && (
        <Badge variant="outline" className="text-xs">{kbContent.category}</Badge>
      )}
      {kbContent.summary !== undefined && (
        <div className="p-4 rounded-xl bg-muted/40 border-l-4 border-orange-400">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Overview</p>
          <InlineTextField value={kbContent.summary || ""} onSave={(v) => handleFieldSave("summary", v)} editable={editable} multiline className="text-base text-foreground/90 leading-relaxed" />
        </div>
      )}
      {Array.isArray(kbContent.paragraphs) && kbContent.paragraphs.length > 0 && (
        <div className="space-y-6">
          {kbContent.paragraphs.map((para, i) => (
            <div key={i}>
              {para.heading !== undefined && (
                <h2 className="text-base font-bold text-foreground mb-2 pb-1 border-b border-border">
                  <InlineTextField value={para.heading || ""} onSave={(v) => handleParaFieldSave(i, "heading", v)} editable={editable} className="block" />
                </h2>
              )}
              <InlineTextField value={para.body || ""} onSave={(v) => handleParaFieldSave(i, "body", v)} editable={editable} multiline className="text-sm text-foreground/85 leading-relaxed block" />
            </div>
          ))}
        </div>
      )}
      {Array.isArray(kbContent.tags) && kbContent.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-2">
          {kbContent.tags.map((tag) => (
            <span key={tag} className="text-xs bg-secondary text-secondary-foreground px-2.5 py-1 rounded-full">{tag}</span>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-2xl">
      {/* Document title */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <div className={`w-7 h-7 rounded-lg ${typeConf.accent} flex items-center justify-center`}>
            <TypeIcon className="w-3.5 h-3.5 text-white" />
          </div>
          <Badge className={`text-xs ${typeConf.color}`}>{typeConf.label}</Badge>
          <Badge className="text-xs bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200 gap-1">
            <Sparkles className="w-2.5 h-2.5" />
            Generated by Ara
          </Badge>
        </div>
        <h1 className="text-2xl font-extrabold text-foreground leading-tight">
          <InlineTextField value={item.title} onSave={handleTitleSave} editable={editable} className="block" />
        </h1>
      </div>

      {/* Content */}
      {item.type === "sop" && renderSop()}
      {item.type === "training" && renderTraining()}
      {item.type === "task" && renderTask()}
      {item.type === "knowledge_base" && renderKnowledgeBase()}
      {!["sop", "training", "task", "knowledge_base"].includes(item.type) && (
        <pre className="text-xs text-muted-foreground overflow-auto">{JSON.stringify(contentRaw, null, 2)}</pre>
      )}
    </div>
  );
}

// ── Floating Ara refine bar ──────────────────────────────────────────────────

function FloatingRefineBar({ itemId, editable, focusTrigger, onFocused }: {
  itemId: string;
  editable: boolean;
  focusTrigger?: boolean;
  onFocused?: () => void;
}) {
  const { toast } = useToast();
  const [feedback, setFeedback] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusTrigger && editable) {
      textareaRef.current?.focus();
      onFocused?.();
    }
  }, [focusTrigger, editable]);

  const refineMutation = useMutation({
    mutationFn: (data: RefinePayload) => apiRequest("POST", `/api/ai-studio/items/${itemId}/refine`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ai-studio/items"] });
      setFeedback("");
      toast({ title: "Ara refined the document" });
    },
    onError: () => {
      toast({ title: "Refinement failed", variant: "destructive" });
    },
  });

  if (!editable) return null;

  const handleSubmit = () => {
    if (!feedback.trim() || refineMutation.isPending) return;
    refineMutation.mutate({ feedback });
  };

  return (
    <div className="border-t border-border bg-background/95 backdrop-blur-sm px-5 py-3">
      <div className="flex items-center gap-2">
        <AraAvatar size="xs" />
        <div className="flex-1 flex items-center gap-2 bg-muted/60 border border-border rounded-xl px-3 py-2 focus-within:border-violet-400 focus-within:bg-background transition-all">
          <Textarea
            ref={textareaRef}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Ask Ara to refine this document… (e.g. 'Make the tone more friendly' or 'Add a safety step after step 3')"
            className="resize-none border-0 bg-transparent p-0 text-sm min-h-0 h-auto focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/60"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
            }}
          />
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!feedback.trim() || refineMutation.isPending}
            className="shrink-0 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white h-7 px-3 text-xs gap-1.5"
          >
            {refineMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {refineMutation.isPending ? "Refining…" : "Ask Ara"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Completion / summary screen ──────────────────────────────────────────────

function CompletionSummaryScreen({
  items,
  onPublish,
  isPublishing,
  publishedCount,
  celebrationMode,
}: {
  items: AiGeneratedItem[];
  onPublish: () => void;
  isPublishing: boolean;
  publishedCount: number;
  celebrationMode: boolean;
}) {
  const [, setLocation] = useLocation();
  const [tickerCount, setTickerCount] = useState(0);

  const approved = items.filter((i) => i.status === "approved");
  const discarded = items.filter((i) => i.status === "discarded");
  const inReview = items.filter((i) => i.status === "in_review");
  const published = items.filter((i) => i.status === "published");

  // Drive the publishing ticker animation while isPublishing is true
  useEffect(() => {
    if (!isPublishing || approved.length === 0) return;
    setTickerCount(0);
    const total = approved.length;
    const interval = Math.max(200, Math.min(600, 2000 / total));
    let current = 0;
    const timer = setInterval(() => {
      current += 1;
      setTickerCount(current);
      if (current >= total) clearInterval(timer);
    }, interval);
    return () => clearInterval(timer);
  }, [isPublishing]);

  if (isPublishing) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20 text-center px-6 animate-in fade-in-0 duration-300">
        <div className="relative mb-6">
          <AraAvatar size="lg" />
          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-violet-600 flex items-center justify-center">
            <Loader2 className="w-3 h-3 text-white animate-spin" />
          </div>
        </div>
        <h2 className="text-xl font-extrabold text-foreground mb-2">Publishing to Knowledge Base…</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Ara is sending your articles live — your team will be able to find them right away.
        </p>
        <div className="flex flex-col items-center gap-3 w-full max-w-xs">
          <div className="flex items-center justify-between w-full text-xs text-muted-foreground">
            <span>Publishing articles</span>
            <span className="font-semibold text-violet-600">{tickerCount} / {approved.length}</span>
          </div>
          <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all duration-300"
              style={{ width: `${approved.length > 0 ? (tickerCount / approved.length) * 100 : 0}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-1.5 justify-center mt-2">
            {approved.map((item, i) => (
              <div
                key={item.id}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-all duration-300 ${
                  i < tickerCount
                    ? "bg-violet-100 dark:bg-violet-900/30 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300"
                    : "bg-muted border-border text-muted-foreground/40"
                }`}
              >
                {item.title.length > 22 ? item.title.slice(0, 22) + "…" : item.title}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (celebrationMode) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20 text-center px-6 animate-in fade-in-0 zoom-in-95 duration-500">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center mb-6 shadow-xl shadow-violet-500/30">
          <PartyPopper className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-2xl font-extrabold text-foreground mb-2">Your knowledge base is live!</h2>
        <p className="text-muted-foreground text-sm mb-8 max-w-sm leading-relaxed">
          Your team can now learn from {publishedCount} article{publishedCount !== 1 ? "s" : ""} generated by Ara. They're searchable and ready to read right now.
        </p>
        <Button
          size="lg"
          className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white gap-2 px-8"
          onClick={() => setLocation("/knowledge-base")}
        >
          <BookOpen className="w-5 h-5" />
          Open Knowledge Base
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full py-16 px-6 text-center animate-in fade-in-0 duration-300">
      <AraAvatar size="lg" />
      <h2 className="text-xl font-extrabold text-foreground mt-5 mb-2">Review complete!</h2>
      <p className="text-sm text-muted-foreground mb-8">Here's a summary of what Ara generated and what you reviewed.</p>

      <div className="flex gap-4 mb-8 flex-wrap justify-center">
        <div className="flex flex-col items-center gap-1 px-6 py-4 rounded-2xl bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 min-w-[100px]">
          <span className="text-3xl font-extrabold text-green-600 dark:text-green-400">{approved.length}</span>
          <span className="text-xs font-semibold text-green-700 dark:text-green-300">Approved</span>
        </div>
        {inReview.length > 0 && (
          <div className="flex flex-col items-center gap-1 px-6 py-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 min-w-[100px]">
            <span className="text-3xl font-extrabold text-amber-600 dark:text-amber-400">{inReview.length}</span>
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">Still in review</span>
          </div>
        )}
        <div className="flex flex-col items-center gap-1 px-6 py-4 rounded-2xl bg-muted border border-border min-w-[100px]">
          <span className="text-3xl font-extrabold text-muted-foreground">{discarded.length + published.length}</span>
          <span className="text-xs font-semibold text-muted-foreground">Discarded / Published</span>
        </div>
      </div>

      {approved.length > 0 ? (
        <Button
          size="lg"
          className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white gap-2 px-8 shadow-lg shadow-violet-500/20"
          onClick={onPublish}
          disabled={isPublishing}
        >
          <Sparkles className="w-5 h-5" />
          Publish {approved.length} Article{approved.length !== 1 ? "s" : ""} to Knowledge Base
        </Button>
      ) : inReview.length > 0 ? (
        <p className="text-sm text-muted-foreground">Go back and approve documents to publish them.</p>
      ) : (
        <p className="text-sm text-muted-foreground">All documents have been handled. Nothing left to publish.</p>
      )}
    </div>
  );
}

// ── Document Review Theater ──────────────────────────────────────────────────

function DocumentReviewTheater() {
  const { toast } = useToast();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showCompletion, setShowCompletion] = useState(false);
  const [celebrationMode, setCelebrationMode] = useState(false);
  const [publishedCount, setPublishedCount] = useState(0);
  const [refineBarFocused, setRefineBarFocused] = useState(false);
  // Optimistic local status overrides to avoid stale-closure issues in callbacks
  const [localStatuses, setLocalStatuses] = useState<Record<string, string>>({});
  const mainPanelRef = useRef<HTMLDivElement>(null);

  const { data: allItemsResponse, isLoading } = useQuery<{ success: boolean; data: AiGeneratedItem[] }>({
    queryKey: ["/api/ai-studio/items"],
  });

  const { data: docsResponse } = useQuery<{ success: boolean; data: KnowledgeDocument[] }>({
    queryKey: ["/api/sop/documents"],
  });
  const allDocuments = docsResponse?.data ?? [];

  const allItems = allItemsResponse?.data ?? [];
  const reviewableItems = allItems.filter((i) => i.type === "sop" || i.type === "training" || i.type === "task" || i.type === "knowledge_base");

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: AiItemUpdatePayload }) =>
      apiRequest("PATCH", `/api/ai-studio/items/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ai-studio/items"] });
    },
    onError: () => {
      toast({ title: "Update failed", variant: "destructive" });
    },
  });

  const publishMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/ai-studio/items/${id}/publish`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ai-studio/items"] });
    },
  });

  const publishBatchMutation = useMutation({
    mutationFn: (itemIds: string[]) =>
      apiRequest("POST", "/api/ai-studio/items/publish-batch", { itemIds }),
    onSuccess: async (res: any) => {
      qc.invalidateQueries({ queryKey: ["/api/ai-studio/items"] });
      qc.invalidateQueries({ queryKey: ["/api/sop/documents"] });
      qc.invalidateQueries({ queryKey: ["/api/knowledge-base"] });
      const data = await res.json();
      const count = data?.published ?? 0;
      setPublishedCount(count);
      // Clear local status overrides so the UI reflects fresh server data
      // (items will now show as "published" instead of "approved")
      setLocalStatuses({});
      setCelebrationMode(true);
    },
    onError: () => {
      toast({ title: "Batch publish failed", variant: "destructive" });
    },
  });

  // Merge server statuses with optimistic local overrides
  const effectiveItems = reviewableItems.map((item) =>
    localStatuses[item.id] ? { ...item, status: localStatuses[item.id] as AiGeneratedItem["status"] } : item
  );

  const selectedItem = effectiveItems[selectedIndex] ?? effectiveItems[0];

  const handleUpdate = (id: string, data: AiItemUpdatePayload) => {
    if (data.status) setLocalStatuses((prev) => ({ ...prev, [id]: data.status as string }));
    updateMutation.mutate({ id, data });
  };

  const advanceAfterAction = (currentIdx: number, newStatusForCurrentItem: string) => {
    // Build the effective status map with the just-applied action already included
    const merged: Record<string, string> = { ...localStatuses };
    if (effectiveItems[currentIdx]) {
      merged[effectiveItems[currentIdx].id] = newStatusForCurrentItem;
    }
    const mergedItems = reviewableItems.map((item) =>
      merged[item.id] ? { ...item, status: merged[item.id] as AiGeneratedItem["status"] } : item
    );

    // Look forward first
    let next = mergedItems.findIndex(
      (item, i) => i > currentIdx && item.status === "in_review"
    );
    // Then wrap to look from the start
    if (next === -1) {
      next = mergedItems.findIndex((item) => item.status === "in_review");
    }
    if (next !== -1) {
      setSelectedIndex(next);
    } else {
      const allHandled = mergedItems.every((i) => i.status !== "in_review");
      if (allHandled) {
        setShowCompletion(true);
      }
    }
  };

  const handleApprove = (item: AiGeneratedItem) => {
    const idx = effectiveItems.indexOf(item);
    setLocalStatuses((prev) => ({ ...prev, [item.id]: "approved" }));
    updateMutation.mutate({ id: item.id, data: { status: "approved" } });
    toast({ title: "Approved!" });
    advanceAfterAction(idx, "approved");
  };

  const handleDiscard = (item: AiGeneratedItem) => {
    const idx = effectiveItems.indexOf(item);
    setLocalStatuses((prev) => ({ ...prev, [item.id]: "discarded" }));
    updateMutation.mutate({ id: item.id, data: { status: "discarded" } });
    advanceAfterAction(idx, "discarded");
  };

  // Smart navigation: prefer next/prev in_review item, fall back to sequential
  const goNext = () => {
    setSelectedIndex((i) => {
      const nextInReview = effectiveItems.findIndex(
        (item, idx) => idx > i && item.status === "in_review"
      );
      if (nextInReview !== -1) return nextInReview;
      return Math.min(i + 1, effectiveItems.length - 1);
    });
  };

  const goPrev = () => {
    setSelectedIndex((i) => {
      let prevInReview = -1;
      for (let idx = i - 1; idx >= 0; idx--) {
        if (effectiveItems[idx]?.status === "in_review") {
          prevInReview = idx;
          break;
        }
      }
      if (prevInReview !== -1) return prevInReview;
      return Math.max(i - 1, 0);
    });
  };

  // Keyboard shortcuts
  useEffect(() => {
    if (showCompletion) return;
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "a" || e.key === "A") {
        if (selectedItem && selectedItem.status === "in_review") {
          handleApprove(selectedItem);
        }
      } else if (e.key === "e" || e.key === "E") {
        if (selectedItem && selectedItem.status === "in_review") {
          setRefineBarFocused(true);
        }
      } else if (e.key === "d" || e.key === "D") {
        if (selectedItem && (selectedItem.status === "in_review" || selectedItem.status === "approved")) {
          handleDiscard(selectedItem);
        }
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedItem, effectiveItems, showCompletion]);

  // Scroll main panel to top on doc change
  useEffect(() => {
    mainPanelRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [selectedIndex]);

  if (isLoading) {
    return (
      <div className="flex gap-4 h-[600px]">
        <div className="w-64 space-y-2">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
        <Skeleton className="flex-1 rounded-xl" />
      </div>
    );
  }

  if (reviewableItems.length === 0) {
    return (
      <div className="text-center py-16 border border-dashed rounded-2xl">
        <AraAvatar size="lg" />
        <p className="font-bold text-lg mt-5 text-foreground">No content generated yet</p>
        <p className="text-sm text-muted-foreground/60 mt-2 max-w-xs mx-auto">
          Upload documents above and click "Generate Knowledge Base with Ara" to create content for review here.
        </p>
      </div>
    );
  }

  const getStatusDot = (status: string) => {
    if (status === "approved") return "bg-green-500";
    if (status === "discarded") return "bg-muted-foreground/30";
    if (status === "published") return "bg-blue-500";
    return "bg-amber-400";
  };

  const isApprovedOrPublished = selectedItem?.status === "approved" || selectedItem?.status === "published";
  const isDiscarded = selectedItem?.status === "discarded";
  const editable = selectedItem && !isApprovedOrPublished && !isDiscarded;

  const approvedCount = effectiveItems.filter((i) => i.status === "approved").length;
  const inReviewCount = effectiveItems.filter((i) => i.status === "in_review").length;

  if (showCompletion) {
    return (
      <div className="border border-border rounded-2xl overflow-hidden" style={{ height: "calc(100vh - 220px)", minHeight: "560px" }}>
        <CompletionSummaryScreen
          items={effectiveItems}
          onPublish={() => {
            const approved = effectiveItems.filter((i) => i.status === "approved");
            publishBatchMutation.mutate(approved.map((i) => i.id));
          }}
          isPublishing={publishBatchMutation.isPending}
          publishedCount={publishedCount}
          celebrationMode={celebrationMode}
        />
      </div>
    );
  }

  // Build "Ara understood" summary from source documents and item metadata
  const sourceIds = (selectedItem?.sourceDocumentIds as string[] | null) ?? [];
  const sourceDocs = sourceIds
    .map((id) => allDocuments.find((d) => d.id === id))
    .filter(Boolean) as KnowledgeDocument[];
  const sourceNames = sourceDocs.map((d) => d.originalFileName).filter(Boolean);
  const hasBeenRefined = !!selectedItem?.feedbackNotes;
  const confidenceLabel = hasBeenRefined ? "Refined with your feedback" : "High confidence";
  const confidenceColor = hasBeenRefined
    ? "text-violet-600 dark:text-violet-400"
    : "text-emerald-600 dark:text-emerald-400";
  const sourceSummary =
    sourceNames.length === 0
      ? "Generated from your library"
      : sourceNames.length === 1
        ? `Understood from ${sourceNames[0]}`
        : `Understood from ${sourceNames[0]} +${sourceNames.length - 1} more`;

  return (
    <div className="border border-border rounded-2xl overflow-hidden flex flex-col bg-background" style={{ height: "calc(100vh - 220px)", minHeight: "560px" }}>
      {/* Theater top bar */}
      <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-b border-border bg-muted/30 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <AraAvatar size="xs" />
          <span className="text-sm font-semibold text-foreground shrink-0">
            Review {selectedIndex + 1} of {effectiveItems.length}
          </span>
          {selectedItem?.status === "in_review" && (
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium shrink-0">Awaiting review</span>
          )}
          {selectedItem?.status === "approved" && (
            <span className="text-xs text-green-600 dark:text-green-400 font-medium shrink-0">✓ Approved</span>
          )}
          {selectedItem?.status === "discarded" && (
            <span className="text-xs text-muted-foreground font-medium shrink-0">Discarded</span>
          )}

          {/* Ara confidence + source summary */}
          {selectedItem && (
            <div className="hidden lg:flex items-center gap-2 ml-2 pl-3 border-l border-border min-w-0">
              <Sparkles className={`w-3.5 h-3.5 shrink-0 ${confidenceColor}`} />
              <div className="flex flex-col leading-tight min-w-0">
                <span className={`text-[11px] font-semibold ${confidenceColor}`}>
                  Ara · {confidenceLabel}
                </span>
                <span className="text-[10px] text-muted-foreground truncate" title={sourceNames.join(", ") || undefined}>
                  {sourceSummary}
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {inReviewCount === 0 && reviewableItems.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5 border-violet-300 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/30"
              onClick={() => setShowCompletion(true)}
            >
              <Sparkles className="w-3 h-3" />
              Publish Summary
            </Button>
          )}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/60 px-2.5 py-1 rounded-full border border-border">
            <Keyboard className="w-3 h-3" />
            <span>A approve · E refine · D discard · ←→ navigate</span>
          </div>
        </div>
      </div>

      {/* Theater body */}
      <div className="flex flex-1 min-h-0">
        {/* Left rail */}
        <div className="w-60 shrink-0 border-r border-border bg-muted/20 overflow-y-auto">
          <div className="p-2 space-y-1">
            {effectiveItems.map((item, i) => {
              const conf = TYPE_CONFIG[item.type] || TYPE_CONFIG.sop;
              const Icon = conf.icon;
              const isSelected = i === selectedIndex;
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedIndex(i)}
                  className={`w-full text-left flex items-start gap-2.5 p-2.5 rounded-lg transition-all ${
                    isSelected
                      ? "bg-primary/10 border border-primary/20"
                      : "hover:bg-muted/60 border border-transparent"
                  }`}
                >
                  <div className={`w-7 h-7 rounded-lg ${conf.accent} flex items-center justify-center shrink-0 mt-0.5`}>
                    <Icon className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold truncate leading-tight ${isSelected ? "text-primary" : "text-foreground"}`}>
                      {item.title}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{conf.label}</p>
                  </div>
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${getStatusDot(item.status)}`} />
                </button>
              );
            })}
          </div>

          {/* Rail footer stats */}
          <div className="p-3 border-t border-border mt-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Approved</span>
              <span className="font-semibold text-green-600">{approvedCount}/{effectiveItems.length}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-green-500 transition-all duration-500"
                style={{ width: `${effectiveItems.length > 0 ? (approvedCount / effectiveItems.length) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>

        {/* Main document panel */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {selectedItem ? (
            <>
              <div ref={mainPanelRef} className="flex-1 overflow-y-auto px-8 py-6">
                <div className={`transition-all duration-200 ${isDiscarded ? "opacity-40" : ""}`}>
                  <DocumentFullPage item={selectedItem} onUpdate={handleUpdate} />
                </div>
              </div>

              {/* Floating Ara refine bar */}
              <FloatingRefineBar
                itemId={selectedItem.id}
                editable={!isApprovedOrPublished && !isDiscarded}
                focusTrigger={refineBarFocused}
                onFocused={() => setRefineBarFocused(false)}
              />

              {/* Action bar */}
              <div className="border-t border-border bg-background/95 backdrop-blur-sm px-5 py-3 flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-8"
                    onClick={goPrev}
                    disabled={selectedIndex === 0}
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-8"
                    onClick={goNext}
                    disabled={selectedIndex === effectiveItems.length - 1}
                  >
                    Next
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  {selectedItem.status === "in_review" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 h-8 border-destructive/30 text-destructive hover:bg-destructive/5"
                        onClick={() => handleDiscard(selectedItem)}
                        disabled={updateMutation.isPending}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Discard <span className="text-[10px] opacity-50 ml-0.5">D</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 h-8 border-violet-300 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/30"
                        onClick={() => setRefineBarFocused(true)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Edit & Refine <span className="text-[10px] opacity-50 ml-0.5">E</span>
                      </Button>
                      <Button
                        size="sm"
                        className="gap-1.5 h-8 bg-green-600 hover:bg-green-700 text-white"
                        onClick={() => handleApprove(selectedItem)}
                        disabled={updateMutation.isPending}
                      >
                        <Check className="w-3.5 h-3.5" />
                        Approve <span className="text-[10px] opacity-70 ml-0.5">A</span>
                      </Button>
                    </>
                  )}
                  {selectedItem.status === "approved" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 h-8 border-violet-300 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/30"
                        onClick={() => {
                          handleUpdate(selectedItem.id, { status: "in_review" });
                          setRefineBarFocused(true);
                        }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Edit & Refine
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 h-8 border-destructive/30 text-destructive hover:bg-destructive/5"
                        onClick={() => handleDiscard(selectedItem)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Discard
                      </Button>
                      <Badge className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 gap-1.5">
                        <Check className="w-3 h-3" />
                        Approved
                      </Badge>
                    </>
                  )}
                  {selectedItem.status === "discarded" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 h-8"
                      onClick={() => handleUpdate(selectedItem.id, { status: "in_review" })}
                    >
                      Restore
                    </Button>
                  )}
                  {selectedItem.status === "published" && (
                    <Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 gap-1.5">
                      <CheckCircle className="w-3 h-3" />
                      Published
                    </Badge>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Select a document from the left
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Question Bank Tab ────────────────────────────────────────────────────────

function QuestionBankTab() {
  const [topicFilter, setTopicFilter] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState("");

  const { data: qbResponse, isLoading } = useQuery<{ success: boolean; data: { questions: QuizQuestion[]; topics: string[] } }>({
    queryKey: ["/api/quiz/question-bank", topicFilter, difficultyFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (topicFilter) params.set("topic", topicFilter);
      if (difficultyFilter) params.set("difficulty", difficultyFilter);
      const url = `/api/quiz/question-bank${params.toString() ? `?${params}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      return res.json();
    },
  });

  const questions = qbResponse?.data?.questions ?? [];
  const topics = qbResponse?.data?.topics ?? [];

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
      </div>
    );
  }

  if (questions.length === 0 && !topicFilter && !difficultyFilter) {
    return (
      <div className="text-center py-12 border border-dashed rounded-xl">
        <GraduationCap className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="font-medium text-muted-foreground">No quiz questions yet</p>
        <p className="text-sm text-muted-foreground/60 mt-1">
          Questions are automatically generated when you run the content generator on your uploaded documents.
        </p>
      </div>
    );
  }

  const DIFF_COLORS: Record<string, string> = {
    easy: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    medium: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    hard: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    scenario: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <select
          className="border rounded-md px-2 py-1 text-sm bg-background"
          value={topicFilter}
          onChange={(e) => setTopicFilter(e.target.value)}
        >
          <option value="">All Topics</option>
          {topics.map(t => (
            <option key={t} value={t}>{t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
          ))}
        </select>
        <select
          className="border rounded-md px-2 py-1 text-sm bg-background"
          value={difficultyFilter}
          onChange={(e) => setDifficultyFilter(e.target.value)}
        >
          <option value="">All Difficulties</option>
          {["easy", "medium", "hard", "scenario"].map(d => (
            <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground self-center">{questions.length} question{questions.length !== 1 ? "s" : ""}</span>
      </div>

      <div className="space-y-3">
        {questions.map((q) => {
          const wrongRate = (q.totalAnswerCount ?? 0) > 0
            ? Math.round(((q.wrongAnswerCount ?? 0) / (q.totalAnswerCount ?? 1)) * 100)
            : null;
          return (
            <Card key={q.id} className="border border-border">
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium flex-1">{q.questionText}</p>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Badge className={DIFF_COLORS[q.difficulty] ?? ""}>{q.difficulty}</Badge>
                    {wrongRate !== null && (
                      <Badge variant="outline" className={wrongRate > 60 ? "border-red-300 text-red-600" : wrongRate > 30 ? "border-yellow-300 text-yellow-600" : "border-green-300 text-green-600"}>
                        {wrongRate}% wrong
                      </Badge>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {q.topicTag.replace(/_/g, ' ')}
                  {q.totalAnswerCount ? ` · ${q.totalAnswerCount} answers` : ''}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {(q.answerChoices as string[]).map((choice, i) => (
                    <div
                      key={i}
                      className={`text-xs px-2.5 py-1.5 rounded-md ${i === q.correctAnswerIndex ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 font-medium" : "bg-muted text-muted-foreground"}`}
                    >
                      {String.fromCharCode(65 + i)}. {choice}
                    </div>
                  ))}
                </div>
                {q.coachingText && (
                  <p className="text-xs text-muted-foreground mt-2 italic">{q.coachingText}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ── Learning Analytics Tab ───────────────────────────────────────────────────

interface AnalyticsData {
  participation: Array<{ id: string; first_name: string; last_name: string; quizzes_done: number; streak: number; season_points: number; accuracy: number }>;
  topicStats: Array<{ topic_tag: string; total_questions: number; total_answers: number; total_wrong: number; wrong_rate: number }>;
  coverageGaps: string[];
  highMissQuestions: Array<{ id: string; question_text: string; topic_tag: string; difficulty: string; total_answer_count: number; wrong_answer_count: number; wrong_rate: number }>;
}

function LearningAnalyticsTab() {
  const { data: analyticsResponse, isLoading } = useQuery<{ success: boolean; data: AnalyticsData }>({
    queryKey: ["/api/quiz/analytics"],
  });

  const analytics = analyticsResponse?.data;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
      </div>
    );
  }

  if (!analytics) {
    return <p className="text-muted-foreground text-sm">No analytics data available yet.</p>;
  }

  return (
    <div className="space-y-6">
      {analytics.coverageGaps.length > 0 && (
        <Card className="border-orange-200 dark:border-orange-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-orange-700 dark:text-orange-300">
              <AlertCircle className="w-4 h-4" />
              Coverage Gaps — Last 30 Days
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {analytics.coverageGaps.map(t => (
                <Badge key={t} variant="outline" className="border-orange-300 text-orange-700">
                  {t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">These topics haven't been covered in any quiz session in the last 30 days.</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Topic Difficulty Heatmap</CardTitle>
          <p className="text-xs text-muted-foreground">Wrong answer rate per topic — red = needs attention, green = strong</p>
        </CardHeader>
        <CardContent>
          {analytics.topicStats.length === 0 ? (
            <p className="text-sm text-muted-foreground">No quiz data yet. Generate content and have team members complete daily quizzes.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {analytics.topicStats.slice(0, 12).map(t => {
                const rate = Number(t.wrong_rate);
                const hue = rate > 60 ? 0 : rate > 40 ? 25 : rate > 20 ? 50 : 142;
                const saturation = rate > 10 ? 70 : 30;
                const answers = Number(t.total_answers);
                return (
                  <div
                    key={t.topic_tag}
                    className="rounded-xl p-3 flex flex-col gap-1"
                    style={{
                      background: `hsl(${hue} ${saturation}% 50% / ${Math.max(0.08, rate / 100 * 0.35)})`,
                      border: `1px solid hsl(${hue} ${saturation}% 50% / 0.25)`,
                    }}
                    title={`${answers} answers`}
                  >
                    <p className="text-xs font-semibold text-foreground leading-tight truncate">
                      {String(t.topic_tag).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </p>
                    <p
                      className="text-base font-extrabold"
                      style={{ color: `hsl(${hue} ${saturation}% ${rate > 40 ? 40 : 35}%)` }}
                    >
                      {rate}%
                    </p>
                    <p className="text-xs text-muted-foreground">{answers} answers</p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {(analytics.highMissQuestions?.length ?? 0) > 0 && (
        <Card className="border-red-200 dark:border-red-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-red-700 dark:text-red-300">
              <AlertCircle className="w-4 h-4" />
              Most Missed Questions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {analytics.highMissQuestions.map((q, i) => {
                const rate = Number(q.wrong_rate);
                return (
                  <div key={q.id} className="flex gap-3">
                    <span className="w-5 flex-shrink-0 text-xs font-bold text-muted-foreground pt-0.5">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground line-clamp-2">{String(q.question_text)}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs px-1 py-0">{String(q.topic_tag).replace(/_/g, ' ')}</Badge>
                        <span className="text-xs font-bold text-red-600">{rate}% wrong</span>
                        <span className="text-xs text-muted-foreground">({Number(q.total_answer_count)} answers)</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-3">Questions with at least 5 answers, ranked by wrong answer rate.</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Team Participation — Season Standings</CardTitle>
        </CardHeader>
        <CardContent>
          {analytics.participation.length === 0 ? (
            <p className="text-sm text-muted-foreground">No participation data yet.</p>
          ) : (
            <div className="space-y-2">
              {analytics.participation.slice(0, 15).map((p, i) => (
                <div key={p.id} className="flex items-center gap-3 py-1.5">
                  <span className="w-5 text-xs font-bold text-muted-foreground">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.first_name} {p.last_name}</p>
                    <p className="text-xs text-muted-foreground">{Number(p.quizzes_done)} quizzes · {Number(p.accuracy)}% accuracy</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {Number(p.streak) > 0 && (
                      <span className="text-xs text-orange-500 font-bold">🔥{p.streak}</span>
                    )}
                    <Badge variant="outline" className="text-xs">{Number(p.season_points)} pts</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

function derivePipelineStage(
  docs: KnowledgeDocument[],
  items: AiGeneratedItem[],
  showWizard: boolean,
): PipelineStage {
  if (showWizard) return "generate";
  if (items.length > 0) return "review";
  if (docs.length > 0) return "generate";
  return "upload";
}

export default function AIContentStudio() {
  const { user } = useAuth();
  const [showWizard, setShowWizard] = useState(false);
  const [wizardPreselectedType, setWizardPreselectedType] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState("review");

  const { data: docsResponse } = useQuery<{ success: boolean; data: KnowledgeDocument[] }>({
    queryKey: ["/api/ai-studio/documents"],
  });
  const { data: itemsResponse } = useQuery<{ success: boolean; data: AiGeneratedItem[] }>({
    queryKey: ["/api/ai-studio/items"],
  });

  const docs = docsResponse?.data ?? [];
  const items = itemsResponse?.data ?? [];
  const pipelineStage = derivePipelineStage(docs, items, showWizard);

  const roleName = user?.role?.name;
  const isManagerOrOwner = roleName === "owner" || roleName === "admin" || roleName === "manager";

  if (!isManagerOrOwner) {
    return (
      <div className="max-w-xl mx-auto mt-20 text-center p-8">
        <AraAvatar size="lg" />
        <h2 className="text-lg font-semibold mt-4">AI Content Studio</h2>
        <p className="text-muted-foreground mt-2">
          This feature is available to managers and admins only.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <AraAvatar size="sm" />
            <h1 className="text-xl font-bold text-foreground">AI Content Studio</h1>
            <Badge className="bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200 text-xs">
              Manager Only
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Upload documents and let Ara generate SOPs, training modules, task lists, and knowledge base articles.
          </p>
        </div>
        <Button
          onClick={() => setShowWizard(true)}
          className="gap-1.5 shrink-0 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
        >
          <Sparkles className="w-4 h-4" />
          Generate with Ara
        </Button>
      </div>

      {/* Pipeline progress bar */}
      <PipelineProgressBar stage={pipelineStage} />

      {/* Quick Action */}
      <QuickActionPanel />

      {/* Source Library */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="w-4 h-4" />
            Source Library
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SourceLibrary onStartGenerate={(type) => { setWizardPreselectedType(type); setShowWizard(true); }} />
        </CardContent>
      </Card>

      {/* Review Theater + other tabs */}
      <div>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4 flex-wrap h-auto gap-1">
            <TabsTrigger value="review" className="gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              Review & Publish
              {items.filter(i => i.status === "in_review").length > 0 && (
                <span className="ml-1 w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {items.filter(i => i.status === "in_review").length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="question_bank">Question Bank</TabsTrigger>
            <TabsTrigger value="analytics">Learning Analytics</TabsTrigger>
          </TabsList>
          <TabsContent value="review">
            <DocumentReviewTheater />
          </TabsContent>
          <TabsContent value="question_bank">
            <QuestionBankTab />
          </TabsContent>
          <TabsContent value="analytics">
            <LearningAnalyticsTab />
          </TabsContent>
        </Tabs>
      </div>

      {/* Generation wizard dialog */}
      <Dialog open={showWizard} onOpenChange={(open) => { setShowWizard(open); if (!open) setWizardPreselectedType(undefined); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AraAvatar size="sm" />
              Generate Content with Ara
            </DialogTitle>
          </DialogHeader>
          <GenerationWizard
            preselectedOutputType={wizardPreselectedType}
            onComplete={() => {
              setShowWizard(false);
              setWizardPreselectedType(undefined);
              setActiveTab("review");
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
