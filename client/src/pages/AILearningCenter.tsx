import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import {
  Brain, Upload, Camera, FileText, Loader2, Trash2, Tag,
  ChevronDown, ChevronUp, CheckCircle, AlertCircle, Clock, Plus, X,
  Wand2, ChevronLeft, ChevronRight, GraduationCap, CheckCircle2,
  Sparkles, ArrowLeft, Target,
} from "lucide-react";
import type { KnowledgeDocument } from "@shared/schema";

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  policy_manual: "Policy Manual",
  sales_script: "Sales Script",
  sales_training: "Sales Training",
  style_guide: "Style Guide",
  operations_reference: "Operations Reference",
  other: "Other",
};

const DOCUMENT_TYPE_COLORS: Record<string, string> = {
  policy_manual: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  sales_script: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  sales_training: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  style_guide: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
  operations_reference: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  other: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

const STATUS_CONFIG = {
  pending: { icon: Clock, label: "Pending", class: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  processing: { icon: Loader2, label: "Processing", class: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  ready: { icon: CheckCircle, label: "Ready", class: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  failed: { icon: AlertCircle, label: "Failed", class: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
};

interface UploadingFile {
  id: string;
  name: string;
  progress: "uploading" | "done" | "error";
  error?: string;
}

interface SopDocument {
  id: string;
  title: string;
  tags?: string[] | null;
  isPublished: boolean;
  content: string;
}

interface CompanyAiContext {
  id: string;
  storeName: string;
  businessType: string;
  brandVoice?: string | null;
  teamRoles: string[];
  goals: string[];
}

interface JobStatus {
  jobId: string;
  status: "pending" | "running" | "complete" | "failed";
  progressLog: string[];
  resultsJson?: any;
}

const STEPS = ["Store Context", "Select Documents", "Choose Output", "Review & Generate"];

function DocumentCard({
  doc,
  onDelete,
  onUpdateTags,
}: {
  doc: KnowledgeDocument;
  onDelete: (id: string) => void;
  onUpdateTags: (id: string, tags: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingTags, setEditingTags] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [localTags, setLocalTags] = useState<string[]>(doc.autoTags ?? []);

  const status = STATUS_CONFIG[doc.processingStatus as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;
  const StatusIcon = status.icon;
  const typeLabel = DOCUMENT_TYPE_LABELS[doc.documentType ?? "other"] ?? "Other";
  const typeColor = DOCUMENT_TYPE_COLORS[doc.documentType ?? "other"] ?? DOCUMENT_TYPE_COLORS.other;

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !localTags.includes(trimmed)) {
      const updated = [...localTags, trimmed];
      setLocalTags(updated);
      onUpdateTags(doc.id, updated);
    }
    setTagInput("");
  };

  const handleRemoveTag = (tag: string) => {
    const updated = localTags.filter((t) => t !== tag);
    setLocalTags(updated);
    onUpdateTags(doc.id, updated);
  };

  return (
    <Card className="border border-border">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="font-medium text-sm truncate">{doc.originalFileName}</span>
              <Badge className={`text-xs ${typeColor}`}>{typeLabel}</Badge>
              <Badge className={`text-xs flex items-center gap-1 ${status.class}`}>
                <StatusIcon className={`w-3 h-3 ${doc.processingStatus === "processing" ? "animate-spin" : ""}`} />
                {status.label}
              </Badge>
            </div>

            {doc.summaryFromClaude && (
              <p className="text-sm text-muted-foreground mb-2 line-clamp-2">{doc.summaryFromClaude}</p>
            )}

            <div className="flex flex-wrap gap-1 mb-2">
              {localTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full"
                >
                  <Tag className="w-2.5 h-2.5" />
                  {tag}
                  {editingTags && (
                    <button onClick={() => handleRemoveTag(tag)} className="ml-0.5 hover:text-destructive">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  )}
                </span>
              ))}
              {localTags.length === 0 && doc.processingStatus === "ready" && (
                <span className="text-xs text-muted-foreground italic">No tags yet</span>
              )}
            </div>

            {editingTags && (
              <div className="flex items-center gap-2 mt-2">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                  placeholder="Add a tag..."
                  className="h-7 text-xs"
                />
                <Button size="sm" variant="outline" onClick={handleAddTag} className="h-7 px-2">
                  <Plus className="w-3 h-3" />
                </Button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setEditingTags(!editingTags)}
              title="Edit tags"
            >
              <Tag className="w-3.5 h-3.5" />
            </Button>
            {doc.summaryFromClaude && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setExpanded(!expanded)}
                title="View summary"
              >
                {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
              onClick={() => onDelete(doc.id)}
              title="Delete document"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {expanded && doc.summaryFromClaude && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-sm text-foreground">{doc.summaryFromClaude}</p>
          </div>
        )}

        {doc.processingStatus === "failed" && doc.errorMessage && (
          <div className="mt-2 text-xs text-destructive bg-destructive/10 rounded p-2">
            Error: {doc.errorMessage}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AILearningCenter() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState("knowledge");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const [currentStep, setCurrentStep] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [pollingActive, setPollingActive] = useState(false);

  const [contextForm, setContextForm] = useState<Partial<CompanyAiContext>>({
    storeName: "",
    businessType: "Fashion Boutique",
    brandVoice: "",
    teamRoles: ["New Associate", "Lead", "Manager"],
    goals: [],
  });
  const [goalInput, setGoalInput] = useState("");
  const [roleInput, setRoleInput] = useState("");
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [generateSOPs, setGenerateSOPs] = useState(true);
  const [generateTraining, setGenerateTraining] = useState(true);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [targetRoles, setTargetRoles] = useState<string[]>(["New Associate", "Lead", "Manager"]);

  const roleName = user?.role?.name;
  const isManagerOrOwner = roleName === "owner" || roleName === "admin" || roleName === "manager";

  const { data: docsResponse, isLoading: knowledgeLoading } = useQuery<{ success: boolean; data: KnowledgeDocument[] }>({
    queryKey: ["/api/knowledge/documents"],
    refetchInterval: (query) => {
      const docs = query.state.data?.data ?? [];
      const hasPending = docs.some(
        (d) => d.processingStatus === "pending" || d.processingStatus === "processing"
      );
      return hasPending ? 3000 : false;
    },
  });

  const knowledgeDocs = docsResponse?.data ?? [];
  const hasReadyDoc = knowledgeDocs.some((d) => d.processingStatus === "ready");

  const { data: aiContext, isLoading: contextLoading } = useQuery<CompanyAiContext>({
    queryKey: ["/api/company/ai-context"],
    enabled: isManagerOrOwner,
  });

  const { data: sopDocuments = [], isLoading: sopDocsLoading } = useQuery<SopDocument[]>({
    queryKey: ["/api/sop/documents"],
    enabled: isManagerOrOwner,
  });

  const { data: jobStatus } = useQuery<JobStatus>({
    queryKey: ["/api/ai/generate", jobId, "status"],
    enabled: !!jobId && pollingActive,
    refetchInterval: (query) => {
      const status = (query.state.data as JobStatus)?.status;
      if (status === "complete" || status === "failed") return false;
      return 2000;
    },
  });

  useEffect(() => {
    if (aiContext) {
      setContextForm({
        storeName: aiContext.storeName,
        businessType: aiContext.businessType,
        brandVoice: aiContext.brandVoice || "",
        teamRoles: aiContext.teamRoles || ["New Associate", "Lead", "Manager"],
        goals: aiContext.goals || [],
      });
      setTargetRoles(aiContext.teamRoles || ["New Associate", "Lead", "Manager"]);
    }
  }, [aiContext]);

  useEffect(() => {
    if (jobStatus?.status === "complete" || jobStatus?.status === "failed") {
      setPollingActive(false);
    }
  }, [jobStatus?.status]);

  const allTags = sopDocuments.flatMap(d => d.tags || []).filter(Boolean);
  const uniqueTags = Array.from(new Set(allTags));

  const updateTagsMutation = useMutation({
    mutationFn: async ({ id, tags }: { id: string; tags: string[] }) => {
      return apiRequest("PATCH", `/api/knowledge/documents/${id}/tags`, { autoTags: tags });
    },
    onError: () => {
      toast({ title: "Failed to update tags", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/knowledge/documents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge/documents"] });
      toast({ title: "Document deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete document", variant: "destructive" });
    },
  });

  const uploadFile = useCallback(
    async (file: File) => {
      const tempId = `${Date.now()}-${Math.random()}`;
      setUploadingFiles((prev) => [
        ...prev,
        { id: tempId, name: file.name, progress: "uploading" },
      ]);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/knowledge/upload", {
          method: "POST",
          body: formData,
          credentials: "include",
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: { message: "Upload failed" } }));
          throw new Error(err?.error?.message ?? "Upload failed");
        }

        setUploadingFiles((prev) =>
          prev.map((f) => (f.id === tempId ? { ...f, progress: "done" } : f))
        );
        queryClient.invalidateQueries({ queryKey: ["/api/knowledge/documents"] });

        setTimeout(() => {
          setUploadingFiles((prev) => prev.filter((f) => f.id !== tempId));
        }, 2000);
      } catch (err: any) {
        setUploadingFiles((prev) =>
          prev.map((f) =>
            f.id === tempId ? { ...f, progress: "error", error: err.message } : f
          )
        );
        toast({
          title: `Failed to upload ${file.name}`,
          description: err.message,
          variant: "destructive",
        });
        setTimeout(() => {
          setUploadingFiles((prev) => prev.filter((f) => f.id !== tempId));
        }, 4000);
      }
    },
    [queryClient, toast]
  );

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      Array.from(files).forEach((file) => uploadFile(file));
    },
    [uploadFile]
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const saveContextMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/company/ai-context", contextForm);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/ai-context"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save store context", variant: "destructive" });
    },
  });

  const startGenerationMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/generate", {
        selectedDocumentIds: selectedDocIds,
        outputTypes: [generateSOPs && "sops", generateTraining && "training"].filter(Boolean),
        targetRoles,
        selectedCategories,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setJobId(data.jobId);
      setPollingActive(true);
      setCurrentStep(STEPS.length);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to start generation", variant: "destructive" });
    },
  });

  const handleNextStep = async () => {
    if (currentStep === 0) {
      await saveContextMutation.mutateAsync();
    }
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(s => s + 1);
    }
  };

  const handleGenerate = () => {
    if (!generateSOPs && !generateTraining) {
      toast({ title: "Select at least one output type", variant: "destructive" });
      return;
    }
    if (selectedDocIds.length === 0) {
      toast({ title: "Select at least one document", variant: "destructive" });
      return;
    }
    startGenerationMutation.mutate();
  };

  const addGoal = () => {
    if (!goalInput.trim()) return;
    setContextForm(f => ({ ...f, goals: [...(f.goals || []), goalInput.trim()] }));
    setGoalInput("");
  };

  const removeGoal = (i: number) => {
    setContextForm(f => ({ ...f, goals: (f.goals || []).filter((_, idx) => idx !== i) }));
  };

  const addRole = () => {
    if (!roleInput.trim()) return;
    const roles = contextForm.teamRoles || [];
    setContextForm(f => ({ ...f, teamRoles: [...roles, roleInput.trim()] }));
    setTargetRoles(r => [...r, roleInput.trim()]);
    setRoleInput("");
  };

  const removeRole = (role: string) => {
    setContextForm(f => ({ ...f, teamRoles: (f.teamRoles || []).filter(r => r !== role) }));
    setTargetRoles(r => r.filter(x => x !== role));
  };

  const toggleDocSelection = (id: string) => {
    setSelectedDocIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  };

  const toggleCategory = (tag: string) => {
    setSelectedCategories(cats => cats.includes(tag) ? cats.filter(c => c !== tag) : [...cats, tag]);
  };

  if (!isManagerOrOwner) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card>
          <CardContent className="p-8 text-center">
            <Brain className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Manager Access Required</h2>
            <p className="text-sm text-muted-foreground">
              The AI Learning Center is available to managers and owners.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (jobId) {
    return <GenerationProgress jobStatus={jobStatus} onBack={() => { setJobId(null); setCurrentStep(0); setActiveTab("generate"); }} />;
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/learning")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <div className="p-2 bg-primary/10 rounded-lg">
          <Brain className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">AI Learning Center</h1>
          <p className="text-sm text-muted-foreground">
            Build your knowledge base and generate AI-powered training content
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="knowledge" className="flex items-center gap-1.5">
            <FileText className="w-4 h-4" />
            Knowledge Base
          </TabsTrigger>
          <TabsTrigger value="generate" className="flex items-center gap-1.5">
            <Sparkles className="w-4 h-4" />
            Build with AI
          </TabsTrigger>
        </TabsList>

        <TabsContent value="knowledge" className="space-y-6">
          <Card
            className={`border-2 border-dashed transition-colors ${
              isDragOver
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
          >
            <CardContent className="p-6 text-center">
              <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium mb-1">Upload Store Documents</p>
              <p className="text-sm text-muted-foreground mb-4">
                Training manuals, sales scripts, operations guides, style guides, HR policies
              </p>
              <p className="text-xs text-muted-foreground mb-4">
                Supported: PDF, DOCX, TXT, JPG, PNG — up to 50 MB each
              </p>

              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  variant="outline"
                  className="flex items-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  Choose Files
                </Button>
                <Button
                  onClick={() => cameraInputRef.current?.click()}
                  variant="outline"
                  className="flex items-center gap-2 sm:hidden"
                >
                  <Camera className="w-4 h-4" />
                  Scan with Camera
                </Button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.txt,.jpg,.jpeg,.png"
                className="hidden"
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
            </CardContent>
          </Card>

          {uploadingFiles.length > 0 && (
            <div className="space-y-2">
              {uploadingFiles.map((f) => (
                <Card key={f.id} className="border border-border">
                  <CardContent className="p-3 flex items-center gap-3">
                    {f.progress === "uploading" && (
                      <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                    )}
                    {f.progress === "done" && (
                      <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                    )}
                    {f.progress === "error" && (
                      <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{f.name}</p>
                      {f.progress === "uploading" && (
                        <p className="text-xs text-muted-foreground">Uploading & extracting text…</p>
                      )}
                      {f.progress === "done" && (
                        <p className="text-xs text-green-600">Uploaded — AI processing started</p>
                      )}
                      {f.progress === "error" && (
                        <p className="text-xs text-destructive">{f.error}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Document Library</h2>
              {knowledgeDocs.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {knowledgeDocs.length} document{knowledgeDocs.length !== 1 ? "s" : ""} —{" "}
                  {knowledgeDocs.filter((d) => d.processingStatus === "ready").length} ready
                </p>
              )}
            </div>
            {hasReadyDoc && (
              <Button
                className="flex items-center gap-2"
                onClick={() => setActiveTab("generate")}
              >
                <Sparkles className="w-4 h-4" />
                Build with AI
              </Button>
            )}
          </div>

          {knowledgeLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : knowledgeDocs.length === 0 ? (
            <Card className="border border-dashed">
              <CardContent className="p-10 text-center">
                <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="font-medium mb-1">No documents yet</p>
                <p className="text-sm text-muted-foreground">
                  Upload your first store document above to get started. Claude will analyze it,
                  classify it, and extract all the key content.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {knowledgeDocs.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  doc={doc}
                  onDelete={(id) => deleteMutation.mutate(id)}
                  onUpdateTags={(id, tags) => updateTagsMutation.mutate({ id, tags })}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="generate">
          {contextLoading || sopDocsLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-64 w-full rounded-xl" />
            </div>
          ) : (
            <>
              <div className="flex gap-1 mb-6">
                {STEPS.map((step, i) => (
                  <div key={i} className={`flex-1 h-1.5 rounded-full transition-colors ${i <= currentStep ? "bg-primary" : "bg-muted"}`} />
                ))}
              </div>

              <div className="mb-4">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                  Step {currentStep + 1} of {STEPS.length}
                </p>
                <h2 className="text-lg font-semibold">{STEPS[currentStep]}</h2>
              </div>

              {currentStep === 0 && (
                <StoreContextStep
                  form={contextForm}
                  setForm={setContextForm}
                  goalInput={goalInput}
                  setGoalInput={setGoalInput}
                  roleInput={roleInput}
                  setRoleInput={setRoleInput}
                  onAddGoal={addGoal}
                  onRemoveGoal={removeGoal}
                  onAddRole={addRole}
                  onRemoveRole={removeRole}
                />
              )}

              {currentStep === 1 && (
                <SelectDocumentsStep
                  documents={sopDocuments}
                  selectedIds={selectedDocIds}
                  onToggle={toggleDocSelection}
                />
              )}

              {currentStep === 2 && (
                <ChooseOutputStep
                  generateSOPs={generateSOPs}
                  setGenerateSOPs={setGenerateSOPs}
                  generateTraining={generateTraining}
                  setGenerateTraining={setGenerateTraining}
                  uniqueTags={uniqueTags}
                  selectedCategories={selectedCategories}
                  onToggleCategory={toggleCategory}
                  targetRoles={contextForm.teamRoles || []}
                  selectedTargetRoles={targetRoles}
                  setTargetRoles={setTargetRoles}
                />
              )}

              {currentStep === 3 && (
                <ReviewStep
                  contextForm={contextForm}
                  selectedDocIds={selectedDocIds}
                  documents={sopDocuments}
                  generateSOPs={generateSOPs}
                  generateTraining={generateTraining}
                  targetRoles={targetRoles}
                  selectedCategories={selectedCategories}
                />
              )}

              <div className="flex justify-between mt-6">
                {currentStep > 0 ? (
                  <Button variant="outline" onClick={() => setCurrentStep(s => s - 1)}>
                    <ChevronLeft className="w-4 h-4 mr-1" /> Back
                  </Button>
                ) : <div />}

                {currentStep < STEPS.length - 1 ? (
                  <Button onClick={handleNextStep} disabled={saveContextMutation.isPending}>
                    {saveContextMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Next <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                ) : (
                  <Button onClick={handleGenerate} disabled={startGenerationMutation.isPending} className="bg-primary">
                    {startGenerationMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                    Generate
                  </Button>
                )}
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StoreContextStep({ form, setForm, goalInput, setGoalInput, roleInput, setRoleInput, onAddGoal, onRemoveGoal, onAddRole, onRemoveRole }: any) {
  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="space-y-1">
          <Label>Store Name</Label>
          <Input value={form.storeName || ""} onChange={e => setForm((f: any) => ({ ...f, storeName: e.target.value }))} placeholder="e.g. Bellamy Fashion" />
        </div>
        <div className="space-y-1">
          <Label>Store Type</Label>
          <Input value={form.businessType || ""} onChange={e => setForm((f: any) => ({ ...f, businessType: e.target.value }))} placeholder="e.g. Fashion Boutique" />
        </div>
        <div className="space-y-1">
          <Label>Brand Voice / Tone</Label>
          <Textarea value={form.brandVoice || ""} onChange={e => setForm((f: any) => ({ ...f, brandVoice: e.target.value }))} placeholder="e.g. Warm, aspirational, fashion-forward — we make every customer feel like a VIP" rows={2} />
        </div>
        <div className="space-y-2">
          <Label>Team Roles</Label>
          <div className="flex gap-2">
            <Input value={roleInput} onChange={e => setRoleInput(e.target.value)} placeholder="Add role..." onKeyDown={e => e.key === "Enter" && onAddRole()} />
            <Button type="button" variant="outline" size="sm" onClick={onAddRole}>Add</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {(form.teamRoles || []).map((role: string) => (
              <Badge key={role} variant="secondary" className="gap-1 cursor-pointer" onClick={() => onRemoveRole(role)}>
                {role} ×
              </Badge>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <Label>Business Goals</Label>
          <div className="flex gap-2">
            <Input value={goalInput} onChange={e => setGoalInput(e.target.value)} placeholder="e.g. Increase average transaction value" onKeyDown={e => e.key === "Enter" && onAddGoal()} />
            <Button type="button" variant="outline" size="sm" onClick={onAddGoal}>Add</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {(form.goals || []).map((goal: string, i: number) => (
              <Badge key={i} variant="outline" className="gap-1 cursor-pointer" onClick={() => onRemoveGoal(i)}>
                <Target className="w-3 h-3" /> {goal} ×
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SelectDocumentsStep({ documents, selectedIds, onToggle }: any) {
  const publishedDocs = documents.filter((d: SopDocument) => d.isPublished);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Select Source Documents</CardTitle>
        <p className="text-sm text-muted-foreground">{selectedIds.length} selected · {publishedDocs.length} available</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {publishedDocs.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No published documents found. Publish some SOP documents first.</p>
          </div>
        )}
        {publishedDocs.map((doc: SopDocument) => (
          <div
            key={doc.id}
            onClick={() => onToggle(doc.id)}
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selectedIds.includes(doc.id) ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
          >
            <Checkbox checked={selectedIds.includes(doc.id)} onCheckedChange={() => onToggle(doc.id)} />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{doc.title}</p>
              {doc.tags && doc.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {doc.tags.map((tag: string) => (
                    <Badge key={tag} variant="outline" className="text-xs"><Tag className="w-2.5 h-2.5 mr-1" />{tag}</Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ChooseOutputStep({ generateSOPs, setGenerateSOPs, generateTraining, setGenerateTraining, uniqueTags, selectedCategories, onToggleCategory, targetRoles, selectedTargetRoles, setTargetRoles }: any) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-blue-500" />
              <div>
                <p className="font-medium">Generate SOPs</p>
                <p className="text-sm text-muted-foreground">Structured procedures with decision-tree steps</p>
              </div>
            </div>
            <Switch checked={generateSOPs} onCheckedChange={setGenerateSOPs} />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <GraduationCap className="w-5 h-5 text-green-500" />
              <div>
                <p className="font-medium">Generate Training Program</p>
                <p className="text-sm text-muted-foreground">Modules with objectives, content, and exercises</p>
              </div>
            </div>
            <Switch checked={generateTraining} onCheckedChange={setGenerateTraining} />
          </div>
        </CardContent>
      </Card>

      {generateSOPs && uniqueTags.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">SOP Categories to Focus On</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {uniqueTags.map((tag: string) => (
                <Badge
                  key={tag}
                  variant={selectedCategories.includes(tag) ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => onToggleCategory(tag)}
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Target Roles</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {targetRoles.map((role: string) => (
              <Badge
                key={role}
                variant={selectedTargetRoles.includes(role) ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setTargetRoles((r: string[]) => r.includes(role) ? r.filter(x => x !== role) : [...r, role])}
              >
                {role}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ReviewStep({ contextForm, selectedDocIds, documents, generateSOPs, generateTraining, targetRoles, selectedCategories }: any) {
  const selectedDocs = documents.filter((d: SopDocument) => selectedDocIds.includes(d.id));
  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Store</p>
            <p className="font-medium">{contextForm.storeName} · {contextForm.businessType}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Documents selected</p>
            <ul className="list-disc pl-4 text-sm space-y-0.5 mt-1">
              {selectedDocs.map((d: SopDocument) => <li key={d.id}>{d.title}</li>)}
            </ul>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Outputs</p>
            <div className="flex gap-2 mt-1">
              {generateSOPs && <Badge variant="secondary"><FileText className="w-3 h-3 mr-1" />SOPs</Badge>}
              {generateTraining && <Badge variant="secondary"><GraduationCap className="w-3 h-3 mr-1" />Training</Badge>}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Target roles</p>
            <p className="text-sm">{targetRoles.join(", ") || "All roles"}</p>
          </div>
          {selectedCategories.length > 0 && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">SOP categories</p>
              <p className="text-sm">{selectedCategories.join(", ")}</p>
            </div>
          )}
        </div>
        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-700 dark:text-amber-300">
          <Sparkles className="w-4 h-4 inline mr-1" />
          Claude will analyze your documents and generate draft SOPs and training modules. This takes 1–3 minutes.
        </div>
      </CardContent>
    </Card>
  );
}

function GenerationProgress({ jobStatus, onBack }: { jobStatus?: JobStatus; onBack: () => void }) {
  const [, navigate] = useLocation();
  const status = jobStatus?.status || "pending";
  const log = jobStatus?.progressLog || [];
  const results = jobStatus?.resultsJson as any;
  const isComplete = status === "complete";
  const isFailed = status === "failed";

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <h1 className="text-xl font-bold">
          {isComplete ? "Generation Complete!" : isFailed ? "Generation Failed" : "Generating..."}
        </h1>
      </div>

      {!isComplete && !isFailed && (
        <div className="flex items-center gap-3 mb-4 p-4 rounded-lg bg-primary/5 border border-primary/20">
          <Loader2 className="w-5 h-5 animate-spin text-primary flex-shrink-0" />
          <p className="text-sm">Claude is analyzing your documents and building your content...</p>
        </div>
      )}

      {isComplete && (
        <div className="flex items-center gap-3 mb-4 p-4 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
          <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
          <p className="text-sm text-green-700 dark:text-green-300">
            Generated {results?.sops?.length || 0} SOP(s) and {results?.trainingModules?.length || 0} training module(s)
          </p>
        </div>
      )}

      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Progress Log</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {log.map((msg, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0 mt-0.5" />
                <span className="text-muted-foreground">{msg}</span>
              </div>
            ))}
            {log.length === 0 && <p className="text-sm text-muted-foreground">Waiting to start...</p>}
          </div>
        </CardContent>
      </Card>

      {isComplete && results && (
        <GenerationResults results={results} jobId={jobStatus!.jobId} />
      )}
    </div>
  );
}

function GenerationResults({ results, jobId }: { results: any; jobId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: categories = [] } = useQuery<any[]>({ queryKey: ["/api/sop/categories"] });

  const publishSopMutation = useMutation({
    mutationFn: async ({ sopIndex, categoryId }: { sopIndex: number; categoryId: string }) => {
      const res = await apiRequest("POST", `/api/ai/generate/${jobId}/publish-sop`, { sopIndex, categoryId });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "SOP published!", description: "The SOP has been added to your library." });
      queryClient.invalidateQueries({ queryKey: ["/api/sop/documents"] });
    },
    onError: () => toast({ title: "Error", description: "Failed to publish SOP", variant: "destructive" }),
  });

  const publishTrainingMutation = useMutation({
    mutationFn: async (moduleIndex: number) => {
      const res = await apiRequest("POST", `/api/ai/generate/${jobId}/publish-training`, { moduleIndex });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Module published!", description: "The training module has been added to the hub." });
      queryClient.invalidateQueries({ queryKey: ["/api/training/modules"] });
    },
    onError: () => toast({ title: "Error", description: "Failed to publish module", variant: "destructive" }),
  });

  const defaultCategoryId = categories[0]?.id;

  return (
    <div className="space-y-4">
      {results.sops && results.sops.length > 0 && (
        <div>
          <h3 className="font-semibold text-base mb-2 flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-500" /> Generated SOPs ({results.sops.length})
          </h3>
          <div className="space-y-2">
            {results.sops.map((sop: any, i: number) => (
              <Card key={i}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{sop.title}</p>
                      <p className="text-xs text-muted-foreground">{sop.role} · {sop.category} · {sop.steps?.length} steps</p>
                      {sop.sourceDocumentTitle && (
                        <p className="text-xs text-muted-foreground mt-0.5">Source: {sop.sourceDocumentTitle}</p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => publishSopMutation.mutate({ sopIndex: i, categoryId: defaultCategoryId })}
                      disabled={publishSopMutation.isPending || !defaultCategoryId}
                    >
                      {publishSopMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Publish"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {results.trainingModules && results.trainingModules.length > 0 && (
        <div>
          <h3 className="font-semibold text-base mb-2 flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-green-500" /> Generated Training Modules ({results.trainingModules.length})
          </h3>
          <div className="space-y-2">
            {results.trainingModules.map((mod: any, i: number) => (
              <Card key={i}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{mod.title}</p>
                      <p className="text-xs text-muted-foreground">{mod.role} · ~{mod.estimatedMinutes} min · {mod.exercises?.length || 0} exercises</p>
                      {mod.sourceDocumentTitle && (
                        <p className="text-xs text-muted-foreground mt-0.5">Source: {mod.sourceDocumentTitle}</p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => publishTrainingMutation.mutate(i)}
                      disabled={publishTrainingMutation.isPending}
                    >
                      {publishTrainingMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Publish"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
