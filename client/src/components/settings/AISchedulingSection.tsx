import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Trash2, Clock, DollarSign, Users, Save, UserCheck, UserX, Target, Store, Copy, Wand2, CalendarCheck, Loader2, Tag, ShieldCheck, BookOpen, X, ChevronDown } from 'lucide-react';

interface ShiftBlock {
  name: string;
  startTime: string;
  endTime: string;
}

interface StaffingTier {
  minRevenue: number;
  maxRevenue: number;
  employeeCount: number;
}

interface StoreHourEntry {
  day: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

interface CoverageRule {
  id?: string;
  ruleType: string;
  params: Record<string, string | number | boolean>;
  isEnabled: boolean;
}

interface EmployeeClassification {
  id: string;
  name: string;
  email: string | null;
  showInSchedule: boolean;
  classifications: string[];
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ABBREV = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DEFAULT_STORE_HOURS: StoreHourEntry[] = DAY_NAMES.map((_, i) => ({
  day: i,
  openTime: '09:00',
  closeTime: '21:00',
  isClosed: i === 0,
}));

const BUILT_IN_CLASSIFICATIONS = ['Opener', 'Closer', 'Key Holder', 'Trainer', 'New Hire'];

const CLASSIFICATION_COLORS: Record<string, string> = {
  'Opener': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  'Closer': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  'Key Holder': 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  'Trainer': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  'New Hire': 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300',
};

const RULE_TEMPLATES = [
  {
    ruleType: 'opening_requires_classification',
    label: 'Opening shift requires a classification',
    description: 'The first shift of the day must include at least N employees with a specific role.',
    defaultParams: { count: 1, classification: 'Key Holder' },
  },
  {
    ruleType: 'closing_requires_classification',
    label: 'Closing shift requires a classification',
    description: 'The last shift of the day must include at least N employees with a specific role.',
    defaultParams: { count: 1, classification: 'Closer' },
  },
  {
    ruleType: 'min_classification_per_shift',
    label: 'Every shift must include a classification',
    description: 'All shift blocks must have at least N employees with a specific role present.',
    defaultParams: { count: 1, classification: 'Key Holder' },
  },
  {
    ruleType: 'new_hire_paired_with_trainer',
    label: 'New Hire must be paired with a Trainer',
    description: 'Any New Hire on a shift must always be scheduled alongside at least one Trainer.',
    defaultParams: {},
  },
  {
    ruleType: 'no_clopening',
    label: 'No clopening shifts',
    description: 'Avoid scheduling the same employee to close one night and open the next morning.',
    defaultParams: {},
  },
];

function ruleDescription(rule: CoverageRule): string {
  const p = rule.params || {};
  switch (rule.ruleType) {
    case 'opening_requires_classification':
      return `Opening shift must include at least ${p.count || 1} employee with [${p.classification || 'Key Holder'}] role`;
    case 'closing_requires_classification':
      return `Closing shift must include at least ${p.count || 1} employee with [${p.classification || 'Closer'}] role`;
    case 'min_classification_per_shift':
      return `Every shift must have at least ${p.count || 1} employee with [${p.classification || 'Key Holder'}] role`;
    case 'new_hire_paired_with_trainer':
      return 'Any New Hire on a shift must be scheduled alongside at least one Trainer';
    case 'no_clopening':
      return 'Do not schedule the same employee to close one night and open the next morning';
    default:
      return rule.ruleType;
  }
}

function ClassificationBadge({ tag }: { tag: string }) {
  const colorClass = CLASSIFICATION_COLORS[tag] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${colorClass}`}>
      {tag}
    </span>
  );
}

function EmployeeClassificationRow({ employee, onUpdate }: {
  employee: EmployeeClassification;
  onUpdate: (id: string, classifications: string[]) => void;
}) {
  const [customTagInput, setCustomTagInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const toggleBuiltIn = (tag: string) => {
    const current = employee.classifications;
    const updated = current.includes(tag)
      ? current.filter(c => c !== tag)
      : [...current, tag];
    onUpdate(employee.id, updated);
  };

  const addCustomTag = () => {
    const tag = customTagInput.trim();
    if (!tag || employee.classifications.includes(tag)) {
      setCustomTagInput('');
      return;
    }
    onUpdate(employee.id, [...employee.classifications, tag]);
    setCustomTagInput('');
  };

  const removeTag = (tag: string) => {
    onUpdate(employee.id, employee.classifications.filter(c => c !== tag));
  };

  const customTags = employee.classifications.filter(c => !BUILT_IN_CLASSIFICATIONS.includes(c));

  return (
    <div className="p-3 rounded-lg bg-muted/40 space-y-2.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{employee.name}</span>
        {!employee.showInSchedule && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0">
            Back Office
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {BUILT_IN_CLASSIFICATIONS.map(tag => {
          const active = employee.classifications.includes(tag);
          const colorClass = active ? CLASSIFICATION_COLORS[tag] : 'bg-muted text-muted-foreground hover:bg-muted/80';
          return (
            <button
              key={tag}
              onClick={() => toggleBuiltIn(tag)}
              className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border transition-all ${
                active
                  ? `${colorClass} border-transparent`
                  : 'border-border hover:border-muted-foreground/40'
              }`}
            >
              {active && <span className="text-xs">✓</span>}
              {tag}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {customTags.map(tag => (
          <span key={tag} className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full border">
            {tag}
            <button onClick={() => removeTag(tag)} className="text-muted-foreground hover:text-foreground ml-0.5">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <div className="flex items-center gap-1">
          <Input
            ref={inputRef}
            value={customTagInput}
            onChange={e => setCustomTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomTag(); } }}
            placeholder="Custom skill..."
            className="h-7 text-xs w-36"
          />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={addCustomTag} disabled={!customTagInput.trim()}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function CoverageRuleRow({ rule, index, onChange, onDelete }: {
  rule: CoverageRule;
  index: number;
  onChange: (index: number, updated: CoverageRule) => void;
  onDelete: (index: number) => void;
}) {
  const template = RULE_TEMPLATES.find(t => t.ruleType === rule.ruleType);
  const hasCount = ['opening_requires_classification', 'closing_requires_classification', 'min_classification_per_shift'].includes(rule.ruleType);
  const hasClassification = ['opening_requires_classification', 'closing_requires_classification', 'min_classification_per_shift'].includes(rule.ruleType);

  return (
    <div className={`p-3 rounded-lg border transition-opacity ${rule.isEnabled ? 'bg-muted/40 border-border' : 'bg-muted/20 border-border/50 opacity-60'}`}>
      <div className="flex items-start gap-3">
        <Switch
          checked={rule.isEnabled}
          onCheckedChange={v => onChange(index, { ...rule, isEnabled: v })}
          className="mt-0.5 shrink-0"
        />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="text-sm font-medium">{template?.label || rule.ruleType}</div>
          <p className="text-xs text-muted-foreground">{ruleDescription(rule)}</p>
          <div className="flex items-center gap-2 flex-wrap">
            {hasCount && (
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground">Count:</Label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={rule.params.count || 1}
                  onChange={e => onChange(index, { ...rule, params: { ...rule.params, count: parseInt(e.target.value) || 1 } })}
                  className="h-7 w-16 text-xs"
                />
              </div>
            )}
            {hasClassification && (
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground">Role:</Label>
                <Select
                  value={rule.params.classification || 'Key Holder'}
                  onValueChange={v => onChange(index, { ...rule, params: { ...rule.params, classification: v } })}
                >
                  <SelectTrigger className="h-7 w-36 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BUILT_IN_CLASSIFICATIONS.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
          onClick={() => onDelete(index)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function AIRulesTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: classificationsData, isLoading: classLoading } = useQuery<EmployeeClassification[]>({
    queryKey: ['/api/ai-scheduling/classifications'],
  });

  const { data: rulesData, isLoading: rulesLoading } = useQuery<{ rules: CoverageRule[]; customAiInstructions: string }>({
    queryKey: ['/api/ai-scheduling/rules'],
  });

  const [localClassifications, setLocalClassifications] = useState<EmployeeClassification[]>([]);
  const [coverageRules, setCoverageRules] = useState<CoverageRule[]>([]);
  const [customInstructions, setCustomInstructions] = useState('');
  const [showRuleDropdown, setShowRuleDropdown] = useState(false);

  useEffect(() => {
    if (classificationsData) setLocalClassifications(classificationsData);
  }, [classificationsData]);

  useEffect(() => {
    if (rulesData) {
      setCoverageRules(rulesData.rules || []);
      setCustomInstructions(rulesData.customAiInstructions || '');
    }
  }, [rulesData]);

  const classificationMutation = useMutation({
    mutationFn: async ({ employeeId, classifications }: { employeeId: string; classifications: string[] }) => {
      const res = await apiRequest('PATCH', `/api/ai-scheduling/classifications/${employeeId}`, { classifications });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai-scheduling/classifications'] });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to update classifications.', variant: 'destructive' });
    },
  });

  const saveRulesMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('PUT', '/api/ai-scheduling/rules', {
        rules: coverageRules,
        customAiInstructions: customInstructions,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai-scheduling/rules'] });
      toast({ title: 'Saved', description: 'AI rules and instructions saved successfully.' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to save AI rules.', variant: 'destructive' });
    },
  });

  const handleClassificationUpdate = (id: string, classifications: string[]) => {
    setLocalClassifications(prev => prev.map(e => e.id === id ? { ...e, classifications } : e));
    classificationMutation.mutate({ employeeId: id, classifications });
  };

  const addRule = (template: typeof RULE_TEMPLATES[number]) => {
    setCoverageRules(prev => [...prev, {
      ruleType: template.ruleType,
      params: { ...template.defaultParams },
      isEnabled: true,
    }]);
    setShowRuleDropdown(false);
  };

  const updateRule = (index: number, updated: CoverageRule) => {
    setCoverageRules(prev => prev.map((r, i) => i === index ? updated : r));
  };

  const deleteRule = (index: number) => {
    setCoverageRules(prev => prev.filter((_, i) => i !== index));
  };

  if (classLoading || rulesLoading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading AI rules...</div>;
  }

  const salesFloorEmployees = localClassifications.filter(e => e.showInSchedule);
  const backOfficeEmployees = localClassifications.filter(e => !e.showInSchedule);

  return (
    <div className="space-y-6">
      {/* Employee Classifications */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Tag className="h-4 w-4" />
            Employee Scheduling Classifications
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Assign scheduling roles to each employee. The AI uses these tags to satisfy coverage rules — for example, ensuring an Opener is always present for the first shift.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {localClassifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active employees found.</p>
          ) : (
            <>
              {salesFloorEmployees.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">Sales Floor</p>
                  {salesFloorEmployees.map(emp => (
                    <EmployeeClassificationRow
                      key={emp.id}
                      employee={emp}
                      onUpdate={handleClassificationUpdate}
                    />
                  ))}
                </div>
              )}
              {backOfficeEmployees.length > 0 && (
                <div className="space-y-2 mt-4">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">Back Office (not scheduled)</p>
                  {backOfficeEmployees.map(emp => (
                    <EmployeeClassificationRow
                      key={emp.id}
                      employee={emp}
                      onUpdate={handleClassificationUpdate}
                    />
                  ))}
                </div>
              )}
            </>
          )}
          <div className="flex flex-wrap gap-2 pt-2 border-t">
            {BUILT_IN_CLASSIFICATIONS.map(tag => (
              <span key={tag} className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${CLASSIFICATION_COLORS[tag]}`}>
                {tag}
              </span>
            ))}
            <span className="text-xs text-muted-foreground self-center">+ any custom skill tags you type in</span>
          </div>
        </CardContent>
      </Card>

      {/* Coverage Rules */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Coverage Rules
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Structured rules the AI treats as hard constraints when building the schedule. Rules are satisfied after availability and target hours, but before performance score tiebreaking.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {coverageRules.length === 0 && (
            <p className="text-sm text-muted-foreground italic">No coverage rules added yet. Use the button below to add your first rule.</p>
          )}
          {coverageRules.map((rule, index) => (
            <CoverageRuleRow
              key={index}
              rule={rule}
              index={index}
              onChange={updateRule}
              onDelete={deleteRule}
            />
          ))}
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setShowRuleDropdown(v => !v)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Rule
              <ChevronDown className="h-3 w-3 ml-0.5" />
            </Button>
            {showRuleDropdown && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-popover border rounded-lg shadow-md w-80 p-1">
                {RULE_TEMPLATES.map(template => {
                  const alreadyAdded = template.ruleType === 'new_hire_paired_with_trainer' || template.ruleType === 'no_clopening'
                    ? coverageRules.some(r => r.ruleType === template.ruleType)
                    : false;
                  return (
                    <button
                      key={template.ruleType}
                      onClick={() => !alreadyAdded && addRule(template)}
                      disabled={alreadyAdded}
                      className={`w-full text-left px-3 py-2.5 rounded-md transition-colors ${
                        alreadyAdded
                          ? 'opacity-50 cursor-not-allowed'
                          : 'hover:bg-muted'
                      }`}
                    >
                      <div className="text-sm font-medium">{template.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{template.description}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Custom AI Instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            Custom AI Instructions
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Write plain-English instructions that are appended directly to the AI prompt. Use this for nuanced rules that don't fit the structured templates above.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={customInstructions}
            onChange={e => setCustomInstructions(e.target.value)}
            placeholder={`Examples:\n• Always schedule the top performer on Saturday afternoons.\n• Avoid back-to-back doubles for part-time employees.\n• Prefer scheduling Maria on morning shifts — she opens the cash registers.\n• Never schedule Alex and Jordan on the same shift.`}
            className="min-h-[160px] text-sm font-mono resize-y"
            maxLength={5000}
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              These instructions are sent verbatim to the AI. Be specific and concise.
            </p>
            <span className="text-xs text-muted-foreground tabular-nums">
              {customInstructions.length} / 5000
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={() => saveRulesMutation.mutate()}
          disabled={saveRulesMutation.isPending}
          className="gap-2"
        >
          <Save className="h-4 w-4" />
          {saveRulesMutation.isPending ? 'Saving...' : 'Save AI Rules'}
        </Button>
      </div>
    </div>
  );
}

export default function AISchedulingSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery<any>({
    queryKey: ['/api/ai-scheduling/settings'],
  });

  const [shiftBlocks, setShiftBlocks] = useState<ShiftBlock[]>([]);
  const [staffingTiers, setStaffingTiers] = useState<StaffingTier[]>([]);
  const [minimumStaffing, setMinimumStaffing] = useState(2);
  const [storeHours, setStoreHours] = useState<StoreHourEntry[]>(DEFAULT_STORE_HOURS);
  const [shiftOverlapMinutes, setShiftOverlapMinutes] = useState(60);
  const [overlapBudgetLimit, setOverlapBudgetLimit] = useState<number | null>(null);
  const [copyFromDay, setCopyFromDay] = useState<number | null>(null);
  const [copyTargets, setCopyTargets] = useState<number[]>([]);
  const [taskAutoAssign, setTaskAutoAssign] = useState(false);
  const [lastAssignResult, setLastAssignResult] = useState<{ count: number; source: string } | null>(null);

  const { data: companySettings } = useQuery<any>({
    queryKey: ['/api/company-settings'],
  });

  useEffect(() => {
    if (companySettings) {
      setTaskAutoAssign(companySettings.taskAutoAssign ?? false);
    }
  }, [companySettings]);

  const saveTaskAutoAssignMutation = useMutation({
    mutationFn: async (val: boolean) => {
      const res = await apiRequest('PUT', '/api/company-settings', {
        taskAutoAssign: val,
        expectedVersion: companySettings?.version,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/company-settings'] });
    },
    onError: () => {
      setTaskAutoAssign(companySettings?.taskAutoAssign ?? false);
      toast({ title: 'Error', description: 'Could not save setting. Please try again.', variant: 'destructive' });
    },
  });

  const assignNowMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/ai/assign-chores');
      return res.json();
    },
    onSuccess: (data: any) => {
      const count = data.assignments?.length ?? 0;
      const source = data.source === 'schedule' ? 'scheduled employees' : data.source === 'clocked-in' ? 'clocked-in employees' : 'employees';
      if (count === 0) {
        toast({ title: 'Nothing to assign', description: data.message || 'All tasks are already assigned or no employees are available.' });
        setLastAssignResult(null);
      } else {
        toast({ title: `${count} task${count !== 1 ? 's' : ''} assigned`, description: `Distributed to ${source}.` });
        setLastAssignResult({ count, source });
      }
    },
    onError: () => {
      toast({ title: 'Error', description: 'Could not auto-assign tasks. Please try again.', variant: 'destructive' });
    },
  });

  useEffect(() => {
    if (settings) {
      setShiftBlocks(settings.shiftBlocks?.length > 0 ? settings.shiftBlocks : [
        { name: "Morning", startTime: "09:00", endTime: "14:00" },
        { name: "Afternoon", startTime: "14:00", endTime: "21:00" },
      ]);
      setStaffingTiers(settings.staffingTiers?.length > 0 ? settings.staffingTiers : [
        { minRevenue: 0, maxRevenue: 2000, employeeCount: 2 },
        { minRevenue: 2001, maxRevenue: 5000, employeeCount: 3 },
        { minRevenue: 5001, maxRevenue: 10000, employeeCount: 5 },
      ]);
      setMinimumStaffing(settings.minimumStaffing ?? 2);
      setStoreHours(settings.storeHours?.length === 7 ? settings.storeHours : DEFAULT_STORE_HOURS);
      setShiftOverlapMinutes(settings.shift_overlap_minutes ?? settings.shiftOverlapMinutes ?? 60);
      const rawBudgetLimit = settings.overlapBudgetLimit ?? settings.overlap_budget_limit;
      setOverlapBudgetLimit(rawBudgetLimit ? parseFloat(rawBudgetLimit) : null);
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('PUT', '/api/ai-scheduling/settings', { shiftBlocks, staffingTiers, minimumStaffing, storeHours, shiftOverlapMinutes, overlapBudgetLimit });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai-scheduling/settings'] });
      toast({ title: "Saved", description: "AI scheduling settings updated successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
    },
  });

  const updateStoreHour = (dayIndex: number, field: keyof StoreHourEntry, value: any) => {
    const updated = [...storeHours];
    updated[dayIndex] = { ...updated[dayIndex], [field]: value };
    setStoreHours(updated);
  };

  const handleCopyHours = () => {
    if (copyFromDay === null || copyTargets.length === 0) return;
    const source = storeHours[copyFromDay];
    const updated = [...storeHours];
    copyTargets.forEach(targetDay => {
      updated[targetDay] = { ...updated[targetDay], openTime: source.openTime, closeTime: source.closeTime, isClosed: source.isClosed };
    });
    setStoreHours(updated);
    setCopyFromDay(null);
    setCopyTargets([]);
    toast({ title: "Copied", description: `${DAY_NAMES[copyFromDay]} hours copied to ${copyTargets.map(d => DAY_ABBREV[d]).join(', ')}.` });
  };

  const addShiftBlock = () => {
    setShiftBlocks([...shiftBlocks, { name: "", startTime: "09:00", endTime: "17:00" }]);
  };

  const removeShiftBlock = (index: number) => {
    setShiftBlocks(shiftBlocks.filter((_, i) => i !== index));
  };

  const updateShiftBlock = (index: number, field: keyof ShiftBlock, value: string) => {
    const updated = [...shiftBlocks];
    updated[index] = { ...updated[index], [field]: value };
    setShiftBlocks(updated);
  };

  const addStaffingTier = () => {
    const lastTier = staffingTiers[staffingTiers.length - 1];
    const newMin = lastTier ? lastTier.maxRevenue + 1 : 0;
    setStaffingTiers([...staffingTiers, { minRevenue: newMin, maxRevenue: newMin + 5000, employeeCount: 2 }]);
  };

  const removeStaffingTier = (index: number) => {
    setStaffingTiers(staffingTiers.filter((_, i) => i !== index));
  };

  const updateStaffingTier = (index: number, field: keyof StaffingTier, value: number) => {
    const updated = [...staffingTiers];
    updated[index] = { ...updated[index], [field]: value };
    setStaffingTiers(updated);
  };

  interface RosterEmployee {
    id: string;
    name: string;
    email: string;
    employmentType: string;
    roleName: string;
    showInSchedule: boolean;
    targetWeeklyHours: number | null;
  }

  const { data: roster, isLoading: rosterLoading } = useQuery<RosterEmployee[]>({
    queryKey: ['/api/ai-scheduling/roster'],
  });

  const rosterMutation = useMutation({
    mutationFn: async ({ employeeId, data }: { employeeId: string; data: { showInSchedule?: boolean; targetWeeklyHours?: number | null } }) => {
      return apiRequest('PUT', `/api/ai-scheduling/roster/${employeeId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai-scheduling/roster'] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update employee.", variant: "destructive" });
    },
  });

  if (isLoading) {
    return <div className="p-4">Loading settings...</div>;
  }

  const settingsContent = (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Store className="h-4 w-4" />
            Store Hours
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Set your store's operating hours for each day of the week. The AI will only schedule shifts within these hours.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {storeHours.map((entry, index) => (
            <div key={index} className={`flex items-center gap-3 p-3 rounded-lg ${entry.isClosed ? 'bg-muted/20 opacity-60' : 'bg-muted/50'}`}>
              <div className="w-24 font-medium text-sm">{DAY_NAMES[index]}</div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={!entry.isClosed}
                  onCheckedChange={(open) => updateStoreHour(index, 'isClosed', !open)}
                />
                <span className="text-xs text-muted-foreground w-12">{entry.isClosed ? 'Closed' : 'Open'}</span>
              </div>
              {!entry.isClosed && (
                <>
                  <div className="flex items-center gap-2">
                    <Input
                      type="time"
                      value={entry.openTime}
                      onChange={(e) => updateStoreHour(index, 'openTime', e.target.value)}
                      className="h-8 w-32"
                    />
                    <span className="text-sm text-muted-foreground">to</span>
                    <Input
                      type="time"
                      value={entry.closeTime}
                      onChange={(e) => updateStoreHour(index, 'closeTime', e.target.value)}
                      className="h-8 w-32"
                    />
                  </div>
                </>
              )}
            </div>
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1 mt-2">
                <Copy className="h-3 w-3" /> Copy Hours to Other Days
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72" align="start">
              <div className="space-y-3">
                <div>
                  <Label className="text-xs font-medium">Copy from</Label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {DAY_ABBREV.map((name, i) => (
                      <Button
                        key={i}
                        variant={copyFromDay === i ? "default" : "outline"}
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => { setCopyFromDay(i); setCopyTargets([]); }}
                      >
                        {name}
                      </Button>
                    ))}
                  </div>
                </div>
                {copyFromDay !== null && (
                  <>
                    <Separator />
                    <div>
                      <Label className="text-xs font-medium">
                        Copy to ({storeHours[copyFromDay].isClosed ? 'Closed' : `${storeHours[copyFromDay].openTime} - ${storeHours[copyFromDay].closeTime}`})
                      </Label>
                      <div className="space-y-1.5 mt-1.5">
                        {DAY_NAMES.map((name, i) => {
                          if (i === copyFromDay) return null;
                          return (
                            <label key={i} className="flex items-center gap-2 cursor-pointer">
                              <Checkbox
                                checked={copyTargets.includes(i)}
                                onCheckedChange={(checked) => {
                                  setCopyTargets(prev => checked ? [...prev, i] : prev.filter(d => d !== i));
                                }}
                              />
                              <span className="text-sm">{name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      disabled={copyTargets.length === 0}
                      onClick={handleCopyHours}
                      className="w-full gap-1"
                    >
                      <Copy className="h-3 w-3" />
                      Copy to {copyTargets.length} day{copyTargets.length !== 1 ? 's' : ''}
                    </Button>
                  </>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <UserCheck className="h-4 w-4" />
            Sales Floor Roster
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Toggle employees between <strong>Sales Floor</strong> (included in AI shift suggestions) and <strong>Back Office</strong> (never scheduled on the floor). Set target weekly hours so the AI prioritizes getting full-time employees to their goal.
          </p>
        </CardHeader>
        <CardContent>
          {rosterLoading ? (
            <div className="text-sm text-muted-foreground">Loading employees...</div>
          ) : !roster || roster.length === 0 ? (
            <div className="text-sm text-muted-foreground">No active employees found.</div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 text-xs font-medium text-muted-foreground px-3 pb-1">
                <div>Employee</div>
                <div className="text-center w-24">Sales Floor</div>
                <div className="text-center w-28">Target Hrs/Wk</div>
                <div className="w-8"></div>
              </div>
              {roster.map((emp) => (
                <div key={emp.id} className={`grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center p-3 rounded-lg ${emp.showInSchedule ? 'bg-muted/50' : 'bg-muted/20 opacity-60'}`}>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{emp.name}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {emp.roleName}
                      </Badge>
                      {!emp.showInSchedule && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0">
                          Back Office
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{emp.email} · {emp.employmentType || 'Not set'}</div>
                  </div>
                  <div className="flex justify-center w-24">
                    <Switch
                      checked={emp.showInSchedule}
                      onCheckedChange={(checked) => {
                        rosterMutation.mutate({ employeeId: emp.id, data: { showInSchedule: checked } });
                      }}
                    />
                  </div>
                  <div className="w-28">
                    {emp.showInSchedule ? (
                      <Input
                        type="number"
                        min={0}
                        max={80}
                        step={0.5}
                        placeholder="None"
                        defaultValue={emp.targetWeeklyHours ?? ''}
                        onBlur={(e) => {
                          const val = e.target.value === '' ? null : parseFloat(e.target.value);
                          if (val !== emp.targetWeeklyHours) {
                            rosterMutation.mutate({ employeeId: emp.id, data: { targetWeeklyHours: val } });
                          }
                        }}
                        className="h-8 text-sm"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <UserX className="h-3 w-3" /> Back Office
                      </span>
                    )}
                  </div>
                  <div className="w-8">
                    {emp.targetWeeklyHours && emp.showInSchedule && (
                      <Target className="h-4 w-4 text-blue-500" />
                    )}
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground mt-2 px-1">
                Employees with <strong>Sales Floor</strong> off are marked <strong>Back Office</strong> and never appear in AI shift suggestions.
                Target hours tell the AI to prioritize giving that employee enough shifts to reach their weekly goal.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Shift Blocks
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Define the time slots your store operates. The AI will assign employees to these blocks.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {shiftBlocks.map((block, index) => (
            <div key={index} className="flex items-end gap-3 p-3 bg-muted/50 rounded-lg">
              <div className="flex-1">
                <Label className="text-xs">Block Name</Label>
                <Input
                  value={block.name}
                  onChange={(e) => updateShiftBlock(index, 'name', e.target.value)}
                  placeholder="e.g., Morning"
                />
              </div>
              <div className="w-32">
                <Label className="text-xs">Start</Label>
                <Input
                  type="time"
                  value={block.startTime}
                  onChange={(e) => updateShiftBlock(index, 'startTime', e.target.value)}
                />
              </div>
              <div className="w-32">
                <Label className="text-xs">End</Label>
                <Input
                  type="time"
                  value={block.endTime}
                  onChange={(e) => updateShiftBlock(index, 'endTime', e.target.value)}
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeShiftBlock(index)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addShiftBlock} className="gap-1">
            <Plus className="h-3 w-3" /> Add Shift Block
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Staffing Tiers
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Set how many employees should be scheduled based on predicted daily sales revenue.
            The AI uses last year's sales data (matched by day of week) to predict revenue for each day.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 text-xs font-medium text-muted-foreground px-3">
            <div>Min Revenue</div>
            <div>Max Revenue</div>
            <div>Staff Needed</div>
            <div></div>
          </div>
          {staffingTiers.map((tier, index) => (
            <div key={index} className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <div className="flex-1">
                <div className="flex items-center gap-1">
                  <span className="text-sm text-muted-foreground">$</span>
                  <Input
                    type="number"
                    value={tier.minRevenue}
                    onChange={(e) => updateStaffingTier(index, 'minRevenue', parseInt(e.target.value) || 0)}
                    className="h-8"
                  />
                </div>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-1">
                  <span className="text-sm text-muted-foreground">$</span>
                  <Input
                    type="number"
                    value={tier.maxRevenue}
                    onChange={(e) => updateStaffingTier(index, 'maxRevenue', parseInt(e.target.value) || 0)}
                    className="h-8"
                  />
                </div>
              </div>
              <div className="w-20">
                <Input
                  type="number"
                  min={1}
                  value={tier.employeeCount}
                  onChange={(e) => updateStaffingTier(index, 'employeeCount', parseInt(e.target.value) || 1)}
                  className="h-8"
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeStaffingTier(index)}
                className="text-destructive hover:text-destructive h-8 w-8"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addStaffingTier} className="gap-1">
            <Plus className="h-3 w-3" /> Add Tier
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Minimum Staffing
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            The absolute minimum number of employees that must be scheduled at any time, regardless of sales predictions.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Label>Minimum employees per shift</Label>
            <Input
              type="number"
              min={1}
              value={minimumStaffing}
              onChange={(e) => setMinimumStaffing(parseInt(e.target.value) || 1)}
              className="w-20"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Shift Handoff & 3S
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            MAinager schedules overlap between shifts so your team has time for briefing and 3S (Sweep, Sort, Standardize). This is where handoffs happen and your team learns to see waste.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-sm font-medium mb-2 block">Overlap duration</Label>
            <div className="flex gap-2">
              {[30, 45, 60].map((mins) => (
                <button
                  key={mins}
                  onClick={() => setShiftOverlapMinutes(mins)}
                  className={`px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                    shiftOverlapMinutes === mins
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-muted hover:border-muted-foreground/30"
                  }`}
                >
                  {mins} min
                </button>
              ))}
            </div>
          </div>
          <Separator />
          <div className="flex items-center gap-3">
            <Switch
              checked={overlapBudgetLimit !== null}
              onCheckedChange={(checked) => setOverlapBudgetLimit(checked ? 500 : null)}
            />
            <div className="flex-1">
              <Label className="text-sm font-medium">Budget warning</Label>
              <p className="text-xs text-muted-foreground">Alert me if overlap hours push labor costs above a weekly limit</p>
            </div>
          </div>
          {overlapBudgetLimit !== null && (
            <div className="flex items-center gap-2 pl-12">
              <span className="text-sm font-medium">$</span>
              <Input
                type="number"
                min={0}
                step={50}
                value={overlapBudgetLimit}
                onChange={(e) => setOverlapBudgetLimit(parseFloat(e.target.value) || 0)}
                className="w-28"
              />
              <span className="text-sm text-muted-foreground">per week</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Daily task auto-assignment ─────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Wand2 className="h-4 w-4" />
                Daily task auto-assignment
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Automatically distribute today's unassigned tasks each morning.
              </p>
            </div>
            <Switch
              checked={taskAutoAssign}
              disabled={saveTaskAutoAssignMutation.isPending}
              onCheckedChange={(val) => {
                setTaskAutoAssign(val);
                saveTaskAutoAssignMutation.mutate(val);
              }}
              aria-label="Toggle daily task auto-assignment"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl bg-muted/50 p-3 space-y-2">
            <div className="flex items-start gap-2.5">
              <CalendarCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-foreground">Scheduled workers first</p>
                <p className="text-xs text-muted-foreground">Tasks are distributed among team members who have a shift today.</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Users className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-foreground">Falls back to clocked-in</p>
                <p className="text-xs text-muted-foreground">If nobody is scheduled, tasks go to whoever is already clocked in.</p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {taskAutoAssign
                ? 'Auto-assignment runs each morning and whenever a new unassigned task is created.'
                : 'Auto-assignment is off — you assign tasks manually.'}
            </p>
            <Badge variant={taskAutoAssign ? 'default' : 'outline'} className="text-xs shrink-0">
              {taskAutoAssign ? 'Auto' : 'Manual'}
            </Badge>
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Assign today's tasks now</p>
              <p className="text-xs text-muted-foreground">Run assignment immediately without waiting for the morning cron.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => assignNowMutation.mutate()}
              disabled={assignNowMutation.isPending}
              className="shrink-0 gap-1.5"
            >
              {assignNowMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Wand2 className="h-3.5 w-3.5" />}
              {assignNowMutation.isPending ? 'Assigning…' : 'Assign Now'}
            </Button>
          </div>

          {lastAssignResult && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
              <Wand2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
              <span>
                <span className="font-semibold text-green-700 dark:text-green-400">{lastAssignResult.count} task{lastAssignResult.count !== 1 ? 's' : ''}</span> assigned to {lastAssignResult.source}.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="gap-2"
        >
          <Save className="h-4 w-4" />
          {saveMutation.isPending ? "Saving..." : "Save AI Scheduling Settings"}
        </Button>
      </div>
    </div>
  );

  return (
    <Tabs defaultValue="settings" className="w-full">
      <TabsList className="mb-6">
        <TabsTrigger value="settings">Settings</TabsTrigger>
        <TabsTrigger value="ai-rules">AI Rules</TabsTrigger>
      </TabsList>
      <TabsContent value="settings">
        {settingsContent}
      </TabsContent>
      <TabsContent value="ai-rules">
        <AIRulesTab />
      </TabsContent>
    </Tabs>
  );
}
