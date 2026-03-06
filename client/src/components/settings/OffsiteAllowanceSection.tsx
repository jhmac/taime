import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, invalidatePrefix } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { MapPin, Plus, Pencil, Trash2, Clock, Bell, Users, Shield } from 'lucide-react';
import type { OffsiteAllowanceRule, WorkLocation, User } from '@shared/schema';

const ALLOWED_MINUTES_OPTIONS = [
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '45 minutes', value: 45 },
  { label: '60 minutes', value: 60 },
];

interface RuleFormData {
  name: string;
  locationId: string;
  allowedMinutes: number;
  customAllowedMinutes: number;
  useCustomMinutes: boolean;
  allowedTimeStart: string;
  allowedTimeEnd: string;
  allDay: boolean;
  appliesTo: string;
  specificEmployeeIds: string[];
  alertAfterMinutes: number;
  alertRecipients: string;
  customAlertUserIds: string[];
}

const defaultFormData: RuleFormData = {
  name: '',
  locationId: '',
  allowedMinutes: 30,
  customAllowedMinutes: 30,
  useCustomMinutes: false,
  allowedTimeStart: '10:00',
  allowedTimeEnd: '14:00',
  allDay: false,
  appliesTo: 'all',
  specificEmployeeIds: [],
  alertAfterMinutes: 20,
  alertRecipients: 'both',
  customAlertUserIds: [],
};

export default function OffsiteAllowanceSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<OffsiteAllowanceRule | null>(null);
  const [deleteRuleId, setDeleteRuleId] = useState<string | null>(null);
  const [formData, setFormData] = useState<RuleFormData>(defaultFormData);

  const { data: locations = [] } = useQuery<WorkLocation[]>({
    queryKey: ['/api/work-locations'],
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['/api/users'],
  });

  const selectedLocationId = locations.length > 0 ? (formData.locationId || locations[0]?.id || '') : '';

  const { data: rules = [], isLoading } = useQuery<OffsiteAllowanceRule[]>({
    queryKey: [`/api/offsite-rules?locationId=${locations[0]?.id}`],
    enabled: locations.length > 0,
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/offsite-rules', data);
      return res.json();
    },
    onSuccess: () => {
      invalidatePrefix('/api/offsite-rules');
      resetForm();
      toast({ title: 'Rule Created', description: 'Off-site allowance rule has been created.' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message || 'Failed to create rule.', variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const res = await apiRequest('PATCH', `/api/offsite-rules/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      invalidatePrefix('/api/offsite-rules');
      resetForm();
      toast({ title: 'Rule Updated', description: 'Off-site allowance rule has been updated.' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message || 'Failed to update rule.', variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/offsite-rules/${id}`);
      return res.json();
    },
    onSuccess: () => {
      invalidatePrefix('/api/offsite-rules');
      setDeleteRuleId(null);
      toast({ title: 'Rule Deleted', description: 'Off-site allowance rule has been removed.' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message || 'Failed to delete rule.', variant: 'destructive' });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await apiRequest('PATCH', `/api/offsite-rules/${id}`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      invalidatePrefix('/api/offsite-rules');
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message || 'Failed to toggle rule.', variant: 'destructive' });
    },
  });

  const resetForm = () => {
    setFormData(defaultFormData);
    setEditingRule(null);
    setShowForm(false);
  };

  const openEditForm = (rule: OffsiteAllowanceRule) => {
    const isPreset = ALLOWED_MINUTES_OPTIONS.some(o => o.value === rule.allowedMinutes);
    setEditingRule(rule);
    setFormData({
      name: rule.name,
      locationId: rule.locationId,
      allowedMinutes: isPreset ? rule.allowedMinutes : 30,
      customAllowedMinutes: rule.allowedMinutes,
      useCustomMinutes: !isPreset,
      allowedTimeStart: rule.allowedTimeStart || '10:00',
      allowedTimeEnd: rule.allowedTimeEnd || '14:00',
      allDay: !rule.allowedTimeStart && !rule.allowedTimeEnd,
      appliesTo: rule.appliesTo,
      specificEmployeeIds: (rule.specificEmployeeIds as string[]) || [],
      alertAfterMinutes: rule.alertAfterMinutes || 20,
      alertRecipients: rule.alertRecipients,
      customAlertUserIds: (rule.customAlertUserIds as string[]) || [],
    });
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!formData.name.trim()) {
      toast({ title: 'Validation Error', description: 'Rule name is required.', variant: 'destructive' });
      return;
    }

    const locationId = formData.locationId || locations[0]?.id;
    if (!locationId) {
      toast({ title: 'Validation Error', description: 'A work location is required.', variant: 'destructive' });
      return;
    }

    const minutes = formData.useCustomMinutes ? formData.customAllowedMinutes : formData.allowedMinutes;

    const payload: any = {
      name: formData.name.trim(),
      locationId,
      allowedMinutes: minutes,
      allowedTimeStart: formData.allDay ? null : formData.allowedTimeStart,
      allowedTimeEnd: formData.allDay ? null : formData.allowedTimeEnd,
      appliesTo: formData.appliesTo,
      specificEmployeeIds: formData.appliesTo === 'specific_employees' ? formData.specificEmployeeIds : null,
      alertAfterMinutes: formData.alertAfterMinutes,
      alertRecipients: formData.alertRecipients,
      customAlertUserIds: formData.alertRecipients === 'custom' ? formData.customAlertUserIds : null,
      isActive: true,
    };

    if (editingRule) {
      updateMutation.mutate({ id: editingRule.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const formatTime12h = (time24: string | null) => {
    if (!time24) return '';
    const [h, m] = time24.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${m.toString().padStart(2, '0')} ${period}`;
  };

  const getAppliesToLabel = (appliesTo: string) => {
    switch (appliesTo) {
      case 'all': return 'All employees';
      case 'managers_only': return 'Managers only';
      case 'specific_employees': return 'Specific employees';
      default: return appliesTo;
    }
  };

  const activeUsers = users.filter((u: User) => u.isActive !== false);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          Configure rules for when employees are allowed to leave the geofenced work area without triggering an auto clock-out.
          Common scenarios include bank deposit runs, lunch errands, or supply pickups.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{rules.length} rule{rules.length !== 1 ? 's' : ''} configured</span>
        </div>
        <Button size="sm" onClick={() => { resetForm(); setShowForm(true); }}>
          <Plus className="w-4 h-4 mr-1" />
          Add Rule
        </Button>
      </div>

      {rules.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <MapPin className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium">No off-site rules configured</p>
            <p className="text-xs text-muted-foreground mt-1">
              Create your first rule to allow employees to leave the work area for specific tasks without triggering clock-out.
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => { resetForm(); setShowForm(true); }}>
              <Plus className="w-4 h-4 mr-1" /> Create Rule
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <Card key={rule.id} className={rule.isActive ? '' : 'opacity-60'}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">{rule.name}</span>
                      <Badge variant={rule.isActive ? 'default' : 'secondary'} className="text-xs">
                        {rule.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {rule.allowedMinutes} min allowed
                      </span>
                      <span className="flex items-center gap-1">
                        <Bell className="w-3 h-3" />
                        Alert after {rule.alertAfterMinutes} min
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {getAppliesToLabel(rule.appliesTo)}
                      </span>
                      {rule.allowedTimeStart && rule.allowedTimeEnd ? (
                        <span>
                          {formatTime12h(rule.allowedTimeStart)} – {formatTime12h(rule.allowedTimeEnd)}
                        </span>
                      ) : (
                        <span>All day</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Switch
                      checked={rule.isActive ?? true}
                      onCheckedChange={(checked) => toggleActiveMutation.mutate({ id: rule.id, isActive: checked })}
                    />
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditForm(rule)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteRuleId(rule.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={(open) => { if (!open) resetForm(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRule ? 'Edit Rule' : 'New Off-Site Allowance Rule'}</DialogTitle>
            <DialogDescription>
              Define when and how long employees can leave the work area.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label htmlFor="rule-name">Rule Name</Label>
              <Input
                id="rule-name"
                placeholder="e.g., Bank deposit run"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>

            {locations.length > 1 && (
              <div className="space-y-2">
                <Label>Location</Label>
                <Select
                  value={formData.locationId || locations[0]?.id || ''}
                  onValueChange={(val) => setFormData(prev => ({ ...prev, locationId: val }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map(loc => (
                      <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <Separator />

            <div className="space-y-2">
              <Label>Allowed Time Outside</Label>
              {!formData.useCustomMinutes ? (
                <div className="flex flex-wrap gap-2">
                  {ALLOWED_MINUTES_OPTIONS.map(opt => (
                    <Button
                      key={opt.value}
                      variant={formData.allowedMinutes === opt.value ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setFormData(prev => ({ ...prev, allowedMinutes: opt.value }))}
                    >
                      {opt.label}
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFormData(prev => ({ ...prev, useCustomMinutes: true }))}
                  >
                    Custom
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={5}
                    max={480}
                    value={formData.customAllowedMinutes}
                    onChange={(e) => setFormData(prev => ({ ...prev, customAllowedMinutes: parseInt(e.target.value) || 30 }))}
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground">minutes</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setFormData(prev => ({ ...prev, useCustomMinutes: false }))}
                  >
                    Presets
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Active Hours</Label>
                <div className="flex items-center gap-2">
                  <Label htmlFor="all-day" className="text-xs text-muted-foreground cursor-pointer">All day</Label>
                  <Switch
                    id="all-day"
                    checked={formData.allDay}
                    onCheckedChange={(checked) => setFormData(prev => ({ ...prev, allDay: checked }))}
                  />
                </div>
              </div>
              {!formData.allDay && (
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={formData.allowedTimeStart}
                    onChange={(e) => setFormData(prev => ({ ...prev, allowedTimeStart: e.target.value }))}
                    className="w-32"
                  />
                  <span className="text-sm text-muted-foreground">to</span>
                  <Input
                    type="time"
                    value={formData.allowedTimeEnd}
                    onChange={(e) => setFormData(prev => ({ ...prev, allowedTimeEnd: e.target.value }))}
                    className="w-32"
                  />
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Applies To</Label>
              <Select
                value={formData.appliesTo}
                onValueChange={(val) => setFormData(prev => ({ ...prev, appliesTo: val }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All employees</SelectItem>
                  <SelectItem value="managers_only">Managers only</SelectItem>
                  <SelectItem value="specific_employees">Select specific employees</SelectItem>
                </SelectContent>
              </Select>
              {formData.appliesTo === 'specific_employees' && (
                <div className="border rounded-md p-3 max-h-40 overflow-y-auto space-y-2">
                  {activeUsers.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No active employees found.</p>
                  ) : (
                    activeUsers.map((u: User) => (
                      <label key={u.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={formData.specificEmployeeIds.includes(u.id)}
                          onCheckedChange={(checked) => {
                            setFormData(prev => ({
                              ...prev,
                              specificEmployeeIds: checked
                                ? [...prev.specificEmployeeIds, u.id]
                                : prev.specificEmployeeIds.filter(id => id !== u.id),
                            }));
                          }}
                        />
                        {u.firstName || ''} {u.lastName || ''} {!u.firstName && !u.lastName ? u.email : ''}
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Alert After (minutes)</Label>
              <p className="text-xs text-muted-foreground">Send a notification when the employee has been off-site for this long.</p>
              <Input
                type="number"
                min={5}
                max={480}
                value={formData.alertAfterMinutes}
                onChange={(e) => setFormData(prev => ({ ...prev, alertAfterMinutes: parseInt(e.target.value) || 20 }))}
                className="w-24"
              />
            </div>

            <div className="space-y-2">
              <Label>Alert Who</Label>
              <Select
                value={formData.alertRecipients}
                onValueChange={(val) => setFormData(prev => ({ ...prev, alertRecipients: val }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">Owner only</SelectItem>
                  <SelectItem value="manager">Manager on duty</SelectItem>
                  <SelectItem value="both">Owner & Manager</SelectItem>
                  <SelectItem value="custom">Custom (select users)</SelectItem>
                </SelectContent>
              </Select>
              {formData.alertRecipients === 'custom' && (
                <div className="border rounded-md p-3 max-h-40 overflow-y-auto space-y-2">
                  {activeUsers.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No active users found.</p>
                  ) : (
                    activeUsers.map((u: User) => (
                      <label key={u.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={formData.customAlertUserIds.includes(u.id)}
                          onCheckedChange={(checked) => {
                            setFormData(prev => ({
                              ...prev,
                              customAlertUserIds: checked
                                ? [...prev.customAlertUserIds, u.id]
                                : prev.customAlertUserIds.filter(id => id !== u.id),
                            }));
                          }}
                        />
                        {u.firstName || ''} {u.lastName || ''} {!u.firstName && !u.lastName ? u.email : ''}
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetForm}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending ? 'Saving...' : editingRule ? 'Update Rule' : 'Create Rule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteRuleId} onOpenChange={(open) => { if (!open) setDeleteRuleId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Off-Site Rule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this off-site allowance rule? This action cannot be undone.
              Existing off-site sessions that reference this rule will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteRuleId && deleteMutation.mutate(deleteRuleId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
