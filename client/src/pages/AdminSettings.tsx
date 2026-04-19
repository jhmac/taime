import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { WorkLocation, CompanySettings, ActivityLog, HolidayPayRule } from '@shared/schema';
import {
  Settings, MapPin, Calendar, Clock, DollarSign, Users, User, Bell,
  Shield, FileText, MessageSquare, Store, Menu, X, ChevronRight,
  ExternalLink, Trophy, BookOpen, BrainCircuit, Building2, Target
} from 'lucide-react';

import BasicInfoSection from '@/components/settings/BasicInfoSection';
import PosConnectionSection from '@/components/settings/PosConnectionSection';
import ScheduleEnforcementSection from '@/components/settings/ScheduleEnforcementSection';
import AlertsPermissionsSection from '@/components/settings/AlertsPermissionsSection';
import TimeClockOptionsSection from '@/components/settings/TimeClockOptionsSection';
import OvertimeSection from '@/components/settings/OvertimeSection';
import BreaksComplianceSection from '@/components/settings/BreaksComplianceSection';
import PayrollSection from '@/components/settings/PayrollSection';
import TimeOffSection from '@/components/settings/TimeOffSection';
import MessagesSection from '@/components/settings/MessagesSection';
import TeamPermissionsSection from '@/components/settings/TeamPermissionsSection';
import ManagerLogSection from '@/components/settings/ManagerLogSection';
import ProfileSection from '@/components/settings/ProfileSection';
import NotificationsSection from '@/components/settings/NotificationsSection';
import PerformanceScoringSection from '@/components/settings/PerformanceScoringSection';
import SOPManagementSection from '@/components/settings/SOPManagementSection';
import AISchedulingSection from '@/components/settings/AISchedulingSection';
import WorkPatternsSection from '@/components/settings/WorkPatternsSection';
import GeofenceMapSection from '@/components/settings/GeofenceMapSection';
import OffsiteAllowanceSection from '@/components/settings/OffsiteAllowanceSection';
import StoreLocationsSection from '@/components/settings/StoreLocationsSection';
import DailySalesGoalSection from '@/components/settings/DailySalesGoalSection';

const SIDEBAR_SECTIONS = [
  {
    category: 'Location',
    items: [
      { id: 'store-locations', label: 'Store locations', icon: Building2 },
      { id: 'basic-info', label: 'Basic info', icon: MapPin },
      { id: 'geofencing', label: 'Geofencing', icon: Shield },
      { id: 'offsite-allowances', label: 'Off-site allowances', icon: MapPin },
      { id: 'pos-connection', label: 'POS connection', icon: Store },
      { id: 'daily-sales-goal', label: 'Daily sales goal', icon: Target },
    ],
  },
  {
    category: 'Scheduling',
    items: [
      { id: 'schedule-enforcement', label: 'Schedule enforcement', icon: Calendar },
      { id: 'ai-scheduling', label: 'AI auto-scheduling', icon: BrainCircuit },
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
      { id: 'performance-scoring', label: 'Performance scoring', icon: Trophy },
      { id: 'sop-management', label: 'SOPs & Knowledge Base', icon: BookOpen },
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
    const section = params.get('section');
    const validSectionIds = SIDEBAR_SECTIONS.flatMap(cat => cat.items.map(item => item.id));
    if (section && validSectionIds.includes(section)) {
      setActiveSection(section);
    }
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
        enableClockOutOnFocusLoss: settings.enableClockOutOnFocusLoss || false,
        focusLossGraceSeconds: settings.focusLossGraceSeconds ?? 30,
        requireMobileClockIn: settings.requireMobileClockIn || false,
        defaultMileageRateCents: settings.defaultMileageRateCents ?? 0,
        dailySalesGoalEnabled: settings.dailySalesGoalEnabled ?? false,
        salesGoalIncreaseType: settings.salesGoalIncreaseType || 'percentage',
        salesGoalIncreaseValue: settings.salesGoalIncreaseValue ?? 0,
        showPaySummaryToEmployees: settings.showPaySummaryToEmployees ?? false,
      });
    }
  }, [settings]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: any) => {
      const payload = { ...data, expectedVersion: settings?.version };
      const res = await apiRequest('PUT', '/api/company-settings', payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/company-settings'] });
      toast({ title: "Settings Saved", description: "Company settings updated successfully." });
    },
    onError: (error: any) => {
      if (error.message?.includes("modified by another user")) {
        queryClient.invalidateQueries({ queryKey: ['/api/company-settings'] });
      }
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
      if (!data.authUrl) return;
      const popup = window.open(
        data.authUrl,
        'shopify-connect',
        'width=700,height=750,scrollbars=yes,resizable=yes'
      );
      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type === 'shopify-oauth-success') {
          queryClient.invalidateQueries({ queryKey: ['/api/shopify/shops'] });
          queryClient.invalidateQueries({ queryKey: ['/api/shopify/sales-data'] });
          toast({ title: "Shopify Connected", description: "Your store has been connected successfully." });
          setShopifyDomain('');
        } else if (event.data?.type === 'shopify-oauth-error') {
          toast({ title: "Connection Failed", description: event.data.message || "Please try again.", variant: "destructive" });
        }
        window.removeEventListener('message', handleMessage);
        if (popup && !popup.closed) popup.close();
      };
      window.addEventListener('message', handleMessage);
      const pollClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(pollClosed);
          window.removeEventListener('message', handleMessage);
        }
      }, 500);
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
    if (log.targetType === 'sales_access') {
      const meta = log.metadata as Record<string, any> | null;
      if (meta?.changeType === 'role_permission') {
        return meta.accessGranted
          ? `Granted sales access to ${meta.roleName || 'role'}`
          : `Revoked sales access from ${meta.roleName || 'role'}`;
      }
      if (meta?.changeType === 'user_override') {
        if (log.action === 'clear') return `Cleared sales access override for ${meta.targetUserName || 'employee'}`;
        return meta.accessGranted
          ? `Granted sales access to ${meta.targetUserName || 'employee'}`
          : `Revoked sales access from ${meta.targetUserName || 'employee'}`;
      }
      return log.action === 'grant' ? 'Granted sales access' : log.action === 'revoke' ? 'Revoked sales access' : 'Updated sales access';
    }
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

  const renderContent = () => {
    switch (activeSection) {
      case 'store-locations':
        return <StoreLocationsSection />;
      case 'basic-info':
        return (
          <BasicInfoSection
            settingsForm={settingsForm}
            updateForm={updateForm}
            locations={locations}
            showAddLocation={showAddLocation}
            setShowAddLocation={setShowAddLocation}
            editingLocation={editingLocation}
            setEditingLocation={setEditingLocation}
            addLocationMutation={addLocationMutation}
            updateLocationMutation={updateLocationMutation}
            deleteLocationMutation={deleteLocationMutation}
            handleAddLocation={handleAddLocation}
            handleUpdateLocation={handleUpdateLocation}
          />
        );
      case 'daily-sales-goal':
        return <DailySalesGoalSection settingsForm={settingsForm} updateForm={updateForm} />;
      case 'pos-connection':
        return (
          <PosConnectionSection
            shopifyDomain={shopifyDomain}
            setShopifyDomain={setShopifyDomain}
            connectedShop={connectedShop}
            connectShopifyMutation={connectShopifyMutation}
            disconnectShopifyMutation={disconnectShopifyMutation}
            syncSalesMutation={syncSalesMutation}
            salesData={salesData}
          />
        );
      case 'schedule-enforcement':
        return <ScheduleEnforcementSection settingsForm={settingsForm} updateForm={updateForm} />;
      case 'alerts-permissions':
        return <AlertsPermissionsSection settingsForm={settingsForm} updateForm={updateForm} />;
      case 'time-clock':
        return <TimeClockOptionsSection settingsForm={settingsForm} updateForm={updateForm} />;
      case 'overtime':
        return (
          <OvertimeSection
            settingsForm={settingsForm}
            updateForm={updateForm}
            holidayPayRules={holidayPayRules}
            holidayInstruction={holidayInstruction}
            setHolidayInstruction={setHolidayInstruction}
            parseHolidayPayMutation={parseHolidayPayMutation}
            deleteHolidayRuleMutation={deleteHolidayRuleMutation}
            holidayAiSummary={holidayAiSummary}
          />
        );
      case 'breaks':
        return <BreaksComplianceSection settingsForm={settingsForm} updateForm={updateForm} />;
      case 'payroll':
        return <PayrollSection settingsForm={settingsForm} updateForm={updateForm} />;
      case 'time-off':
        return <TimeOffSection settingsForm={settingsForm} updateForm={updateForm} />;
      case 'messages':
        return <MessagesSection settingsForm={settingsForm} updateForm={updateForm} />;
      case 'team-permissions':
        return <TeamPermissionsSection />;
      case 'performance-scoring':
        return <PerformanceScoringSection />;
      case 'geofencing':
        return <GeofenceMapSection />;
      case 'offsite-allowances':
        return <OffsiteAllowanceSection />;
      case 'sop-management':
        return <SOPManagementSection />;
      case 'ai-scheduling':
        return (
          <div className="space-y-6">
            <AISchedulingSection />
            <WorkPatternsSection />
          </div>
        );
      case 'manager-log':
        return (
          <ManagerLogSection
            activityLogs={activityLogs}
            formatLogAction={formatLogAction}
            formatLogTime={formatLogTime}
          />
        );
      case 'profile':
        return <ProfileSection user={user} />;
      case 'notifications':
        return <NotificationsSection />;
      default:
        return (
          <BasicInfoSection
            settingsForm={settingsForm}
            updateForm={updateForm}
            locations={locations}
            showAddLocation={showAddLocation}
            setShowAddLocation={setShowAddLocation}
            editingLocation={editingLocation}
            setEditingLocation={setEditingLocation}
            addLocationMutation={addLocationMutation}
            updateLocationMutation={updateLocationMutation}
            deleteLocationMutation={deleteLocationMutation}
            handleAddLocation={handleAddLocation}
            handleUpdateLocation={handleUpdateLocation}
          />
        );
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
        {activeSection !== 'profile' && activeSection !== 'notifications' && activeSection !== 'manager-log' && activeSection !== 'team-permissions' && activeSection !== 'pos-connection' && activeSection !== 'performance-scoring' && activeSection !== 'sop-management' && activeSection !== 'ai-scheduling' && activeSection !== 'geofencing' && activeSection !== 'offsite-allowances' && activeSection !== 'store-locations' && (
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
