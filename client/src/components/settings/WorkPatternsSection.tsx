import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { CalendarDays, Copy, Wand2 } from 'lucide-react';

type DayStatus = 'required' | 'available' | 'preferred_off' | 'hard_off';

interface PatternEntry {
  day: number;
  status: DayStatus;
}

interface EmployeePattern {
  id: string;
  name: string;
  roleName: string;
  patterns: Array<{ dayOfWeek: number; status: string; templateId?: string }>;
}

interface Template {
  id: string;
  name: string;
  description: string;
  pattern: PatternEntry[];
}

const DAY_ABBREV = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STATUS_COLORS: Record<DayStatus, string> = {
  required: 'bg-green-500 hover:bg-green-600 text-white',
  available: 'bg-blue-100 hover:bg-blue-200 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  preferred_off: 'bg-amber-100 hover:bg-amber-200 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  hard_off: 'bg-red-100 hover:bg-red-200 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

const STATUS_LABELS: Record<DayStatus, string> = {
  required: 'REQ',
  available: 'AVL',
  preferred_off: 'PREF',
  hard_off: 'OFF',
};

const STATUS_FULL_LABELS: Record<DayStatus, string> = {
  required: 'Required',
  available: 'Available',
  preferred_off: 'Prefer Off',
  hard_off: 'Day Off',
};

const STATUS_CYCLE: DayStatus[] = ['available', 'required', 'preferred_off', 'hard_off'];

const DEFAULT_PATTERN: PatternEntry[] = Array.from({ length: 7 }, (_, i) => ({ day: i, status: 'available' as DayStatus }));

export default function WorkPatternsSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: employees, isLoading } = useQuery<EmployeePattern[]>({
    queryKey: ['/api/ai-scheduling/work-patterns'],
  });

  const { data: templates } = useQuery<Template[]>({
    queryKey: ['/api/ai-scheduling/work-pattern-templates'],
  });

  const [localPatterns, setLocalPatterns] = useState<Record<string, PatternEntry[]>>({});
  const [copySource, setCopySource] = useState<string | null>(null);
  const [copyTargets, setCopyTargets] = useState<string[]>([]);

  useEffect(() => {
    if (employees) {
      const patterns: Record<string, PatternEntry[]> = {};
      for (const emp of employees) {
        if (emp.patterns.length === 7) {
          patterns[emp.id] = emp.patterns.map(p => ({
            day: p.dayOfWeek,
            status: p.status as DayStatus,
          })).sort((a, b) => a.day - b.day);
        } else {
          patterns[emp.id] = [...DEFAULT_PATTERN];
        }
      }
      setLocalPatterns(patterns);
    }
  }, [employees]);

  const saveMutation = useMutation({
    mutationFn: async ({ employeeId, patterns, templateId }: { employeeId: string; patterns: PatternEntry[]; templateId?: string }) => {
      return apiRequest('PUT', `/api/ai-scheduling/work-patterns/${employeeId}`, { patterns, templateId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai-scheduling/work-patterns'] });
      toast({ title: "Saved", description: "Work pattern updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save work pattern.", variant: "destructive" });
    },
  });

  const bulkMutation = useMutation({
    mutationFn: async ({ employeeIds, patterns, templateId }: { employeeIds: string[]; patterns: PatternEntry[]; templateId?: string }) => {
      return apiRequest('POST', '/api/ai-scheduling/work-patterns/bulk-apply', { employeeIds, patterns, templateId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai-scheduling/work-patterns'] });
      setCopySource(null);
      setCopyTargets([]);
      toast({ title: "Copied", description: "Work pattern applied to selected employees." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to apply pattern.", variant: "destructive" });
    },
  });

  const toggleDay = (employeeId: string, dayIndex: number) => {
    setLocalPatterns(prev => {
      const current = prev[employeeId] || [...DEFAULT_PATTERN];
      const currentStatus = current[dayIndex].status;
      const nextIndex = (STATUS_CYCLE.indexOf(currentStatus) + 1) % STATUS_CYCLE.length;
      const updated = [...current];
      updated[dayIndex] = { ...updated[dayIndex], status: STATUS_CYCLE[nextIndex] };
      return { ...prev, [employeeId]: updated };
    });
  };

  const applyTemplate = (employeeId: string, templateId: string) => {
    const template = templates?.find(t => t.id === templateId);
    if (!template) return;
    setLocalPatterns(prev => ({
      ...prev,
      [employeeId]: template.pattern.map(p => ({ day: p.day, status: p.status })).sort((a, b) => a.day - b.day),
    }));
  };

  const savePattern = (employeeId: string) => {
    const patterns = localPatterns[employeeId];
    if (patterns) {
      saveMutation.mutate({ employeeId, patterns });
    }
  };

  const handleCopyPattern = () => {
    if (!copySource || copyTargets.length === 0) return;
    const sourcePatterns = localPatterns[copySource];
    if (!sourcePatterns) return;
    bulkMutation.mutate({ employeeIds: copyTargets, patterns: sourcePatterns });
  };

  const hasChanges = (employeeId: string) => {
    const emp = employees?.find(e => e.id === employeeId);
    const local = localPatterns[employeeId];
    if (!emp || !local) return false;
    if (emp.patterns.length !== 7) return local.some(p => p.status !== 'available');
    return emp.patterns.some(p => {
      const localDay = local.find(l => l.day === p.dayOfWeek);
      return localDay && localDay.status !== p.status;
    });
  };

  if (isLoading) {
    return <div className="p-4">Loading work patterns...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarDays className="h-4 w-4" />
          Employee Work Patterns
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Set each employee's recurring weekly schedule. Click a day cell to cycle through statuses.
          The AI scheduler enforces these as strict rules — "Day Off" employees will never be scheduled, "Required" employees will always be scheduled.
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          {STATUS_CYCLE.map(status => (
            <div key={status} className="flex items-center gap-1.5">
              <div className={`w-3 h-3 rounded ${STATUS_COLORS[status].split(' ')[0]}`} />
              <span className="text-xs text-muted-foreground">{STATUS_FULL_LABELS[status]}</span>
            </div>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="grid grid-cols-[1fr_repeat(7,minmax(42px,1fr))_auto] gap-1 text-xs font-medium text-muted-foreground px-1 pb-2">
          <div>Employee</div>
          {DAY_ABBREV.map(d => (
            <div key={d} className="text-center">{d}</div>
          ))}
          <div className="w-[120px]"></div>
        </div>

        {employees?.map(emp => {
          const pattern = localPatterns[emp.id] || DEFAULT_PATTERN;
          const changed = hasChanges(emp.id);

          return (
            <div key={emp.id} className="grid grid-cols-[1fr_repeat(7,minmax(42px,1fr))_auto] gap-1 items-center p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{emp.name}</div>
                <Badge variant="outline" className="text-[10px] px-1 py-0">{emp.roleName}</Badge>
              </div>
              {pattern.map((p, dayIdx) => (
                <button
                  key={dayIdx}
                  onClick={() => toggleDay(emp.id, dayIdx)}
                  className={`h-9 rounded-md text-xs font-semibold transition-all cursor-pointer select-none ${STATUS_COLORS[p.status]}`}
                  title={`${DAY_ABBREV[dayIdx]}: ${STATUS_FULL_LABELS[p.status]} — click to change`}
                >
                  {STATUS_LABELS[p.status]}
                </button>
              ))}
              <div className="flex items-center gap-1 w-[120px]">
                {templates && templates.length > 0 && (
                  <Select onValueChange={(val) => applyTemplate(emp.id, val)}>
                    <SelectTrigger className="h-7 text-[10px] w-[70px]">
                      <Wand2 className="h-3 w-3" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map(t => (
                        <SelectItem key={t.id} value={t.id}>
                          <div>
                            <div className="text-xs font-medium">{t.name}</div>
                            {t.description && <div className="text-[10px] text-muted-foreground">{t.description}</div>}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  size="sm"
                  variant={changed ? "default" : "ghost"}
                  className="h-7 text-[10px] px-2"
                  disabled={!changed || saveMutation.isPending}
                  onClick={() => savePattern(emp.id)}
                >
                  {saveMutation.isPending ? '...' : 'Save'}
                </Button>
              </div>
            </div>
          );
        })}

        <div className="pt-3 flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1">
                <Copy className="h-3 w-3" /> Copy Pattern to Others
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72" align="start">
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-medium mb-1.5">Copy from</p>
                  <Select onValueChange={(val) => { setCopySource(val); setCopyTargets([]); }}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Select employee..." />
                    </SelectTrigger>
                    <SelectContent>
                      {employees?.map(emp => (
                        <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {copySource && (
                  <>
                    <div>
                      <p className="text-xs font-medium mb-1.5">Apply to</p>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {employees?.filter(e => e.id !== copySource).map(emp => (
                          <label key={emp.id} className="flex items-center gap-2 cursor-pointer">
                            <Checkbox
                              checked={copyTargets.includes(emp.id)}
                              onCheckedChange={(checked) => {
                                setCopyTargets(prev => checked ? [...prev, emp.id] : prev.filter(id => id !== emp.id));
                              }}
                            />
                            <span className="text-sm">{emp.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      disabled={copyTargets.length === 0 || bulkMutation.isPending}
                      onClick={handleCopyPattern}
                      className="w-full"
                    >
                      Apply to {copyTargets.length} employee{copyTargets.length !== 1 ? 's' : ''}
                    </Button>
                  </>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </CardContent>
    </Card>
  );
}
