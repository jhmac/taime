import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import {
  Brain,
  Upload,
  Camera,
  FileText,
  Loader2,
  Trash2,
  Tag,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  AlertCircle,
  Clock,
  Plus,
  X,
  Sparkles,
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const { data: docsResponse, isLoading } = useQuery<{ success: boolean; data: KnowledgeDocument[] }>({
    queryKey: ["/api/knowledge/documents"],
    refetchInterval: (query) => {
      const docs = query.state.data?.data ?? [];
      const hasPending = docs.some(
        (d) => d.processingStatus === "pending" || d.processingStatus === "processing"
      );
      return hasPending ? 3000 : false;
    },
  });

  const docs = docsResponse?.data ?? [];
  const hasReadyDoc = docs.some((d) => d.processingStatus === "ready");

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

  const roleName = user?.role?.name;
  const isManagerOrOwner = roleName === "owner" || roleName === "admin" || roleName === "manager";

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

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Brain className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">AI Learning Center</h1>
          <p className="text-sm text-muted-foreground">
            Upload your store documents to build a knowledge base for AI-powered training
          </p>
        </div>
      </div>

      <Tabs defaultValue="knowledge">
        <TabsList className="mb-6">
          <TabsTrigger value="knowledge" className="flex items-center gap-1.5">
            <FileText className="w-4 h-4" />
            Knowledge Base
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
              {docs.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {docs.length} document{docs.length !== 1 ? "s" : ""} —{" "}
                  {docs.filter((d) => d.processingStatus === "ready").length} ready
                </p>
              )}
            </div>
            {hasReadyDoc && (
              <Button className="flex items-center gap-2" title="Generate SOPs and training programs from your knowledge base (coming in Phase 2)">
                <Sparkles className="w-4 h-4" />
                Build with AI
                <Badge variant="secondary" className="text-xs ml-1">
                  Phase 2
                </Badge>
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : docs.length === 0 ? (
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
              {docs.map((doc) => (
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
      </Tabs>
    </div>
  );
}
