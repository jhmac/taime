import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import type { WorkLocation, CompanySettings, ActivityLog, HolidayPayRule } from '@shared/schema';
import NotificationSettings from '@/components/NotificationSettings';
import {
  Settings, MapPin, Calendar, Clock, DollarSign, Users, User, Bell,
  Shield, FileText, MessageSquare, Store, Menu, X, ChevronRight,
  Plus, Trash2, Edit, ExternalLink, AlertCircle
} from 'lucide-react';

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu', 'America/Toronto',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai',
  'Australia/Sydney', 'Pacific/Auckland',
];

const DAYS_OF_WEEK = [
  { value: 'sunday', label: 'Sunday' },
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
];

const SIDEBAR_SECTIONS = [
  {
    category: 'Location',
    items: [
      { id: 'basic-info', label: 'Basic info', icon: MapPin },
      { id: 'pos-connection', label: 'POS connection', icon: Store },
    ],
  },
  {
    category: 'Scheduling',
    items: [
      { id: 'schedule-enforcement', label: 'Schedule enforcement', icon: Calendar },
      { id: 'alerts-permissions', label: 'Alerts & permissions', icon: Bell },
    ],
  },
  {
    category: 'Time tracking',
    items: [
      { id: 'time-clock', label: 'Time clock options', icon: Clock },
      { id: 'overtime', label: 'Overtime', icon: Clock },
      { id: 'breaks', label: 'Breaks & compliance', icon: Clock },
    ],
  },
  {
    category: 'Payroll',
    items: [
      { id: 'payroll', label: 'Payroll settings', icon: DollarSign },
    ],
  },
  {
    category: 'Team management',
    items: [
      { id: 'time-off', label: 'Time off', icon: Calendar },
      { id: 'messages', label: 'Messages', icon: MessageSquare },
      { id: 'team-permissions', label: 'Team permissions', icon: Shield },
      { id: 'manager-log', label: 'Manager Log', icon: FileText },
    ],
  },
  {
    category: 'Account',
    items: [
      { id: 'profile', label: 'Profile', icon: User },
      { id: 'notifications', label: 'Notifications', icon: Bell },
    ],
  },
];

const formatHour = (hour: number) => {
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 || 12;
  return `${h}:00 ${ampm}`;
};

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const hour = Math.floor(i / 2);
  const min = i % 2 === 0 ? '00' : '30';
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 || 12;
  return { value: `${String(hour).padStart(2, '0')}:${min}`, label: `${h}:${min} ${ampm}` };
});

export default function AdminSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const [activeSection, setActiveSection] = useState('basic-info');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [editingLocation, setEditingLocation] = useState<WorkLocation | null>(null);
  const [shopifyDomain, setShopifyDomain] = useState('');
  const [holidayInstruction, setHolidayInstruction] = useState('');
  const [holidayAiSummary, setHolidayAiSummary] = useState('');

  const [settingsForm, setSettingsForm] = useState<Record<string, any>>({});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('shopify') === 'connected') {
      toast({ title: "Shopify Connected", description: "Your Shopify store has been connected successfully." });
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('shopify') === 'error') {
      toast({ title: "Connection Error", description: "Failed to connect your Shopify store. Please try again.", variant: "destructive" });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const { data: settings, isLoading: settingsLoading } = useQuery<CompanySettings>({
    queryKey: ['/api/company-settings'],
  });

  const { data: locations = [] } = useQuery<WorkLocation[]>({
    queryKey: ['/api/work-locations'],
  });

  const { data: activityLogs = [] } = useQuery<ActivityLog[]>({
    queryKey: ['/api/activity-logs'],
  });

  const { data: holidayPayRules = [] } = useQuery<HolidayPayRule[]>({
    queryKey: ['/api/holiday-pay-rules'],
  });

  const { data: shopifyShops = [] } = useQuery<any[]>({
    queryKey: ['/api/shopify/shops'],
  });

  const connectedShop = shopifyShops.find((s: any) => s.isActive);

  const { data: salesData } = useQuery<any>({
    queryKey: ['/api/shopify/sales-data', connectedShop?.shopDomain],
    queryFn: async () => {
      const res = await fetch(`/api/shopify/sales-data?shop=${encodeURIComponent(connectedShop.shopDomain)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch sales data');
      return res.json();
    },
    enabled: !!connectedShop?.shopDomain,
  });

  const { data: staffingRecs, refetch: refetchStaffing } = useQuery<any>({
    queryKey: ['/api/shopify/staffing-recommendations', connectedShop?.shopDomain],
    queryFn: async () => {
      const res = await fetch(`/api/shopify/staffing-recommendations?shop=${encodeURIComponent(connectedShop.shopDomain)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch staffing recommendations');
      return res.json();
    },
    enabled: false,
  });

  useEffect(() => {
    if (settings) {
      setSettingsForm({
        companyName: settings.companyName || '',
        timezone: settings.timezone || 'America/New_York',
        businessStartHour: settings.businessStartHour || 8,
        businessEndHour: settings.businessEndHour || 17,
        locationPhone: settings.locationPhone || '',
        address1: settings.address1 || '',
        address2: settings.address2 || '',
        city: settings.city || '',
        stateProvince: settings.stateProvince || '',
        zipCode: settings.zipCode || '',
        country: settings.country || 'United States',
        businessType: settings.businessType || '',
        businessCategory: settings.businessCategory || '',
        website: settings.website || '',
        accountOwnerName: settings.accountOwnerName || '',
        companyPhone: settings.companyPhone || '',
        workWeekStart: settings.workWeekStart || 'sunday',
        schedulingStartTime: settings.schedulingStartTime || '09:00',
        schedulingEndTime: settings.schedulingEndTime || '17:00',
        lateThresholdMinutes: settings.lateThresholdMinutes ?? 5,
        preventEarlyClockIn: settings.preventEarlyClockIn || false,
        earlyClockInMinutes: settings.earlyClockInMinutes ?? 5,
        preventEarlyBreakReturn: settings.preventEarlyBreakReturn || false,
        singleClockOutReminder: settings.singleClockOutReminder ?? true,
        autoClockOutEnabled: settings.autoClockOutEnabled || false,
        autoClockOutAfterMinutes: settings.autoClockOutAfterMinutes ?? 480,
        textScheduleToEmployees: settings.textScheduleToEmployees || false,
        employeesViewOwnScheduleOnly: settings.employeesViewOwnScheduleOnly || false,
        notifyManagerLateClockIn: settings.notifyManagerLateClockIn ?? true,
        managerLateAlertMinutes: settings.managerLateAlertMinutes ?? 19,
        requireManagerApprovalAvailability: settings.requireManagerApprovalAvailability ?? true,
        managersScheduleOwnDept: settings.managersScheduleOwnDept || false,
        requestShiftExperience: settings.requestShiftExperience ?? true,
        requireCashTipDeclaration: settings.requireCashTipDeclaration || false,
        enableClockRounding: settings.enableClockRounding || false,
        roundingIncrement: settings.roundingIncrement ?? 5,
        enableMobileTimeClock: settings.enableMobileTimeClock ?? true,
        allowUnscheduledMobileClockIn: settings.allowUnscheduledMobileClockIn || false,
        geofenceEnforcement: settings.geofenceEnforcement || false,
        enableWebTimeClock: settings.enableWebTimeClock || false,
        allowEmployeeWebClock: settings.allowEmployeeWebClock || false,
        enableDailyOvertime: settings.enableDailyOvertime || false,
        dailyOvertimeHours: settings.dailyOvertimeHours ?? 8,
        dailyOvertimeMultiplier: settings.dailyOvertimeMultiplier || '1.50',
        enableWeeklyOvertime: settings.enableWeeklyOvertime ?? true,
        overtimeThresholdHours: settings.overtimeThresholdHours ?? 40,
        overtimeMultiplier: settings.overtimeMultiplier || '1.50',
        overtimeAlertEnabled: settings.overtimeAlertEnabled || false,
        overtimeAlertHours: settings.overtimeAlertHours ?? 40,
        startOfWorkday: settings.startOfWorkday || '00:00',
        trackOvertimeAcrossLocations: settings.trackOvertimeAcrossLocations || false,
        enableHolidayPayRate: settings.enableHolidayPayRate || false,
        holidayPayMultiplier: settings.holidayPayMultiplier || '1.50',
        breakRule1Enabled: settings.breakRule1Enabled ?? true,
        breakRule1Minutes: settings.breakRule1Minutes ?? 10,
        breakRule1Type: settings.breakRule1Type || 'paid',
        breakRule1EveryHours: settings.breakRule1EveryHours ?? 4,
        breakRule1Required: settings.breakRule1Required || 'optional',
        breakRule2Enabled: settings.breakRule2Enabled ?? true,
        breakRule2Minutes: settings.breakRule2Minutes ?? 30,
        breakRule2Type: settings.breakRule2Type || 'unpaid',
        breakRule2EveryHours: settings.breakRule2EveryHours ?? 6,
        breakRule2Required: settings.breakRule2Required || 'optional',
        subtractUnpaidBreaks: settings.subtractUnpaidBreaks ?? true,
        convertExcessToUnpaid: settings.convertExcessToUnpaid || false,
        awardMissedBreakHours: settings.awardMissedBreakHours || false,
        missedBreakAwardHours: settings.missedBreakAwardHours ?? 1,
        missedBreakPolicy: settings.missedBreakPolicy || 'managers_only',
        payScheduleFrequency: settings.payScheduleFrequency || 'every_two_weeks',
        nextPayrollDate: settings.nextPayrollDate || '',
        lockTimesheetsAfterApproval: settings.lockTimesheetsAfterApproval || false,
        limitTimeOffRequests: settings.limitTimeOffRequests || false,
        timeOffMaxPerDay: settings.timeOffMaxPerDay ?? 1,
        limitTimeOffAdvance: settings.limitTimeOffAdvance || false,
        timeOffAdvanceDays: settings.timeOffAdvanceDays ?? 0,
        allowShoutOuts: settings.allowShoutOuts ?? true,
        allowTeamMessaging: settings.allowTeamMessaging ?? true,
        breakDurationMinutes: settings.breakDurationMinutes ?? 30,
        autoClockOutMinutes: settings.autoClockOutMinutes ?? 480,
      });
    }
  }, [settings]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('PUT', '/api/company-settings', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/company-settings'] });
      toast({ title: "Settings Saved", description: "Company settings updated successfully." });
    },
    onError: (error) => {
      toast({ title: "Error", description: `Failed to save settings: ${error.message}`, variant: "destructive" });
    },
  });

  const addLocationMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/work-locations', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/work-locations'] });
      setShowAddLocation(false);
      toast({ title: "Location Added", description: "Work location created successfully." });
    },
    onError: (error) => {
      toast({ title: "Error", description: `Failed to add location: ${error.message}`, variant: "destructive" });
    },
  });

  const updateLocationMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const res = await apiRequest('PUT', `/api/work-locations/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/work-locations'] });
      setEditingLocation(null);
      toast({ title: "Location Updated", description: "Work location updated successfully." });
    },
    onError: (error) => {
      toast({ title: "Error", description: `Failed to update location: ${error.message}`, variant: "destructive" });
    },
  });

  const deleteLocationMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/work-locations/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/work-locations'] });
      toast({ title: "Location Deleted", description: "Work location removed." });
    },
    onError: (error) => {
      toast({ title: "Error", description: `Failed to delete location: ${error.message}`, variant: "destructive" });
    },
  });

  const connectShopifyMutation = useMutation({
    mutationFn: async (domain: string) => {
      const res = await fetch(`/api/shopify/auth?shop=${encodeURIComponent(domain)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to initiate Shopify auth');
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    },
    onError: (error) => {
      toast({ title: "Error", description: `Failed to connect: ${error.message}`, variant: "destructive" });
    },
  });

  const disconnectShopifyMutation = useMutation({
    mutationFn: async (shopDomain: string) => {
      const res = await apiRequest('POST', '/api/shopify/disconnect', { shopDomain });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/shopify/shops'] });
      queryClient.invalidateQueries({ queryKey: ['/api/shopify/sales-data'] });
      queryClient.invalidateQueries({ queryKey: ['/api/shopify/staffing-recommendations'] });
      toast({ title: "Disconnected", description: "Shopify store has been disconnected." });
    },
    onError: (error) => {
      toast({ title: "Error", description: `Failed to disconnect: ${error.message}`, variant: "destructive" });
    },
  });

  const syncSalesMutation = useMutation({
    mutationFn: async (shopDomain: string) => {
      const res = await apiRequest('POST', '/api/shopify/sync-sales', { shopDomain, daysBack: 365 });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/shopify/sales-data'] });
      queryClient.invalidateQueries({ queryKey: ['/api/shopify/shops'] });
      toast({ title: "Sync Complete", description: "Sales data has been synced successfully." });
    },
    onError: (error) => {
      toast({ title: "Sync Error", description: `Failed to sync sales data: ${error.message}`, variant: "destructive" });
    },
  });

  const parseHolidayPayMutation = useMutation({
    mutationFn: async (instruction: string) => {
      const res = await apiRequest('POST', '/api/ai/parse-holiday-pay', { instruction });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/holiday-pay-rules'] });
      setHolidayAiSummary(data.summary || `${data.rules.length} holiday pay rules saved.`);
      setHolidayInstruction('');
      toast({ title: "Holiday Pay Rules Saved", description: `${data.rules.length} holiday(s) configured successfully.` });
    },
    onError: (error) => {
      toast({ title: "Error", description: `Failed to parse instructions: ${error.message}`, variant: "destructive" });
    },
  });

  const deleteHolidayRuleMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/holiday-pay-rules/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/holiday-pay-rules'] });
      toast({ title: "Rule Removed", description: "Holiday pay rule has been removed." });
    },
    onError: (error) => {
      toast({ title: "Error", description: `Failed to remove rule: ${error.message}`, variant: "destructive" });
    },
  });

  const handleSaveSettings = () => {
    updateSettingsMutation.mutate(settingsForm);
  };

  const handleAddLocation = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    addLocationMutation.mutate({
      name: formData.get('name') as string,
      address: formData.get('address') as string,
      latitude: formData.get('latitude') ? parseFloat(formData.get('latitude') as string) : null,
      longitude: formData.get('longitude') ? parseFloat(formData.get('longitude') as string) : null,
      radius: parseInt(formData.get('radius') as string) || 100,
    });
  };

  const handleUpdateLocation = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingLocation) return;
    const formData = new FormData(e.currentTarget);
    updateLocationMutation.mutate({
      id: editingLocation.id,
      name: formData.get('name') as string,
      address: formData.get('address') as string,
      latitude: formData.get('latitude') ? parseFloat(formData.get('latitude') as string) : null,
      longitude: formData.get('longitude') ? parseFloat(formData.get('longitude') as string) : null,
      radius: parseInt(formData.get('radius') as string) || 100,
    });
  };

  const updateForm = (key: string, value: any) => {
    setSettingsForm(prev => ({ ...prev, [key]: value }));
  };

  const formatLogAction = (log: ActivityLog) => {
    const actionLabels: Record<string, string> = {
      'update': 'Updated',
      'create': 'Created',
      'delete': 'Deleted',
      'deactivate': 'Deactivated',
      'activate': 'Activated',
    };
    const targetLabels: Record<string, string> = {
      'company_settings': 'company settings',
      'work_location': 'work location',
      'user': 'team member',
      'role': 'role',
      'permission': 'permissions',
    };
    return `${actionLabels[log.action] || log.action} ${targetLabels[log.targetType] || log.targetType}`;
  };

  const formatLogTime = (date: Date | string | null) => {
    if (!date) return '';
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString();
  };

  const getSectionTitle = () => {
    for (const section of SIDEBAR_SECTIONS) {
      for (const item of section.items) {
        if (item.id === activeSection) return item.label;
      }
    }
    return 'Settings';
  };

  if (settingsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const renderBasicInfo = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Location details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Location name</Label>
              <Input value={settingsForm.companyName || ''} onChange={e => updateForm('companyName', e.target.value)} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={settingsForm.locationPhone || ''} onChange={e => updateForm('locationPhone', e.target.value)} />
            </div>
            <div>
              <Label>Address 1</Label>
              <Input value={settingsForm.address1 || ''} onChange={e => updateForm('address1', e.target.value)} />
            </div>
            <div>
              <Label>Address 2</Label>
              <Input value={settingsForm.address2 || ''} onChange={e => updateForm('address2', e.target.value)} />
            </div>
            <div>
              <Label>City</Label>
              <Input value={settingsForm.city || ''} onChange={e => updateForm('city', e.target.value)} />
            </div>
            <div>
              <Label>State / Province</Label>
              <Input value={settingsForm.stateProvince || ''} onChange={e => updateForm('stateProvince', e.target.value)} />
            </div>
            <div>
              <Label>Zip code</Label>
              <Input value={settingsForm.zipCode || ''} onChange={e => updateForm('zipCode', e.target.value)} />
            </div>
            <div>
              <Label>Country</Label>
              <Input value={settingsForm.country || ''} onChange={e => updateForm('country', e.target.value)} />
            </div>
            <div>
              <Label>Timezone</Label>
              <Select value={settingsForm.timezone || 'America/New_York'} onValueChange={val => updateForm('timezone', val)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map(tz => (
                    <SelectItem key={tz} value={tz}>{tz.split('/').pop()?.replace(/_/g, ' ')} ({tz})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Business type</Label>
              <Input value={settingsForm.businessType || ''} onChange={e => updateForm('businessType', e.target.value)} />
            </div>
            <div>
              <Label>Business category</Label>
              <Input value={settingsForm.businessCategory || ''} onChange={e => updateForm('businessCategory', e.target.value)} />
            </div>
            <div>
              <Label>Website</Label>
              <Input value={settingsForm.website || ''} onChange={e => updateForm('website', e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Company info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Company name</Label>
              <Input value={settingsForm.companyName || ''} onChange={e => updateForm('companyName', e.target.value)} />
            </div>
            <div>
              <Label>Account owner name</Label>
              <Input value={settingsForm.accountOwnerName || ''} onChange={e => updateForm('accountOwnerName', e.target.value)} />
            </div>
            <div>
              <Label>Company phone</Label>
              <Input value={settingsForm.companyPhone || ''} onChange={e => updateForm('companyPhone', e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Company locations</CardTitle>
          <Button size="sm" onClick={() => setShowAddLocation(true)}>
            <Plus className="w-4 h-4 mr-1" /> Add a new location
          </Button>
        </CardHeader>
        <CardContent>
          {locations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No locations added yet.</p>
          ) : (
            <div className="space-y-3">
              {locations.map(loc => (
                <div key={loc.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <p className="font-medium text-sm">{loc.name}</p>
                    <p className="text-xs text-muted-foreground">{loc.address || 'No address'}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditingLocation(loc)}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteLocationMutation.mutate(loc.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showAddLocation} onOpenChange={setShowAddLocation}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Location</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddLocation} className="space-y-4">
            <div>
              <Label htmlFor="name">Location Name</Label>
              <Input id="name" name="name" required />
            </div>
            <div>
              <Label htmlFor="address">Address</Label>
              <Input id="address" name="address" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="latitude">Latitude</Label>
                <Input id="latitude" name="latitude" type="number" step="any" />
              </div>
              <div>
                <Label htmlFor="longitude">Longitude</Label>
                <Input id="longitude" name="longitude" type="number" step="any" />
              </div>
            </div>
            <div>
              <Label htmlFor="radius">Geofence Radius (meters)</Label>
              <Input id="radius" name="radius" type="number" defaultValue={100} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddLocation(false)}>Cancel</Button>
              <Button type="submit" disabled={addLocationMutation.isPending}>
                {addLocationMutation.isPending ? 'Adding...' : 'Add Location'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingLocation} onOpenChange={() => setEditingLocation(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Location</DialogTitle>
          </DialogHeader>
          {editingLocation && (
            <form onSubmit={handleUpdateLocation} className="space-y-4">
              <div>
                <Label htmlFor="edit-name">Location Name</Label>
                <Input id="edit-name" name="name" defaultValue={editingLocation.name} required />
              </div>
              <div>
                <Label htmlFor="edit-address">Address</Label>
                <Input id="edit-address" name="address" defaultValue={editingLocation.address || ''} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="edit-latitude">Latitude</Label>
                  <Input id="edit-latitude" name="latitude" type="number" step="any" defaultValue={editingLocation.latitude || ''} />
                </div>
                <div>
                  <Label htmlFor="edit-longitude">Longitude</Label>
                  <Input id="edit-longitude" name="longitude" type="number" step="any" defaultValue={editingLocation.longitude || ''} />
                </div>
              </div>
              <div>
                <Label htmlFor="edit-radius">Geofence Radius (meters)</Label>
                <Input id="edit-radius" name="radius" type="number" defaultValue={editingLocation.radius || 100} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditingLocation(null)}>Cancel</Button>
                <Button type="submit" disabled={updateLocationMutation.isPending}>
                  {updateLocationMutation.isPending ? 'Saving...' : 'Save Changes'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );

  const renderPosConnection = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Store className="w-5 h-5" /> Shopify Integration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {connectedShop ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 border rounded-lg bg-green-50 dark:bg-green-900/10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <Store className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{connectedShop.shopDomain}</p>
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Connected</Badge>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => syncSalesMutation.mutate(connectedShop.shopDomain)} disabled={syncSalesMutation.isPending}>
                    {syncSalesMutation.isPending ? 'Syncing...' : 'Sync Sales'}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => disconnectShopifyMutation.mutate(connectedShop.shopDomain)} disabled={disconnectShopifyMutation.isPending}>
                    Disconnect
                  </Button>
                </div>
              </div>
              {salesData && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3 border rounded-lg text-center">
                    <p className="text-2xl font-bold">{salesData.totalOrders || 0}</p>
                    <p className="text-xs text-muted-foreground">Total Orders</p>
                  </div>
                  <div className="p-3 border rounded-lg text-center">
                    <p className="text-2xl font-bold">${(salesData.totalRevenue || 0).toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Total Revenue</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Connect your Shopify store to sync sales data and get AI-powered staffing recommendations.</p>
              <div className="flex gap-2">
                <Input placeholder="your-store.myshopify.com" value={shopifyDomain} onChange={e => setShopifyDomain(e.target.value)} />
                <Button onClick={() => connectShopifyMutation.mutate(shopifyDomain)} disabled={!shopifyDomain || connectShopifyMutation.isPending}>
                  {connectShopifyMutation.isPending ? 'Connecting...' : 'Connect'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  const renderScheduleEnforcement = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Work week</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Work week starts on</Label>
            <Select value={settingsForm.workWeekStart || 'sunday'} onValueChange={val => updateForm('workWeekStart', val)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAYS_OF_WEEK.map(d => (
                  <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scheduling hours</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Start time</Label>
              <Select value={settingsForm.schedulingStartTime || '09:00'} onValueChange={val => updateForm('schedulingStartTime', val)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_OPTIONS.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>End time</Label>
              <Select value={settingsForm.schedulingEndTime || '17:00'} onValueChange={val => updateForm('schedulingEndTime', val)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_OPTIONS.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clock-in rules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-3">
            <span className="text-sm">Mark employee as late</span>
            <Input type="number" className="w-20" value={settingsForm.lateThresholdMinutes ?? 5} onChange={e => updateForm('lateThresholdMinutes', parseInt(e.target.value) || 0)} />
            <span className="text-sm">min after shift scheduled to start</span>
          </div>

          <Separator />

          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.preventEarlyClockIn || false} onCheckedChange={val => updateForm('preventEarlyClockIn', !!val)} />
            <div className="space-y-1">
              <Label className="text-sm">Prevent early clock-in</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Employees cannot clock in more than</span>
                <Input type="number" className="w-16 h-7 text-xs" value={settingsForm.earlyClockInMinutes ?? 5} onChange={e => updateForm('earlyClockInMinutes', parseInt(e.target.value) || 0)} disabled={!settingsForm.preventEarlyClockIn} />
                <span className="text-xs text-muted-foreground">minutes before their shift</span>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.preventEarlyBreakReturn || false} onCheckedChange={val => updateForm('preventEarlyBreakReturn', !!val)} />
            <div>
              <Label className="text-sm">Prevent early break return</Label>
              <p className="text-xs text-muted-foreground">Employees cannot end their break early</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.singleClockOutReminder ?? true} onCheckedChange={val => updateForm('singleClockOutReminder', !!val)} />
            <div>
              <Label className="text-sm">Clock-out reminder</Label>
              <p className="text-xs text-muted-foreground">Send a single reminder when an employee forgets to clock out</p>
            </div>
          </div>

          <Separator />

          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.autoClockOutEnabled || false} onCheckedChange={val => updateForm('autoClockOutEnabled', !!val)} />
            <div className="space-y-1">
              <Label className="text-sm">Auto clock-out</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Automatically clock out after</span>
                <Input type="number" className="w-20 h-7 text-xs" value={settingsForm.autoClockOutAfterMinutes ?? 480} onChange={e => updateForm('autoClockOutAfterMinutes', parseInt(e.target.value) || 0)} disabled={!settingsForm.autoClockOutEnabled} />
                <span className="text-xs text-muted-foreground">minutes</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderAlertsPermissions = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Employee</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.textScheduleToEmployees || false} onCheckedChange={val => updateForm('textScheduleToEmployees', !!val)} />
            <div>
              <Label className="text-sm">Text schedule to employees</Label>
              <p className="text-xs text-muted-foreground">Automatically send schedule updates via text message to employees</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.employeesViewOwnScheduleOnly || false} onCheckedChange={val => updateForm('employeesViewOwnScheduleOnly', !!val)} />
            <div>
              <Label className="text-sm">Employees view own schedule only</Label>
              <p className="text-xs text-muted-foreground">Restrict employees to only see their own scheduled shifts</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Manager</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.notifyManagerLateClockIn ?? true} onCheckedChange={val => updateForm('notifyManagerLateClockIn', !!val)} />
            <div className="space-y-1">
              <Label className="text-sm">Notify manager of late clock-in</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Alert managers when employee is late by</span>
                <Input type="number" className="w-16 h-7 text-xs" value={settingsForm.managerLateAlertMinutes ?? 19} onChange={e => updateForm('managerLateAlertMinutes', parseInt(e.target.value) || 0)} disabled={!settingsForm.notifyManagerLateClockIn} />
                <span className="text-xs text-muted-foreground">minutes</span>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.requireManagerApprovalAvailability ?? true} onCheckedChange={val => updateForm('requireManagerApprovalAvailability', !!val)} />
            <div>
              <Label className="text-sm">Require manager approval for availability</Label>
              <p className="text-xs text-muted-foreground">Managers must approve availability change requests from employees</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.managersScheduleOwnDept || false} onCheckedChange={val => updateForm('managersScheduleOwnDept', !!val)} />
            <div>
              <Label className="text-sm">Managers schedule own department only</Label>
              <p className="text-xs text-muted-foreground">Restrict managers to scheduling only employees in their department</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderTimeClockOptions = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.requestShiftExperience ?? true} onCheckedChange={val => updateForm('requestShiftExperience', !!val)} />
            <div>
              <Label className="text-sm">Request shift experience</Label>
              <p className="text-xs text-muted-foreground">Ask employees to rate their shift experience when clocking out</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.requireCashTipDeclaration || false} onCheckedChange={val => updateForm('requireCashTipDeclaration', !!val)} />
            <div>
              <Label className="text-sm">Require cash tip declaration</Label>
              <p className="text-xs text-muted-foreground">Employees must declare cash tips when clocking out</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.enableClockRounding || false} onCheckedChange={val => updateForm('enableClockRounding', !!val)} />
            <div className="space-y-1">
              <Label className="text-sm">Enable clock rounding</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Round clock times to nearest</span>
                <Input type="number" className="w-16 h-7 text-xs" value={settingsForm.roundingIncrement ?? 5} onChange={e => updateForm('roundingIncrement', parseInt(e.target.value) || 5)} disabled={!settingsForm.enableClockRounding} />
                <span className="text-xs text-muted-foreground">minutes</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mobile Time Clock</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Enable mobile time clock</Label>
              <p className="text-xs text-muted-foreground">Allow employees to clock in/out from their mobile devices</p>
            </div>
            <Switch checked={settingsForm.enableMobileTimeClock ?? true} onCheckedChange={val => updateForm('enableMobileTimeClock', val)} />
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.allowUnscheduledMobileClockIn || false} onCheckedChange={val => updateForm('allowUnscheduledMobileClockIn', !!val)} />
            <div>
              <Label className="text-sm">Allow unscheduled mobile clock-in</Label>
              <p className="text-xs text-muted-foreground">Employees can clock in even without a scheduled shift</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.geofenceEnforcement || false} onCheckedChange={val => updateForm('geofenceEnforcement', !!val)} />
            <div>
              <Label className="text-sm">Enable Geo-fence</Label>
              <p className="text-xs text-muted-foreground">Require employees to be within the geofence to clock in via mobile</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Web Time Clock</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Enable web time clock</Label>
              <p className="text-xs text-muted-foreground">Allow clocking in/out from a web browser</p>
            </div>
            <Switch checked={settingsForm.enableWebTimeClock || false} onCheckedChange={val => updateForm('enableWebTimeClock', val)} />
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.allowEmployeeWebClock || false} onCheckedChange={val => updateForm('allowEmployeeWebClock', !!val)} />
            <div>
              <Label className="text-sm">Allow employee web clock</Label>
              <p className="text-xs text-muted-foreground">Let employees use the web-based time clock from their own devices</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderOvertime = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily overtime</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Enable daily overtime</Label>
            <Switch checked={settingsForm.enableDailyOvertime || false} onCheckedChange={val => updateForm('enableDailyOvertime', val)} />
          </div>
          {settingsForm.enableDailyOvertime && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Hours threshold</Label>
                <Input type="number" value={settingsForm.dailyOvertimeHours ?? 8} onChange={e => updateForm('dailyOvertimeHours', parseInt(e.target.value) || 8)} />
              </div>
              <div>
                <Label className="text-xs">Multiplier</Label>
                <Input type="number" step="0.25" value={settingsForm.dailyOvertimeMultiplier || '1.50'} onChange={e => updateForm('dailyOvertimeMultiplier', e.target.value)} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Weekly overtime</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Enable weekly overtime</Label>
            <Switch checked={settingsForm.enableWeeklyOvertime ?? true} onCheckedChange={val => updateForm('enableWeeklyOvertime', val)} />
          </div>
          {settingsForm.enableWeeklyOvertime && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Hours threshold (per week)</Label>
                <Input type="number" value={settingsForm.overtimeThresholdHours ?? 40} onChange={e => updateForm('overtimeThresholdHours', parseInt(e.target.value) || 40)} />
              </div>
              <div>
                <Label className="text-xs">Multiplier</Label>
                <Input type="number" step="0.25" value={settingsForm.overtimeMultiplier || '1.50'} onChange={e => updateForm('overtimeMultiplier', e.target.value)} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Overtime alert</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Enable overtime alert</Label>
            <Switch checked={settingsForm.overtimeAlertEnabled || false} onCheckedChange={val => updateForm('overtimeAlertEnabled', val)} />
          </div>
          {settingsForm.overtimeAlertEnabled && (
            <div>
              <Label className="text-xs">Alert when employee reaches (hours)</Label>
              <Input type="number" className="w-32" value={settingsForm.overtimeAlertHours ?? 40} onChange={e => updateForm('overtimeAlertHours', parseInt(e.target.value) || 40)} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workweek settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Work week starts on</Label>
              <Select value={settingsForm.workWeekStart || 'sunday'} onValueChange={val => updateForm('workWeekStart', val)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS_OF_WEEK.map(d => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Start of workday</Label>
              <Select value={settingsForm.startOfWorkday || '00:00'} onValueChange={val => updateForm('startOfWorkday', val)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_OPTIONS.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.trackOvertimeAcrossLocations || false} onCheckedChange={val => updateForm('trackOvertimeAcrossLocations', !!val)} />
            <div>
              <Label className="text-sm">Track overtime across locations</Label>
              <p className="text-xs text-muted-foreground">Calculate overtime based on total hours across all locations</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Holiday pay rates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Enable holiday pay rate</Label>
            <Switch checked={settingsForm.enableHolidayPayRate || false} onCheckedChange={val => updateForm('enableHolidayPayRate', val)} />
          </div>
          {settingsForm.enableHolidayPayRate && (
            <>
              <div>
                <Label className="text-xs">Holiday pay multiplier</Label>
                <Input type="number" step="0.25" className="w-32" value={settingsForm.holidayPayMultiplier || '1.50'} onChange={e => updateForm('holidayPayMultiplier', e.target.value)} />
              </div>
              <Separator />
              <div className="space-y-3">
                <Label className="text-sm font-medium">Holiday Pay Rules</Label>
                <div className="space-y-2">
                  <Textarea placeholder="Describe your holiday pay rules in plain English, e.g., 'Christmas Day at 2x pay, Thanksgiving at 1.5x pay'" value={holidayInstruction} onChange={e => setHolidayInstruction(e.target.value)} rows={3} />
                  <Button size="sm" onClick={() => parseHolidayPayMutation.mutate(holidayInstruction)} disabled={!holidayInstruction || parseHolidayPayMutation.isPending}>
                    {parseHolidayPayMutation.isPending ? 'Processing...' : 'Save Holiday Rules'}
                  </Button>
                </div>
                {holidayAiSummary && (
                  <div className="p-3 bg-green-50 dark:bg-green-900/10 rounded-lg text-sm text-green-700 dark:text-green-400">
                    {holidayAiSummary}
                  </div>
                )}
                {holidayPayRules.length > 0 && (
                  <div className="space-y-2">
                    {holidayPayRules.map((rule: HolidayPayRule) => (
                      <div key={rule.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <p className="text-sm font-medium">{rule.holidayName}</p>
                          <p className="text-xs text-muted-foreground">{rule.holidayDate} &middot; {rule.payMultiplier}x pay</p>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => deleteHolidayRuleMutation.mutate(rule.id)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );

  const renderBreaksCompliance = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Break rule 1</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Enabled</Label>
            <Switch checked={settingsForm.breakRule1Enabled ?? true} onCheckedChange={val => updateForm('breakRule1Enabled', val)} />
          </div>
          {settingsForm.breakRule1Enabled && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Minutes</Label>
                <Input type="number" value={settingsForm.breakRule1Minutes ?? 10} onChange={e => updateForm('breakRule1Minutes', parseInt(e.target.value) || 0)} />
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={settingsForm.breakRule1Type || 'paid'} onValueChange={val => updateForm('breakRule1Type', val)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="unpaid">Unpaid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Every (hours)</Label>
                <Input type="number" value={settingsForm.breakRule1EveryHours ?? 4} onChange={e => updateForm('breakRule1EveryHours', parseInt(e.target.value) || 0)} />
              </div>
              <div>
                <Label className="text-xs">Required</Label>
                <Select value={settingsForm.breakRule1Required || 'optional'} onValueChange={val => updateForm('breakRule1Required', val)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="optional">Optional</SelectItem>
                    <SelectItem value="mandatory">Mandatory</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Break rule 2</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Enabled</Label>
            <Switch checked={settingsForm.breakRule2Enabled ?? true} onCheckedChange={val => updateForm('breakRule2Enabled', val)} />
          </div>
          {settingsForm.breakRule2Enabled && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Minutes</Label>
                <Input type="number" value={settingsForm.breakRule2Minutes ?? 30} onChange={e => updateForm('breakRule2Minutes', parseInt(e.target.value) || 0)} />
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={settingsForm.breakRule2Type || 'unpaid'} onValueChange={val => updateForm('breakRule2Type', val)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="unpaid">Unpaid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Every (hours)</Label>
                <Input type="number" value={settingsForm.breakRule2EveryHours ?? 6} onChange={e => updateForm('breakRule2EveryHours', parseInt(e.target.value) || 0)} />
              </div>
              <div>
                <Label className="text-xs">Required</Label>
                <Select value={settingsForm.breakRule2Required || 'optional'} onValueChange={val => updateForm('breakRule2Required', val)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="optional">Optional</SelectItem>
                    <SelectItem value="mandatory">Mandatory</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Unpaid breaks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.subtractUnpaidBreaks ?? true} onCheckedChange={val => updateForm('subtractUnpaidBreaks', !!val)} />
            <div>
              <Label className="text-sm">Subtract unpaid breaks from total hours</Label>
              <p className="text-xs text-muted-foreground">Automatically deduct unpaid break time from employee total hours</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.convertExcessToUnpaid || false} onCheckedChange={val => updateForm('convertExcessToUnpaid', !!val)} />
            <div>
              <Label className="text-sm">Convert excess break time to unpaid</Label>
              <p className="text-xs text-muted-foreground">If an employee takes a longer break than allowed, the excess is treated as unpaid</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.awardMissedBreakHours || false} onCheckedChange={val => updateForm('awardMissedBreakHours', !!val)} />
            <div className="space-y-1">
              <Label className="text-sm">Award missed break hours</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Award</span>
                <Input type="number" className="w-16 h-7 text-xs" value={settingsForm.missedBreakAwardHours ?? 1} onChange={e => updateForm('missedBreakAwardHours', parseInt(e.target.value) || 0)} disabled={!settingsForm.awardMissedBreakHours} />
                <span className="text-xs text-muted-foreground">hour(s) for missed breaks</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Missed break resolution</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup value={settingsForm.missedBreakPolicy || 'managers_only'} onValueChange={val => updateForm('missedBreakPolicy', val)} className="space-y-3">
            <div className="flex items-center gap-3">
              <RadioGroupItem value="managers_only" id="managers-only" />
              <Label htmlFor="managers-only" className="text-sm">Managers only can resolve missed breaks</Label>
            </div>
            <div className="flex items-center gap-3">
              <RadioGroupItem value="team_members" id="team-members" />
              <Label htmlFor="team-members" className="text-sm">Team members can resolve their own missed breaks</Label>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>
    </div>
  );

  const renderPayroll = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pay schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Pay frequency</Label>
            <Select value={settingsForm.payScheduleFrequency || 'every_two_weeks'} onValueChange={val => updateForm('payScheduleFrequency', val)}>
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="every_two_weeks">Every two weeks</SelectItem>
                <SelectItem value="semi_monthly">Semi-monthly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Next payroll date</Label>
            <Input type="date" className="w-64" value={settingsForm.nextPayrollDate || ''} onChange={e => updateForm('nextPayrollDate', e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Running payroll</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.lockTimesheetsAfterApproval || false} onCheckedChange={val => updateForm('lockTimesheetsAfterApproval', !!val)} />
            <div>
              <Label className="text-sm">Lock timesheets after approval</Label>
              <p className="text-xs text-muted-foreground">Prevent changes to timesheets once they have been approved for payroll</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderTimeOff = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Time off requests</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.limitTimeOffRequests || false} onCheckedChange={val => updateForm('limitTimeOffRequests', !!val)} />
            <div className="space-y-1">
              <Label className="text-sm">Limit time off requests per day</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Maximum</span>
                <Input type="number" className="w-16 h-7 text-xs" value={settingsForm.timeOffMaxPerDay ?? 1} onChange={e => updateForm('timeOffMaxPerDay', parseInt(e.target.value) || 1)} disabled={!settingsForm.limitTimeOffRequests} />
                <span className="text-xs text-muted-foreground">employees off per day</span>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.limitTimeOffAdvance || false} onCheckedChange={val => updateForm('limitTimeOffAdvance', !!val)} />
            <div className="space-y-1">
              <Label className="text-sm">Require advance notice for time off</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Must request at least</span>
                <Input type="number" className="w-16 h-7 text-xs" value={settingsForm.timeOffAdvanceDays ?? 0} onChange={e => updateForm('timeOffAdvanceDays', parseInt(e.target.value) || 0)} disabled={!settingsForm.limitTimeOffAdvance} />
                <span className="text-xs text-muted-foreground">days in advance</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderMessages = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team communication</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.allowShoutOuts ?? true} onCheckedChange={val => updateForm('allowShoutOuts', !!val)} />
            <div>
              <Label className="text-sm">Allow shout-outs</Label>
              <p className="text-xs text-muted-foreground">Enable team members to send recognition and shout-outs to each other</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox checked={settingsForm.allowTeamMessaging ?? true} onCheckedChange={val => updateForm('allowTeamMessaging', !!val)} />
            <div>
              <Label className="text-sm">Allow team messaging</Label>
              <p className="text-xs text-muted-foreground">Enable direct and group messaging between team members</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderTeamPermissions = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team permissions</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">Manage roles and permissions for your team members in the dedicated role management page.</p>
          <Button onClick={() => navigate('/hr/roles')} className="gap-2">
            <Shield className="w-4 h-4" /> Manage Roles & Permissions <ExternalLink className="w-4 h-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );

  const renderManagerLog = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity log</CardTitle>
        </CardHeader>
        <CardContent>
          {activityLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity logged yet.</p>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {activityLogs.map((log: ActivityLog) => (
                <div key={log.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <p className="text-sm font-medium">{formatLogAction(log)}</p>
                    <p className="text-xs text-muted-foreground">{log.details}</p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap ml-4">{formatLogTime(log.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  const renderProfile = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            {user?.profileImageUrl ? (
              <img src={user.profileImageUrl} alt="Profile" className="w-16 h-16 rounded-full object-cover" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <User className="w-8 h-8 text-muted-foreground" />
              </div>
            )}
            <div>
              <p className="font-medium">{user?.firstName} {user?.lastName}</p>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <Separator />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground">First name</Label>
              <p className="text-sm">{user?.firstName || '—'}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Last name</Label>
              <p className="text-sm">{user?.lastName || '—'}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Email</Label>
              <p className="text-sm">{user?.email || '—'}</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Profile editing is managed through your authentication provider.</p>
        </CardContent>
      </Card>
    </div>
  );

  const renderNotifications = () => (
    <div className="space-y-6">
      <NotificationSettings />
    </div>
  );

  const renderContent = () => {
    switch (activeSection) {
      case 'basic-info': return renderBasicInfo();
      case 'pos-connection': return renderPosConnection();
      case 'schedule-enforcement': return renderScheduleEnforcement();
      case 'alerts-permissions': return renderAlertsPermissions();
      case 'time-clock': return renderTimeClockOptions();
      case 'overtime': return renderOvertime();
      case 'breaks': return renderBreaksCompliance();
      case 'payroll': return renderPayroll();
      case 'time-off': return renderTimeOff();
      case 'messages': return renderMessages();
      case 'team-permissions': return renderTeamPermissions();
      case 'manager-log': return renderManagerLog();
      case 'profile': return renderProfile();
      case 'notifications': return renderNotifications();
      default: return renderBasicInfo();
    }
  };

  const sidebarContent = (
    <nav className="py-4 space-y-5">
      {SIDEBAR_SECTIONS.map(section => (
        <div key={section.category}>
          <p className="px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{section.category}</p>
          <div className="space-y-0.5">
            {section.items.map(item => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    if (item.id === 'team-permissions') {
                      navigate('/hr/roles');
                      return;
                    }
                    setActiveSection(item.id);
                    if (isMobile) setSidebarOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors text-left",
                    isActive
                      ? "bg-primary/10 text-primary font-medium border-r-2 border-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span>{item.label}</span>
                  {item.id === 'team-permissions' && <ExternalLink className="w-3 h-3 ml-auto" />}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-full bg-background">
      <div className="flex items-center justify-between border-b px-4 md:px-6 py-3">
        <div className="flex items-center gap-3">
          {isMobile && (
            <Button variant="ghost" size="sm" onClick={() => setSidebarOpen(!sidebarOpen)}>
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          )}
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold">Settings</h1>
          </div>
        </div>
        {activeSection !== 'profile' && activeSection !== 'notifications' && activeSection !== 'manager-log' && activeSection !== 'team-permissions' && activeSection !== 'pos-connection' && (
          <Button onClick={handleSaveSettings} disabled={updateSettingsMutation.isPending} size="sm">
            {updateSettingsMutation.isPending ? 'Saving...' : 'Save changes'}
          </Button>
        )}
      </div>

      <div className="flex relative">
        {isMobile ? (
          <>
            {sidebarOpen && (
              <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setSidebarOpen(false)} />
            )}
            <div className={cn(
              "fixed top-0 left-0 z-50 h-full w-64 bg-background border-r transform transition-transform duration-200 overflow-y-auto",
              sidebarOpen ? "translate-x-0" : "-translate-x-full"
            )}>
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <span className="font-semibold text-sm">Settings</span>
                <Button variant="ghost" size="sm" onClick={() => setSidebarOpen(false)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
              {sidebarContent}
            </div>
          </>
        ) : (
          <div className="w-60 flex-shrink-0 border-r bg-background sticky top-0 h-[calc(100vh-57px)] overflow-y-auto">
            {sidebarContent}
          </div>
        )}

        <div className="flex-1 min-w-0 p-4 md:p-6">
          <h2 className="text-xl font-semibold mb-6">{getSectionTitle()}</h2>
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
