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
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';
import {
  ArrowLeft, Plus, Trash2, GripVertical, Save, Loader2,
  CheckCircle2, Eye, Camera, GitBranch, Timer, ChevronDown, BookOpen, AlertTriangle
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
  decisionOptions: { options: { label: string; nextStepOrder: number }[] } | null;
  trainingDetail: string;
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
  };
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
  const [storeId, setStoreId] = useState('');
  const [steps, setSteps] = useState<StepForm[]>([makeEmptyStep()]);
  const [showTraining, setShowTraining] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

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
        steps: steps.map(s => ({
          title: s.title,
          description: s.description || null,
          stepType: s.stepType,
          isCheckpoint: s.isCheckpoint,
          timerDurationSeconds: s.stepType === 'timer' ? s.timerDurationSeconds : null,
          decisionOptions: s.stepType === 'decision' ? s.decisionOptions : null,
          trainingDetail: s.trainingDetail || null,
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

            <Collapsible open={showTraining} onOpenChange={setShowTraining}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
                  <BookOpen className="h-4 w-4" />
                  Training Mode Context — Why We Do This
                  <ChevronDown className={`h-3 w-3 transition-transform ${showTraining ? 'rotate-180' : ''}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <Textarea
                  placeholder="Explain the purpose of this procedure for training mode..."
                  value={trainingNotes}
                  onChange={e => setTrainingNotes(e.target.value)}
                  rows={3}
                />
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
          </div>

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
                    <div className="space-y-2">
                      <Label className="text-xs">Decision Options</Label>
                      {(step.decisionOptions?.options || []).map((opt, oi) => (
                        <div key={oi} className="flex gap-2 items-center">
                          <Input
                            placeholder="Option label"
                            value={opt.label}
                            className="flex-1 h-8 text-sm"
                            onChange={e => {
                              const opts = [...(step.decisionOptions?.options || [])];
                              opts[oi] = { ...opts[oi], label: e.target.value };
                              updateStep(index, { decisionOptions: { options: opts } });
                            }}
                          />
                          <Input
                            type="number"
                            placeholder="Go to step #"
                            value={opt.nextStepOrder?.toString() || ''}
                            className="w-28 h-8 text-sm"
                            onChange={e => {
                              const opts = [...(step.decisionOptions?.options || [])];
                              opts[oi] = { ...opts[oi], nextStepOrder: parseInt(e.target.value) || 0 };
                              updateStep(index, { decisionOptions: { options: opts } });
                            }}
                          />
                          <Button variant="ghost" size="icon" className="h-8 w-8"
                            onClick={() => {
                              const opts = (step.decisionOptions?.options || []).filter((_, i) => i !== oi);
                              updateStep(index, { decisionOptions: { options: opts } });
                            }}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                      <Button variant="outline" size="sm" className="text-xs gap-1"
                        onClick={() => {
                          const opts = [...(step.decisionOptions?.options || []), { label: '', nextStepOrder: 0 }];
                          updateStep(index, { decisionOptions: { options: opts } });
                        }}>
                        <Plus className="h-3 w-3" /> Add Option
                      </Button>
                    </div>
                  )}

                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-xs text-muted-foreground gap-1 h-7 px-2">
                        <BookOpen className="h-3 w-3" />
                        Training detail
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-1">
                      <Textarea
                        placeholder="Why this step matters (shown in training mode)..."
                        className="text-sm min-h-[50px]"
                        value={step.trainingDetail}
                        onChange={e => updateStep(index, { trainingDetail: e.target.value })}
                        rows={2}
                      />
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
    </div>
  );
}
