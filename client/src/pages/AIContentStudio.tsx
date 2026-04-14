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
} from "lucide-react";
import type { KnowledgeDocument, AiGeneratedItem } from "@shared/schema";

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
  const [step, setStep] = useState(0);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [selectedOutputTypes, setSelectedOutputTypes] = useState<string[]>(["sops"]);
  const [targetRoles, setTargetRoles] = useState(["New Associate", "Lead", "Manager"]);
  const [roleInput, setRoleInput] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  const { data: docsResponse } = useQuery<{ success: boolean; data: KnowledgeDocument[] }>({
    queryKey: ["/api/ai-studio/documents"],
  });
  const docs = (docsResponse?.data ?? []).filter((d) => d.processingStatus === "ready");

  const generateMutation = useMutation({
    mutationFn: (data: GeneratePayload) => apiRequest("POST", "/api/ai-studio/generate", data),
    onSuccess: async (res) => {
      const data = await res.json();
      setJobId(data.jobId);
      setStep(2);
    },
    onError: () => {
      toast({ title: "Generation failed", variant: "destructive" });
    },
  });

  const { data: jobStatus } = useQuery<{ jobId: string; status: string; progressLog: string[] }>({
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
            onClick={() => setStep(1)}
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
          <Button variant="outline" onClick={() => setStep(0)}>
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
            Generation was interrupted (the server may have restarted). Your previous selections are saved.
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => { setStep(0); setJobId(null); setProgressLog([]); }}
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </Button>
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
          <TabsList className="mb-4">
            <TabsTrigger value="sop">SOPs</TabsTrigger>
            <TabsTrigger value="training">Training</TabsTrigger>
            <TabsTrigger value="task">Tasks</TabsTrigger>
            <TabsTrigger value="knowledge_base">Knowledge Base</TabsTrigger>
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
