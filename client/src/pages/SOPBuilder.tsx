import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useRoute } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';
import {
  ArrowLeft, Plus, Trash2, GripVertical, Save, Loader2,
  CheckCircle2, Eye, Camera, GitBranch, Timer, ChevronDown, BookOpen, AlertTriangle, Sparkles, RefreshCw,
  Video, Image, X, Star, Film
} from 'lucide-react';
import type { WorkLocation } from '@shared/schema';

const CATEGORIES = [
  { value: 'opening', label: 'Opening' },
  { value: 'closing', label: 'Closing' },
  { value: 'customer_service', label: 'Customer Service' },
  { value: 'visual_merchandising', label: 'Visual Merchandising' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'safety', label: 'Safety' },
  { value: 'shift_handoff', label: 'Shift Handoff' },
  { value: 'custom', label: 'Custom' },
] as const;

const STEP_TYPES = [
  { value: 'action', label: 'Action', icon: CheckCircle2, desc: 'A task to complete' },
  { value: 'verification', label: 'Verification', icon: Eye, desc: 'Check or inspect something' },
  { value: 'photo', label: 'Photo', icon: Camera, desc: 'Take a photo as evidence' },
  { value: 'decision', label: 'Decision', icon: GitBranch, desc: 'Choose between options' },
  { value: 'timer', label: 'Timer', icon: Timer, desc: 'Wait for a set duration' },
] as const;

const ROLES = ['associate', 'manager', 'owner'] as const;

interface StepForm {
  key: string;
  title: string;
  description: string;
  stepType: string;
  isCheckpoint: boolean;
  timerDurationSeconds: number | null;
  decisionOptions: { question?: string; options: { label: string; nextStepOrder: number; color?: string }[] } | null;
  trainingDetail: string;
  trainingVideoUrl: string | null;
  trainingPhotoUrls: string[];
  trainingVideoThumbnail: string | null;
}

function makeEmptyStep(): StepForm {
  return {
    key: crypto.randomUUID(),
    title: '',
    description: '',
    stepType: 'action',
    isCheckpoint: false,
    timerDurationSeconds: null,
    decisionOptions: null,
    trainingDetail: '',
    trainingVideoUrl: null,
    trainingPhotoUrls: [],
    trainingVideoThumbnail: null,
  };
}

function compressImageForTraining(file: File, maxSizeKB: number = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        const maxDim = 1200;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas unavailable')); return; }
        ctx.drawImage(img, 0, 0, width, height);
        let quality = 0.7;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > maxSizeKB * 1024 * 1.37 && quality > 0.1) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function FlowVisualization({ steps }: { steps: StepForm[] }) {
  const nodeWidth = 180;
  const nodeHeight = 50;
  const decisionHeight = 60;
  const gapY = 30;
  const padding = 20;

  interface LayoutNode {
    x: number;
    y: number;
    width: number;
    height: number;
    step: StepForm;
    order: number;
  }

  const nodes: LayoutNode[] = [];
  let maxX = 0;
  let currentY = padding;

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const h = s.stepType === 'decision' ? decisionHeight : nodeHeight;
    const node: LayoutNode = {
      x: padding + (nodeWidth / 2),
      y: currentY + (h / 2),
      width: nodeWidth,
      height: h,
      step: s,
      order: i + 1,
    };
    nodes.push(node);
    maxX = Math.max(maxX, node.x + nodeWidth / 2);
    currentY += h + gapY;
  }

  const svgWidth = Math.max(maxX + padding + 100, 300);
  const svgHeight = currentY + padding;

  const nodeByOrder = new Map(nodes.map(n => [n.order, n]));

  const edges: { from: LayoutNode; to: LayoutNode; label?: string; color?: string }[] = [];
  for (const node of nodes) {
    if (node.step.stepType === 'decision' && node.step.decisionOptions?.options) {
      for (const opt of node.step.decisionOptions.options) {
        const target = nodeByOrder.get(opt.nextStepOrder);
        if (target) {
          edges.push({ from: node, to: target, label: opt.label, color: opt.color });
        }
      }
    } else {
      const next = nodeByOrder.get(node.order + 1);
      if (next) {
        edges.push({ from: node, to: next });
      }
    }
  }

  const colorMap: Record<string, string> = {
    green: '#22c55e',
    yellow: '#f59e0b',
    red: '#ef4444',
    blue: '#3b82f6',
    gray: '#9ca3af',
  };

  return (
    <div className="overflow-auto max-h-[500px]">
      <svg width={svgWidth} height={svgHeight} className="min-w-full">
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="currentColor" className="text-muted-foreground" />
          </marker>
        </defs>

        {edges.map((edge, i) => {
          const fromBottom = edge.from.y + edge.from.height / 2;
          const toTop = edge.to.y - edge.to.height / 2;
          const isBranch = edge.label;
          const edgeColor = edge.color ? colorMap[edge.color] || '#9ca3af' : 'currentColor';

          if (edge.to.order > edge.from.order + 1 || edge.to.order < edge.from.order) {
            const offsetX = isBranch ? (i % 2 === 0 ? 60 : -40) + (i * 15) : 0;
            const midX = edge.from.x + nodeWidth / 2 + 20 + Math.abs(offsetX);
            return (
              <g key={`edge-${i}`}>
                <path
                  d={`M ${edge.from.x + (offsetX > 0 ? nodeWidth/2 : -nodeWidth/2)} ${edge.from.y} 
                      L ${midX} ${edge.from.y} 
                      L ${midX} ${toTop - 10} 
                      L ${edge.to.x} ${toTop - 10}
                      L ${edge.to.x} ${toTop}`}
                  fill="none"
                  stroke={edgeColor}
                  strokeWidth={1.5}
                  markerEnd="url(#arrowhead)"
                  className={!edge.color ? 'text-muted-foreground' : ''}
                />
                {edge.label && (
                  <text x={midX + 4} y={(edge.from.y + toTop) / 2} fontSize={10} className="fill-muted-foreground">
                    {edge.label.length > 18 ? edge.label.slice(0, 16) + '…' : edge.label}
                  </text>
                )}
              </g>
            );
          }

          return (
            <g key={`edge-${i}`}>
              <line
                x1={edge.from.x}
                y1={fromBottom}
                x2={edge.to.x}
                y2={toTop}
                stroke={edgeColor}
                strokeWidth={1.5}
                markerEnd="url(#arrowhead)"
                className={!edge.color ? 'text-muted-foreground' : ''}
              />
              {edge.label && (
                <text x={edge.from.x + 8} y={(fromBottom + toTop) / 2} fontSize={10} className="fill-muted-foreground">
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}

        {nodes.map((node) => {
          const isDecision = node.step.stepType === 'decision';
          const stepConfig = STEP_TYPES.find(t => t.value === node.step.stepType);
          const label = `${node.order}. ${node.step.title || stepConfig?.label || 'Step'}`;
          const truncated = label.length > 22 ? label.slice(0, 20) + '…' : label;

          if (isDecision) {
            const cx = node.x;
            const cy = node.y;
            const hw = node.width / 2;
            const hh = node.height / 2;
            return (
              <g key={`node-${node.order}`}>
                <polygon
                  points={`${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`}
                  className="fill-amber-50 dark:fill-amber-950/40 stroke-amber-500"
                  strokeWidth={2}
                />
                <text x={cx} y={cy + 4} textAnchor="middle" fontSize={11} className="fill-foreground font-medium">
                  {truncated}
                </text>
              </g>
            );
          }

          return (
            <g key={`node-${node.order}`}>
              <rect
                x={node.x - node.width / 2}
                y={node.y - node.height / 2}
                width={node.width}
                height={node.height}
                rx={8}
                className="fill-background stroke-border"
                strokeWidth={1.5}
              />
              <text x={node.x} y={node.y + 4} textAnchor="middle" fontSize={11} className="fill-foreground font-medium">
                {truncated}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function SOPBuilder() {
  const [, navigate] = useLocation();
  const [isEditRoute, editParams] = useRoute('/sops/:id/edit');
  const editId = isEditRoute ? editParams?.id : null;
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [estimatedMinutes, setEstimatedMinutes] = useState<string>('');
  const [roleAssignments, setRoleAssignments] = useState<string[]>([]);
  const [trainingNotes, setTrainingNotes] = useState('');
  const [walkthroughVideoUrl, setWalkthroughVideoUrl] = useState('');
  const [isTrainingPriority, setIsTrainingPriority] = useState(false);
  const [storeId, setStoreId] = useState('');
  const [steps, setSteps] = useState<StepForm[]>([makeEmptyStep()]);
  const [showTraining, setShowTraining] = useState(false);
  const [showFlowView, setShowFlowView] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiDescription, setAiDescription] = useState('');

  const { data: locations = [] } = useQuery<WorkLocation[]>({
    queryKey: ['/api/work-locations'],
  });

  const { data: existingTemplate, isLoading: loadingTemplate } = useQuery<{ success: boolean; data: any }>({
    queryKey: ['/api/sops/templates', editId],
    queryFn: async () => {
      const res = await fetch(`/api/sops/templates/${editId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load template');
      return res.json();
    },
    enabled: !!editId,
  });

  useEffect(() => {
    if (existingTemplate?.data) {
      const t = existingTemplate.data;
      setTitle(t.title);
      setDescription(t.description || '');
      setCategory(t.category);
      setEstimatedMinutes(t.estimatedDurationMinutes?.toString() || '');
      setRoleAssignments(t.roleAssignments || []);
      setTrainingNotes(t.trainingNotes || '');
      setWalkthroughVideoUrl(t.walkthroughVideoUrl || '');
      setIsTrainingPriority(t.isTrainingPriority || false);
      setStoreId(t.storeId);
      if (t.steps?.length) {
        setSteps(t.steps.map((s: any) => ({
          key: crypto.randomUUID(),
          title: s.title,
          description: s.description || '',
          stepType: s.stepType,
          isCheckpoint: s.isCheckpoint || false,
          timerDurationSeconds: s.timerDurationSeconds,
          decisionOptions: s.decisionOptions,
          trainingDetail: s.trainingDetail || '',
          trainingVideoUrl: s.trainingVideoUrl || null,
          trainingPhotoUrls: s.trainingPhotoUrls || [],
          trainingVideoThumbnail: s.trainingVideoThumbnail || null,
        })));
      }
    }
  }, [existingTemplate]);

  useEffect(() => {
    if (locations.length > 0 && !storeId) {
      setStoreId(locations[0].id);
    }
  }, [locations, storeId]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        storeId,
        title,
        description: description || null,
        category,
        estimatedDurationMinutes: estimatedMinutes ? parseInt(estimatedMinutes) : null,
        roleAssignments: roleAssignments.length > 0 ? roleAssignments : null,
        trainingNotes: trainingNotes || null,
        walkthroughVideoUrl: walkthroughVideoUrl || null,
        isTrainingPriority,
        steps: steps.map(s => ({
          title: s.title,
          description: s.description || null,
          stepType: s.stepType,
          isCheckpoint: s.isCheckpoint,
          timerDurationSeconds: s.stepType === 'timer' ? s.timerDurationSeconds : null,
          decisionOptions: s.stepType === 'decision' ? s.decisionOptions : null,
          trainingDetail: s.trainingDetail || null,
          trainingVideoUrl: s.trainingVideoUrl || null,
          trainingPhotoUrls: s.trainingPhotoUrls.length > 0 ? s.trainingPhotoUrls : null,
          trainingVideoThumbnail: s.trainingVideoThumbnail || null,
        })),
      };

      if (editId) {
        return apiRequest('PUT', `/api/sops/templates/${editId}`, payload);
      }
      return apiRequest('POST', '/api/sops/templates', payload);
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ['/api/sops/templates'] });
      toast({ title: editId ? 'SOP Updated' : 'SOP Created', description: editId ? 'A new version has been saved.' : 'Your procedure is ready for the team.' });
      navigate('/sops');
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message || 'Failed to save SOP', variant: 'destructive' });
    },
  });

  const aiGenerateMutation = useMutation({
    mutationFn: async (desc: string) => {
      const currentStore = locations.find(l => l.id === storeId);
      const res = await apiRequest('POST', '/api/sops/templates/ai-generate', {
        description: desc,
        storeId: storeId || locations[0]?.id || 'default',
        storeName: currentStore?.name,
      });
      return res.json() as Promise<{ success: boolean; data: { generated_sop: {
        title: string; description: string; category: string;
        estimated_duration_minutes: number; training_notes: string;
        steps: { title: string; description: string | null; step_type: string;
          is_checkpoint: boolean; timer_duration_seconds: number | null; training_detail: string | null }[];
      } } }>;
    },
    onSuccess: (result) => {
      const sop = result.data.generated_sop;
      setTitle(sop.title);
      setDescription(sop.description || '');
      setCategory(sop.category);
      setEstimatedMinutes(sop.estimated_duration_minutes?.toString() || '');
      setTrainingNotes(sop.training_notes || '');
      setSteps(sop.steps.map(s => ({
        key: crypto.randomUUID(),
        title: s.title,
        description: s.description || '',
        stepType: s.step_type,
        isCheckpoint: s.is_checkpoint,
        timerDurationSeconds: s.timer_duration_seconds,
        decisionOptions: null,
        trainingDetail: s.training_detail || '',
      })));
      setAiDialogOpen(false);
      toast({ title: 'SOP Generated', description: `Created "${sop.title}" with ${sop.steps.length} steps. Review and edit before saving.` });
    },
    onError: (err: Error) => {
      toast({ title: 'Generation Failed', description: err.message || 'Please try again or build the SOP manually.', variant: 'destructive' });
    },
  });

  const updateStep = (index: number, updates: Partial<StepForm>) => {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, ...updates } : s));
  };

  const removeStep = (index: number) => {
    if (steps.length <= 1) return;
    setSteps(prev => prev.filter((_, i) => i !== index));
  };

  const addStep = () => {
    setSteps(prev => [...prev, makeEmptyStep()]);
  };

  const moveStep = (from: number, to: number) => {
    if (to < 0 || to >= steps.length) return;
    setSteps(prev => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const toggleRole = (role: string) => {
    setRoleAssignments(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]);
  };

  const canSave = title.trim() && category && storeId && steps.every(s => s.title.trim() && s.stepType);

  if (editId && loadingTemplate) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="px-4 pt-4 pb-2 flex items-center gap-3 border-b">
        <Button variant="ghost" size="icon" onClick={() => navigate('/sops')} className="shrink-0">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold truncate">{editId ? 'Edit SOP' : 'Create New SOP'}</h1>
          <p className="text-xs text-muted-foreground">
            {editId ? 'Save will create a new version' : 'Build a step-by-step procedure for your team'}
          </p>
        </div>
        {!editId && (
          <Button
            variant="outline"
            onClick={() => setAiDialogOpen(true)}
            className="gap-2 shrink-0"
          >
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline">AI Generate</span>
          </Button>
        )}
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!canSave || saveMutation.isPending}
          className="gap-2 shrink-0"
        >
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {editId ? 'Save New Version' : 'Save SOP'}
        </Button>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4 space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Procedure Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Title *</Label>
                <Input
                  placeholder="e.g., Morning Opening Checklist"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label>Description</Label>
                <Textarea
                  placeholder="Brief summary of what this procedure covers..."
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={2}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Category *</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category..." />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Location *</Label>
                <Select value={storeId} onValueChange={setStoreId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select location..." />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map(loc => (
                      <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Estimated Duration (minutes)</Label>
                <Input
                  type="number"
                  min={1}
                  placeholder="e.g., 15"
                  value={estimatedMinutes}
                  onChange={e => setEstimatedMinutes(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Assign to Roles</Label>
                <div className="flex gap-3 pt-1">
                  {ROLES.map(role => (
                    <label key={role} className="flex items-center gap-1.5 text-sm capitalize cursor-pointer">
                      <Checkbox
                        checked={roleAssignments.includes(role)}
                        onCheckedChange={() => toggleRole(role)}
                      />
                      {role}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Switch
                  checked={isTrainingPriority}
                  onCheckedChange={setIsTrainingPriority}
                />
                <span className="flex items-center gap-1.5">
                  <Star className="h-3.5 w-3.5 text-amber-500" />
                  Training Priority — Must-learn for new hires
                </span>
              </label>
            </div>

            <Collapsible open={showTraining} onOpenChange={setShowTraining}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
                  <BookOpen className="h-4 w-4" />
                  Training Content
                  <ChevronDown className={`h-3 w-3 transition-transform ${showTraining ? 'rotate-180' : ''}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2 space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Training Notes — Why We Do This</Label>
                  <Textarea
                    placeholder="Explain the purpose of this procedure for training mode..."
                    value={trainingNotes}
                    onChange={e => setTrainingNotes(e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1.5">
                    <Film className="h-3.5 w-3.5" />
                    SOP Walkthrough Video URL
                  </Label>
                  <Input
                    placeholder="Paste video URL (YouTube, etc.) for the full procedure walkthrough..."
                    value={walkthroughVideoUrl}
                    onChange={e => setWalkthroughVideoUrl(e.target.value)}
                  />
                  {walkthroughVideoUrl && (
                    <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Walkthrough video linked
                    </p>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold flex items-center gap-2">
              Steps
              <Badge variant="secondary" className="text-xs">{steps.length}</Badge>
            </h2>
            {steps.some(s => s.stepType === 'decision') && (
              <Button
                variant={showFlowView ? "default" : "outline"}
                size="sm"
                className="text-xs gap-1"
                onClick={() => setShowFlowView(!showFlowView)}
              >
                <GitBranch className="h-3 w-3" />
                {showFlowView ? 'List View' : 'Flow View'}
              </Button>
            )}
          </div>

          {showFlowView && (
            <Card className="overflow-hidden">
              <CardContent className="p-4">
                <FlowVisualization steps={steps} />
              </CardContent>
            </Card>
          )}

          {steps.map((step, index) => {
            const stepTypeInfo = STEP_TYPES.find(t => t.value === step.stepType);
            const StepIcon = stepTypeInfo?.icon || CheckCircle2;

            return (
              <Card key={step.key} className="relative">
                <div className="absolute left-0 top-0 bottom-0 w-8 flex items-center justify-center cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground"
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDrop={() => { if (dragIndex !== null && dragIndex !== index) moveStep(dragIndex, index); setDragIndex(null); }}
                  onDragEnd={() => setDragIndex(null)}
                >
                  <GripVertical className="h-4 w-4" />
                </div>
                <CardContent className="pl-10 pr-4 py-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <Badge variant="outline" className="text-xs shrink-0 mt-1">Step {index + 1}</Badge>
                    <Input
                      placeholder="What needs to be done?"
                      className="flex-1 font-medium"
                      value={step.title}
                      onChange={e => updateStep(index, { title: e.target.value })}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeStep(index)}
                      disabled={steps.length <= 1}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Step Type</Label>
                      <Select value={step.stepType} onValueChange={v => updateStep(index, { stepType: v })}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STEP_TYPES.map(t => (
                            <SelectItem key={t.value} value={t.value}>
                              <div className="flex items-center gap-2">
                                <t.icon className="h-3.5 w-3.5" />
                                {t.label}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-end gap-4">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <Switch
                          checked={step.isCheckpoint}
                          onCheckedChange={v => updateStep(index, { isCheckpoint: v })}
                        />
                        <span className="flex items-center gap-1">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                          Checkpoint
                        </span>
                      </label>
                    </div>
                  </div>

                  <Textarea
                    placeholder="Detailed instructions (optional)..."
                    className="min-h-[60px] text-sm"
                    value={step.description}
                    onChange={e => updateStep(index, { description: e.target.value })}
                    rows={2}
                  />

                  {step.stepType === 'timer' && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Timer Duration (seconds)</Label>
                      <Input
                        type="number"
                        min={1}
                        placeholder="e.g., 300"
                        value={step.timerDurationSeconds?.toString() || ''}
                        onChange={e => updateStep(index, { timerDurationSeconds: e.target.value ? parseInt(e.target.value) : null })}
                        className="w-40"
                      />
                    </div>
                  )}

                  {step.stepType === 'decision' && (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Decision Question</Label>
                        <Input
                          placeholder="e.g., Does the customer have a receipt?"
                          value={step.decisionOptions?.question || ''}
                          className="h-9 text-sm"
                          onChange={e => {
                            const current = step.decisionOptions || { options: [] };
                            updateStep(index, { decisionOptions: { ...current, question: e.target.value } });
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs font-medium">Options (2-5)</Label>
                        {(step.decisionOptions?.options || []).map((opt, oi) => (
                          <div key={oi} className="flex gap-2 items-center bg-muted/30 dark:bg-muted/10 rounded-md p-2">
                            <Input
                              placeholder="Option label"
                              value={opt.label}
                              className="flex-1 h-8 text-sm"
                              onChange={e => {
                                const current = step.decisionOptions || { options: [] };
                                const opts = [...current.options];
                                opts[oi] = { ...opts[oi], label: e.target.value };
                                updateStep(index, { decisionOptions: { ...current, options: opts } });
                              }}
                            />
                            <Select
                              value={opt.nextStepOrder?.toString() || '0'}
                              onValueChange={v => {
                                const current = step.decisionOptions || { options: [] };
                                const opts = [...current.options];
                                opts[oi] = { ...opts[oi], nextStepOrder: parseInt(v) || 0 };
                                updateStep(index, { decisionOptions: { ...current, options: opts } });
                              }}
                            >
                              <SelectTrigger className="w-36 h-8 text-xs">
                                <SelectValue placeholder="Go to step..." />
                              </SelectTrigger>
                              <SelectContent>
                                {steps.map((s, si) => (
                                  <SelectItem key={si} value={(si + 1).toString()}>
                                    Step {si + 1}{s.title ? `: ${s.title.slice(0, 20)}` : ''}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Select
                              value={opt.color || 'gray'}
                              onValueChange={v => {
                                const current = step.decisionOptions || { options: [] };
                                const opts = [...current.options];
                                opts[oi] = { ...opts[oi], color: v };
                                updateStep(index, { decisionOptions: { ...current, options: opts } });
                              }}
                            >
                              <SelectTrigger className="w-24 h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="green">🟢 Good</SelectItem>
                                <SelectItem value="yellow">🟡 Caution</SelectItem>
                                <SelectItem value="red">🔴 Exception</SelectItem>
                                <SelectItem value="blue">🔵 Info</SelectItem>
                                <SelectItem value="gray">⚪ Neutral</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0"
                              disabled={(step.decisionOptions?.options?.length || 0) <= 2}
                              onClick={() => {
                                const current = step.decisionOptions || { options: [] };
                                const opts = current.options.filter((_, i) => i !== oi);
                                updateStep(index, { decisionOptions: { ...current, options: opts } });
                              }}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                        {(step.decisionOptions?.options?.length || 0) < 5 && (
                          <Button variant="outline" size="sm" className="text-xs gap-1"
                            onClick={() => {
                              const current = step.decisionOptions || { options: [] };
                              const opts = [...current.options, { label: '', nextStepOrder: 0, color: 'gray' }];
                              updateStep(index, { decisionOptions: { ...current, options: opts } });
                            }}>
                            <Plus className="h-3 w-3" /> Add Option
                          </Button>
                        )}
                        {(step.decisionOptions?.options || []).some(o => {
                          const target = o.nextStepOrder;
                          return target < 1 || target > steps.length;
                        }) && (
                          <div className="flex items-center gap-1 text-amber-500 text-xs">
                            <AlertTriangle className="h-3 w-3" />
                            Some options point to steps that don't exist
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-xs text-muted-foreground gap-1 h-7 px-2">
                        <BookOpen className="h-3 w-3" />
                        Training content
                        {(step.trainingDetail || step.trainingVideoUrl || step.trainingPhotoUrls.length > 0) && (
                          <Badge variant="secondary" className="text-[10px] h-4 px-1 ml-1">
                            {[step.trainingDetail && 'text', step.trainingVideoUrl && 'video', step.trainingPhotoUrls.length > 0 && `${step.trainingPhotoUrls.length} photo${step.trainingPhotoUrls.length > 1 ? 's' : ''}`].filter(Boolean).join(', ')}
                          </Badge>
                        )}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-2 space-y-3">
                      <Textarea
                        placeholder="Why this step matters (shown in training mode)..."
                        className="text-sm min-h-[50px]"
                        value={step.trainingDetail}
                        onChange={e => updateStep(index, { trainingDetail: e.target.value })}
                        rows={2}
                      />
                      <div className="space-y-1.5">
                        <Label className="text-xs flex items-center gap-1">
                          <Video className="h-3 w-3" /> Step Video URL
                        </Label>
                        <Input
                          placeholder="URL to video walkthrough for this step..."
                          className="text-sm h-8"
                          value={step.trainingVideoUrl || ''}
                          onChange={e => updateStep(index, { trainingVideoUrl: e.target.value || null })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs flex items-center gap-1">
                          <Image className="h-3 w-3" /> Reference Photos
                        </Label>
                        {step.trainingPhotoUrls.length > 0 && (
                          <div className="flex gap-2 flex-wrap">
                            {step.trainingPhotoUrls.map((url, pi) => (
                              <div key={pi} className="relative group">
                                <img src={url} alt={`Reference ${pi + 1}`} className="h-16 w-16 object-cover rounded border" />
                                <button
                                  type="button"
                                  className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full h-4 w-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={() => {
                                    const updated = step.trainingPhotoUrls.filter((_, i) => i !== pi);
                                    updateStep(index, { trainingPhotoUrls: updated });
                                  }}
                                >
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div>
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            id={`photo-upload-${step.key}`}
                            onChange={async (e) => {
                              const files = Array.from(e.target.files || []);
                              if (files.length === 0) return;
                              try {
                                const compressed = await Promise.all(files.map(f => compressImageForTraining(f)));
                                updateStep(index, {
                                  trainingPhotoUrls: [...step.trainingPhotoUrls, ...compressed],
                                });
                              } catch {
                                toast({ title: 'Error', description: 'Failed to process photos', variant: 'destructive' });
                              }
                              e.target.value = '';
                            }}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs gap-1 h-7"
                            onClick={() => document.getElementById(`photo-upload-${step.key}`)?.click()}
                          >
                            <Camera className="h-3 w-3" /> Add Photos
                          </Button>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </CardContent>
              </Card>
            );
          })}

          <Button variant="outline" className="w-full gap-2 border-dashed border-2" onClick={addStep}>
            <Plus className="h-4 w-4" />
            Add Step
          </Button>
        </div>
      </div>

      <Dialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI-Assisted SOP Builder
            </DialogTitle>
            <DialogDescription>
              Describe the procedure in your own words and MAinager will structure it into a step-by-step SOP.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Textarea
              value={aiDescription}
              onChange={e => setAiDescription(e.target.value)}
              placeholder="Example: Every morning, the first person in needs to vacuum the main floor, check that all mannequins look good, and put away any clothes from the go-back rack..."
              className="min-h-[140px] text-sm"
              maxLength={2000}
              disabled={aiGenerateMutation.isPending}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{aiDescription.length}/2000 characters</span>
              {aiDescription.length < 10 && aiDescription.length > 0 && (
                <span className="text-amber-600">At least 10 characters needed</span>
              )}
            </div>
            {aiGenerateMutation.isPending && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">MAinager is structuring your procedure...</span>
              </div>
            )}
          </div>
          <DialogFooter className="flex gap-2 sm:gap-2">
            {aiGenerateMutation.isError && (
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => aiGenerateMutation.mutate(aiDescription)}
                disabled={aiDescription.length < 10 || aiGenerateMutation.isPending}
              >
                <RefreshCw className="h-4 w-4" />
                Try Again
              </Button>
            )}
            <Button
              onClick={() => aiGenerateMutation.mutate(aiDescription)}
              disabled={aiDescription.length < 10 || aiGenerateMutation.isPending}
              className="gap-2"
            >
              {aiGenerateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate SOP
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
