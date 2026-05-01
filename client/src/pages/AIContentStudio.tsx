import type { ComponentType, SVGProps } from "react";
import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
import {
  Wand2,
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
  Edit3,
  Check,
  ThumbsUp,
  BookOpen,
  ClipboardList,
  GraduationCap,
  Library,
  Plus,
  RefreshCw,
  Send,
  Eye,
  EyeOff,
  Pencil,
  Paperclip,
  Zap,
  ListChecks,
} from "lucide-react";
import type { KnowledgeDocument, AiGeneratedItem, QuizQuestion } from "@shared/schema";

const STATUS_CONFIG = {
  pending: { icon: Clock, label: "Pending", class: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  processing: { icon: Loader2, label: "Processing", class: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
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

const TYPE_CONFIG: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  sop: { label: "SOP", icon: ClipboardList, color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  training: { label: "Training", icon: GraduationCap, color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
  task: { label: "Task List", icon: CheckCircle, color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  knowledge_base: { label: "Knowledge Base", icon: Library, color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
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
type AiItemContent = SopContent | TrainingContent | TaskContent | KbContent;

type QuickActionResult =
  | { action: "create_tasks"; summary: string; count: number; tasks: { id: string; title: string; dayOfWeek?: string; timeOfDay?: string }[] }
  | { action: "answer"; text: string }
  | null;

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
        {/* File attachment row */}
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

        {/* Prompt + send */}
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

        {/* Results */}
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

function SourceLibrary() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);

  const { data: docsResponse, isLoading } = useQuery<{ success: boolean; data: KnowledgeDocument[] }>({
    queryKey: ["/api/ai-studio/documents"],
    refetchInterval: (query) => {
      const docs = query.state.data?.data ?? [];
      const hasPending = docs.some((d) => d.processingStatus === "pending" || d.processingStatus === "processing");
      return hasPending ? 3000 : false;
    },
  });

  const docs = docsResponse?.data ?? [];

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
      qc.invalidateQueries({ queryKey: ["/api/ai-studio/documents"] });
      setUploadingFiles((prev) => prev.map((f) => f.id === id ? { ...f, progress: "done" } : f));
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

  return (
    <div className="space-y-4">
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${isDragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
        <p className="font-medium mb-1">Drop files here or click to upload</p>
        <p className="text-sm text-muted-foreground mb-3">PDF, DOCX, TXT, JPG, PNG — up to 50MB</p>
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

      {uploadingFiles.length > 0 && (
        <div className="space-y-2">
          {uploadingFiles.map((f) => (
            <div key={f.id} className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg text-sm">
              {f.progress === "uploading" && <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />}
              {f.progress === "done" && <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />}
              {f.progress === "error" && <AlertCircle className="w-4 h-4 text-destructive shrink-0" />}
              <span className="truncate flex-1">{f.name}</span>
              {f.progress === "uploading" && <span className="text-xs text-muted-foreground">Uploading...</span>}
              {f.progress === "error" && <span className="text-xs text-destructive">{f.error}</span>}
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : docs.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No documents uploaded yet. Upload your first document above to get started.
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => {
            const status = STATUS_CONFIG[doc.processingStatus as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;
            const StatusIcon = status.icon;
            return (
              <div key={doc.id} className="flex items-start gap-3 p-3 border border-border rounded-xl">
                <FileText className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">{doc.originalFileName}</span>
                    <Badge className={`text-xs flex items-center gap-1 ${status.class}`}>
                      <StatusIcon className={`w-3 h-3 ${doc.processingStatus === "processing" ? "animate-spin" : ""}`} />
                      {status.label}
                    </Badge>
                  </div>
                  {doc.summaryFromClaude && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{doc.summaryFromClaude}</p>
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
    </div>
  );
}

function GenerationWizard({ onComplete }: { onComplete: () => void }) {
  const { toast } = useToast();
  const [step, setStep] = useState(() => {
    try { return parseInt(localStorage.getItem("aiStudio.step") || "0", 10) || 0; } catch { return 0; }
  });
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [selectedOutputTypes, setSelectedOutputTypes] = useState<string[]>(["sops"]);
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
        <p className="text-sm text-muted-foreground">
          Select the documents Claude will analyze to generate content.
          Only <strong>Ready</strong> documents are available.
        </p>

        {resumableJob && (
          <div className="flex items-start gap-3 p-3 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Previous generation was interrupted</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                {resumableJob.itemsGenerated} items saved — {resumableJob.totalDocuments - resumableJob.itemsGenerated < 1 ? "a few" : ""} documents still need processing.
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
            No ready documents available. Upload and wait for processing to complete.
          </div>
        ) : (
          <div className="space-y-2">
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
        {/* Let AI Decide */}
        <button
          onClick={() => handleGenerate(true)}
          disabled={generateMutation.isPending}
          className="w-full flex items-start gap-4 p-4 rounded-xl border-2 border-primary bg-primary/5 hover:bg-primary/10 transition-colors text-left group"
        >
          <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-primary/25 transition-colors">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-sm text-primary">Let AI Decide</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Claude reads each document and automatically picks the best format — SOPs for scripts and processes, Training for skills content, Tasks for operational checklists, Knowledge Base for reference material.
            </p>
          </div>
          {generateMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0 ml-auto mt-1" />
          ) : (
            <ChevronRight className="w-4 h-4 text-primary shrink-0 ml-auto mt-1 opacity-60 group-hover:opacity-100 transition-opacity" />
          )}
        </button>

        <div className="relative flex items-center">
          <div className="flex-1 border-t border-border" />
          <span className="px-3 text-xs text-muted-foreground">or choose manually</span>
          <div className="flex-1 border-t border-border" />
        </div>

        <div>
          <p className="text-sm font-medium mb-3">What would you like Claude to generate?</p>
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
          >
            {generateMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Starting...</>
            ) : (
              <><Wand2 className="w-4 h-4 mr-2" />Generate Content</>
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-5 h-5 text-primary" />
        <span className="font-medium">Claude is generating your content...</span>
      </div>

      <div className="bg-muted/50 rounded-xl p-4 font-mono text-xs space-y-1 max-h-64 overflow-y-auto">
        {progressLog.map((line, i) => (
          <div key={i} className="flex items-start gap-2">
            {i === progressLog.length - 1 && jobStatus?.status === "running" ? (
              <Loader2 className="w-3 h-3 animate-spin text-primary shrink-0 mt-0.5" />
            ) : (
              <Check className="w-3 h-3 text-green-500 shrink-0 mt-0.5" />
            )}
            <span>{line}</span>
          </div>
        ))}
        {progressLog.length === 0 && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Initializing...</span>
          </div>
        )}
        <div ref={logEndRef} />
      </div>

      {jobStatus?.status === "complete" && (
        <div className="flex items-center gap-2 text-green-600 dark:text-green-400 font-medium text-sm">
          <CheckCircle className="w-5 h-5" />
          Generation complete! Redirecting to review...
        </div>
      )}

      {jobStatus?.status === "failed" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-destructive font-medium text-sm">
            <AlertCircle className="w-5 h-5" />
            Generation was interrupted (the server restarted mid-job).
            {(jobStatus.itemsGenerated ?? 0) > 0 && (
              <span className="text-muted-foreground font-normal ml-1">
                {jobStatus.itemsGenerated} item{jobStatus.itemsGenerated !== 1 ? "s" : ""} already saved — click Continue to process the remaining documents.
              </span>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {(jobStatus.itemsGenerated ?? 0) > 0 && jobId && (
              <Button
                size="sm"
                className="gap-2 bg-[#F47D31] hover:bg-[#E06A20] text-white"
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

function SectionRefineBox({
  sectionKey,
  label,
  itemId,
  editable,
}: {
  sectionKey: string;
  label: string;
  itemId: string;
  editable: boolean;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");

  const refineMutation = useMutation({
    mutationFn: (data: RefinePayload) => apiRequest("POST", `/api/ai-studio/items/${itemId}/refine`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ai-studio/items"] });
      setFeedback("");
      setOpen(false);
      toast({ title: `"${label}" section refined by Claude` });
    },
    onError: () => {
      toast({ title: "Refinement failed", variant: "destructive" });
    },
  });

  if (!editable) return null;

  return (
    <div className="mt-2">
      {!open ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-xs gap-1 text-muted-foreground hover:text-primary px-1"
          onClick={() => setOpen(true)}
        >
          <RefreshCw className="w-3 h-3" />
          Refine this section
        </Button>
      ) : (
        <div className="mt-2 space-y-2 border border-dashed border-primary/40 rounded-lg p-3 bg-primary/5">
          <p className="text-xs font-medium text-primary">Refine "{label}" with Claude</p>
          <Textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={`Describe how to improve the "${label}" section...`}
            className="min-h-[60px] text-xs"
            rows={2}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => refineMutation.mutate({ feedback, sectionKey })}
              disabled={!feedback.trim() || refineMutation.isPending}
            >
              {refineMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Refine
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setOpen(false); setFeedback(""); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

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

function ItemCard({
  item,
  onUpdate,
  onPublish,
  onDiscard,
}: {
  item: AiGeneratedItem;
  onUpdate: (id: string, data: AiItemUpdatePayload) => void;
  onPublish: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [globalFeedback, setGlobalFeedback] = useState("");

  const typeConf = TYPE_CONFIG[item.type] || TYPE_CONFIG.sop;
  const TypeIcon = typeConf.icon;
  const contentRaw = item.content as Record<string, unknown>;
  const sopContent = contentRaw as SopContent;
  const trainingContent = contentRaw as TrainingContent;
  const taskContent = contentRaw as TaskContent;
  const kbContent = contentRaw as KbContent;

  const isPublished = item.status === "published";
  const isApproved = item.status === "approved";
  const isDiscarded = item.status === "discarded";
  const editable = !isPublished && !isDiscarded;

  const globalRefineMutation = useMutation({
    mutationFn: (data: RefinePayload) => apiRequest("POST", `/api/ai-studio/items/${item.id}/refine`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ai-studio/items"] });
      setGlobalFeedback("");
      toast({ title: "Content refined by Claude" });
    },
    onError: () => {
      toast({ title: "Refinement failed", variant: "destructive" });
    },
  });

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

  const renderContent = () => {
    if (item.type === "sop") {
      return (
        <div className="space-y-4">
          {sopContent.role && (
            <p className="text-sm text-muted-foreground"><strong>Role:</strong> {sopContent.role}</p>
          )}
          {sopContent.summary !== undefined && (
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-1 uppercase tracking-wide">Summary</p>
              <InlineTextField value={sopContent.summary || ""} onSave={(v) => handleFieldSave("summary", v)} editable={editable} multiline className="text-sm" />
              <SectionRefineBox sectionKey="summary" label="Summary" itemId={item.id} editable={editable} />
            </div>
          )}
          {Array.isArray(sopContent.steps) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Steps</p>
                <SectionRefineBox sectionKey="steps" label="Steps" itemId={item.id} editable={editable} />
              </div>
              {sopContent.steps.map((step, i) => (
                <div key={i} className="flex gap-3 text-sm border border-border rounded-lg p-3">
                  <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center shrink-0 font-bold mt-0.5">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <InlineTextField value={step.title || ""} onSave={(v) => handleStepFieldSave(i, "title", v)} editable={editable} className="font-medium block" />
                    <InlineTextField value={step.description || ""} onSave={(v) => handleStepFieldSave(i, "description", v)} editable={editable} multiline className="text-muted-foreground text-xs mt-0.5 block" />
                    {step.decisionOptions && step.decisionOptions.length > 0 && (
                      <div className="mt-1 space-y-1">
                        {step.decisionOptions.map((opt, j) => (
                          <div key={j} className="text-xs bg-muted/50 rounded px-2 py-1">
                            <span className="font-medium">{opt.condition}</span> → {opt.action}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (item.type === "training") {
      return (
        <div className="space-y-4">
          {trainingContent.role && (
            <p className="text-sm text-muted-foreground"><strong>Role:</strong> {trainingContent.role}</p>
          )}
          {trainingContent.description !== undefined && (
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-1 uppercase tracking-wide">Description</p>
              <InlineTextField value={trainingContent.description || ""} onSave={(v) => handleFieldSave("description", v)} editable={editable} multiline className="text-sm" />
              <SectionRefineBox sectionKey="description" label="Description" itemId={item.id} editable={editable} />
            </div>
          )}
          {Array.isArray(trainingContent.objectives) && trainingContent.objectives.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium">Learning Objectives</p>
                <SectionRefineBox sectionKey="objectives" label="Objectives" itemId={item.id} editable={editable} />
              </div>
              <ul className="space-y-1">
                {trainingContent.objectives.map((obj, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
                    <InlineTextField value={obj} onSave={(v) => { const newObjs = [...(trainingContent.objectives ?? [])]; newObjs[i] = v; handleFieldSave("objectives", newObjs); }} editable={editable} className="flex-1" />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {trainingContent.markdownContent !== undefined && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium">Training Content</p>
                <SectionRefineBox sectionKey="markdownContent" label="Training Content" itemId={item.id} editable={editable} />
              </div>
              <InlineTextField value={trainingContent.markdownContent || ""} onSave={(v) => handleFieldSave("markdownContent", v)} editable={editable} multiline className="text-sm font-mono" />
            </div>
          )}
          {Array.isArray(trainingContent.exercises) && trainingContent.exercises.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium">Practice Exercises</p>
                <SectionRefineBox sectionKey="exercises" label="Exercises" itemId={item.id} editable={editable} />
              </div>
              {trainingContent.exercises.map((ex, i) => (
                <div key={i} className="bg-muted/50 rounded-lg p-3 text-sm space-y-1 mb-2">
                  <p className="font-medium">{ex.scenario}</p>
                  <p className="text-muted-foreground italic">{ex.question}</p>
                  <p className="text-xs text-green-700 dark:text-green-400">{ex.guidance}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (item.type === "task") {
      return (
        <div className="space-y-3">
          {taskContent.role && <p className="text-sm text-muted-foreground"><strong>Role:</strong> {taskContent.role}</p>}
          {taskContent.description !== undefined && (
            <div>
              <InlineTextField value={taskContent.description || ""} onSave={(v) => handleFieldSave("description", v)} editable={editable} multiline className="text-sm" />
              <SectionRefineBox sectionKey="description" label="Description" itemId={item.id} editable={editable} />
            </div>
          )}
          {taskContent.frequency && (
            <Badge variant="outline" className="text-xs capitalize">{taskContent.frequency}</Badge>
          )}
          {Array.isArray(taskContent.tasks) && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium">Task Items</p>
                <SectionRefineBox sectionKey="tasks" label="Task Items" itemId={item.id} editable={editable} />
              </div>
              <div className="space-y-1">
                {taskContent.tasks.map((task, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm py-1 border border-border rounded-lg px-3">
                    <div className="w-5 h-5 border border-border rounded mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <InlineTextField value={task.title || ""} onSave={(v) => handleTaskFieldSave(i, "title", v)} editable={editable} className="font-medium block" />
                      {task.description !== undefined && (
                        <InlineTextField value={task.description || ""} onSave={(v) => handleTaskFieldSave(i, "description", v)} editable={editable} multiline className="text-xs text-muted-foreground block" />
                      )}
                      {task.estimatedMinutes && (
                        <p className="text-xs text-muted-foreground">{task.estimatedMinutes} min</p>
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
    }

    if (item.type === "knowledge_base") {
      return (
        <div className="space-y-3">
          {kbContent.category && <Badge variant="outline" className="text-xs">{kbContent.category}</Badge>}
          {kbContent.summary !== undefined && (
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-1 uppercase tracking-wide">Summary</p>
              <InlineTextField value={kbContent.summary || ""} onSave={(v) => handleFieldSave("summary", v)} editable={editable} multiline className="text-sm" />
              <SectionRefineBox sectionKey="summary" label="Summary" itemId={item.id} editable={editable} />
            </div>
          )}
          {Array.isArray(kbContent.paragraphs) && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium">Article Sections</p>
                <SectionRefineBox sectionKey="paragraphs" label="Article Sections" itemId={item.id} editable={editable} />
              </div>
              <div className="space-y-3">
                {kbContent.paragraphs.map((para, i) => (
                  <div key={i} className="border border-border rounded-lg p-3">
                    {para.heading !== undefined && (
                      <InlineTextField value={para.heading || ""} onSave={(v) => handleParaFieldSave(i, "heading", v)} editable={editable} className="text-sm font-semibold block mb-1" />
                    )}
                    <InlineTextField value={para.body || ""} onSave={(v) => handleParaFieldSave(i, "body", v)} editable={editable} multiline className="text-sm text-muted-foreground block" />
                  </div>
                ))}
              </div>
            </div>
          )}
          {Array.isArray(kbContent.tags) && kbContent.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {kbContent.tags.map((tag) => (
                <span key={tag} className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">{tag}</span>
              ))}
            </div>
          )}
        </div>
      );
    }

    return <pre className="text-xs text-muted-foreground overflow-auto">{JSON.stringify(contentRaw, null, 2)}</pre>;
  };

  return (
    <Card className={`border ${isPublished ? "border-green-200 dark:border-green-800" : isDiscarded ? "opacity-50 border-border" : isApproved ? "border-primary" : "border-border"}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
            <TypeIcon className="w-4 h-4 text-muted-foreground shrink-0" />
            <InlineTextField value={item.title} onSave={handleTitleSave} editable={editable} className="font-semibold text-sm" />
            <Badge className={`text-xs ${typeConf.color}`}>{typeConf.label}</Badge>
            <Badge className="text-xs bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200">
              <Sparkles className="w-3 h-3 mr-1" />
              AI Generated
            </Badge>
            {isPublished && (
              <Badge className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                <CheckCircle className="w-3 h-3 mr-1" />
                Published
              </Badge>
            )}
            {isApproved && (
              <Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                <ThumbsUp className="w-3 h-3 mr-1" />
                Approved
              </Badge>
            )}
            {isDiscarded && (
              <Badge variant="secondary" className="text-xs">Discarded</Badge>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>

        {expanded && (
          <>
            <div className="border border-border rounded-xl p-4 mb-4">
              {renderContent()}
            </div>

            {editable && (
              <div className="space-y-2 mb-4 border border-dashed border-border rounded-lg p-3 bg-muted/20">
                <p className="text-xs font-medium text-muted-foreground">Refine entire document with Claude</p>
                <Textarea
                  value={globalFeedback}
                  onChange={(e) => setGlobalFeedback(e.target.value)}
                  placeholder="Describe overall changes... (e.g., 'Make the tone more friendly' or 'Add safety warnings to all steps')"
                  className="min-h-[60px] text-sm"
                  rows={2}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!globalFeedback.trim()) return;
                    globalRefineMutation.mutate({ feedback: globalFeedback });
                  }}
                  disabled={!globalFeedback.trim() || globalRefineMutation.isPending}
                  className="gap-1.5"
                >
                  {globalRefineMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  Refine Entire Document
                </Button>
              </div>
            )}

            {editable && (
              <div className="flex gap-2 flex-wrap pt-2 border-t border-border">
                {!isApproved ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 border-green-300 text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30"
                    onClick={() => onUpdate(item.id, { status: "approved" })}
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                    Approve
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => onPublish(item.id)}
                    className="gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Publish
                  </Button>
                )}
                {isApproved && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => onUpdate(item.id, { status: "in_review" })}
                  >
                    Return to Review
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => onDiscard(item.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Discard
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ItemsTab({ type }: { type: string }) {
  const { toast } = useToast();

  const { data: allItemsResponse, isLoading } = useQuery<{ success: boolean; data: AiGeneratedItem[] }>({
    queryKey: ["/api/ai-studio/items"],
  });

  const allItems = allItemsResponse?.data ?? [];
  const items = type === "all" ? allItems : allItems.filter((i) => i.type === type);
  const reviewItems = items.filter((i) => i.status === "in_review");
  const approvedItems = items.filter((i) => i.status === "approved");
  const publishedItems = items.filter((i) => i.status === "published");
  const discardedItems = items.filter((i) => i.status === "discarded");

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
      qc.invalidateQueries({ queryKey: ["/api/sop/documents"] });
      qc.invalidateQueries({ queryKey: ["/api/training/modules"] });
      toast({ title: "Item published successfully!" });
    },
    onError: () => {
      toast({ title: "Publish failed", variant: "destructive" });
    },
  });

  const publishBatchMutation = useMutation({
    mutationFn: (itemIds: string[]) =>
      apiRequest("POST", "/api/ai-studio/items/publish-batch", { itemIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ai-studio/items"] });
      qc.invalidateQueries({ queryKey: ["/api/sop/documents"] });
      toast({ title: "All approved items published!" });
    },
    onError: () => {
      toast({ title: "Batch publish failed", variant: "destructive" });
    },
  });

  const handleUpdate = (id: string, data: AiItemUpdatePayload) => {
    updateMutation.mutate({ id, data });
  };

  const handlePublish = (id: string) => {
    publishMutation.mutate(id);
  };

  const handleDiscard = (id: string) => {
    updateMutation.mutate({ id, data: { status: "discarded" } });
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed rounded-xl">
        <Sparkles className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="font-medium text-muted-foreground">No items generated yet</p>
        <p className="text-sm text-muted-foreground/60 mt-1">
          Use the "Generate" button above to create content from your uploaded documents.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {approvedItems.length > 0 && (
        <div className="flex justify-end">
          <Button
            onClick={() => publishBatchMutation.mutate(approvedItems.map((i) => i.id))}
            disabled={publishBatchMutation.isPending}
            className="gap-1.5"
          >
            {publishBatchMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            Publish All Approved ({approvedItems.length})
          </Button>
        </div>
      )}

      {reviewItems.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            In Review ({reviewItems.length})
          </h3>
          {reviewItems.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onUpdate={handleUpdate}
              onPublish={handlePublish}
              onDiscard={handleDiscard}
            />
          ))}
        </div>
      )}

      {approvedItems.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Approved ({approvedItems.length})
          </h3>
          {approvedItems.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onUpdate={handleUpdate}
              onPublish={handlePublish}
              onDiscard={handleDiscard}
            />
          ))}
        </div>
      )}

      {publishedItems.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Published ({publishedItems.length})
          </h3>
          {publishedItems.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onUpdate={handleUpdate}
              onPublish={handlePublish}
              onDiscard={handleDiscard}
            />
          ))}
        </div>
      )}

      {discardedItems.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Discarded ({discardedItems.length})
          </h3>
          {discardedItems.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onUpdate={handleUpdate}
              onPublish={handlePublish}
              onDiscard={handleDiscard}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Question Bank Tab ──────────────────────────────────────────────────────

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

// ── Learning Analytics Tab ─────────────────────────────────────────────────

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
      {/* Coverage Gaps */}
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

      {/* Topic Difficulty Heatmap */}
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

      {/* High-Miss Questions */}
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

      {/* Team Participation */}
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

export default function AIContentStudio() {
  const { user } = useAuth();
  const [showWizard, setShowWizard] = useState(false);
  const [activeTab, setActiveTab] = useState("sop");

  const roleName = user?.role?.name;
  const isManagerOrOwner = roleName === "owner" || roleName === "admin" || roleName === "manager";

  if (!isManagerOrOwner) {
    return (
      <div className="max-w-xl mx-auto mt-20 text-center p-8">
        <Sparkles className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
        <h2 className="text-lg font-semibold">AI Content Studio</h2>
        <p className="text-muted-foreground mt-2">
          This feature is available to managers and admins only.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold">AI Content Studio</h1>
            <Badge className="bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200 text-xs">
              Manager Only
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Upload documents and let Claude generate SOPs, training modules, task lists, and knowledge base articles.
          </p>
        </div>
        <Button onClick={() => setShowWizard(true)} className="gap-1.5 shrink-0">
          <Wand2 className="w-4 h-4" />
          Generate
        </Button>
      </div>

      <QuickActionPanel />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="w-4 h-4" />
            Source Library
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SourceLibrary />
        </CardContent>
      </Card>

      <div>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4 flex-wrap h-auto gap-1">
            <TabsTrigger value="sop">SOPs</TabsTrigger>
            <TabsTrigger value="training">Training</TabsTrigger>
            <TabsTrigger value="task">Tasks</TabsTrigger>
            <TabsTrigger value="knowledge_base">Knowledge Base</TabsTrigger>
            <TabsTrigger value="question_bank">Question Bank</TabsTrigger>
            <TabsTrigger value="analytics">Learning Analytics</TabsTrigger>
          </TabsList>
          <TabsContent value="sop">
            <ItemsTab type="sop" />
          </TabsContent>
          <TabsContent value="training">
            <ItemsTab type="training" />
          </TabsContent>
          <TabsContent value="task">
            <ItemsTab type="task" />
          </TabsContent>
          <TabsContent value="knowledge_base">
            <ItemsTab type="knowledge_base" />
          </TabsContent>
          <TabsContent value="question_bank">
            <QuestionBankTab />
          </TabsContent>
          <TabsContent value="analytics">
            <LearningAnalyticsTab />
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={showWizard} onOpenChange={setShowWizard}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="w-5 h-5 text-primary" />
              Generate Content with Claude
            </DialogTitle>
          </DialogHeader>
          <GenerationWizard
            onComplete={() => {
              setShowWizard(false);
              setActiveTab("sop");
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
