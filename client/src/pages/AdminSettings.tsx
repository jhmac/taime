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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import type { WorkLocation, CompanySettings, ActivityLog } from '@shared/schema';

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu', 'America/Toronto',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai',
  'Australia/Sydney', 'Pacific/Auckland',
];

const formatTimezone = (tz: string) => {
  const parts = tz.split('/');
  return parts[parts.length - 1].replace(/_/g, ' ');
};

const formatHour = (hour: number) => {
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 || 12;
  return `${h}:00 ${ampm}`;
};

export default function AdminSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [editingLocation, setEditingLocation] = useState<WorkLocation | null>(null);
  const [shopifyDomain, setShopifyDomain] = useState('');

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

  const { data: shopifyShops = [], isLoading: shopsLoading } = useQuery<any[]>({
    queryKey: ['/api/shopify/shops'],
  });

  const connectedShop = shopifyShops.find((s: any) => s.isActive);

  const { data: salesData, isLoading: salesLoading } = useQuery<any>({
    queryKey: ['/api/shopify/sales-data', connectedShop?.shopDomain],
    queryFn: async () => {
      const res = await fetch(`/api/shopify/sales-data?shop=${encodeURIComponent(connectedShop.shopDomain)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch sales data');
      return res.json();
    },
    enabled: !!connectedShop?.shopDomain,
  });

  const { data: staffingRecs, isLoading: staffingLoading, refetch: refetchStaffing } = useQuery<any>({
    queryKey: ['/api/shopify/staffing-recommendations', connectedShop?.shopDomain],
    queryFn: async () => {
      const res = await fetch(`/api/shopify/staffing-recommendations?shop=${encodeURIComponent(connectedShop.shopDomain)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch staffing recommendations');
      return res.json();
    },
    enabled: false,
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

  const getStaffingLevelColor = (level: string) => {
    const colors: Record<string, string> = {
      high: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
      above_average: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
      normal: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
      below_average: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
      low: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    };
    return colors[level] || colors.normal;
  };

  const { data: settings, isLoading: settingsLoading } = useQuery<CompanySettings>({
    queryKey: ['/api/company-settings'],
  });

  const { data: locations = [], isLoading: locationsLoading } = useQuery<WorkLocation[]>({
    queryKey: ['/api/work-locations'],
  });

  const { data: activityLogs = [] } = useQuery<ActivityLog[]>({
    queryKey: ['/api/activity-logs'],
  });

  const { data: users = [] } = useQuery<any[]>({
    queryKey: ['/api/users'],
  });

  const { data: roles = [] } = useQuery<any[]>({
    queryKey: ['/api/roles'],
  });

  const [companyForm, setCompanyForm] = useState({
    companyName: '',
    timezone: 'America/New_York',
    businessStartHour: 8,
    businessEndHour: 17,
    overtimeThresholdHours: 40,
    overtimeMultiplier: '1.50',
    geofenceEnforcement: false,
    breakDurationMinutes: 30,
    autoClockOutMinutes: 480,
  });

  useEffect(() => {
    if (settings) {
      setCompanyForm({
        companyName: settings.companyName || 'My Company',
        timezone: settings.timezone || 'America/New_York',
        businessStartHour: settings.businessStartHour || 8,
        businessEndHour: settings.businessEndHour || 17,
        overtimeThresholdHours: settings.overtimeThresholdHours || 40,
        overtimeMultiplier: settings.overtimeMultiplier || '1.50',
        geofenceEnforcement: settings.geofenceEnforcement || false,
        breakDurationMinutes: settings.breakDurationMinutes || 30,
        autoClockOutMinutes: settings.autoClockOutMinutes || 480,
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

  const handleSaveSettings = () => {
    updateSettingsMutation.mutate(companyForm);
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

  const activeUsers = users.filter((u: any) => u.isActive !== false);
  const adminCount = activeUsers.filter((u: any) => u.role?.name === 'admin' || u.role?.name === 'owner').length;

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

  if (settingsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-background">
      <div className="p-4 md:p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/team')}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                <i className="fas fa-users text-blue-600 dark:text-blue-400"></i>
              </div>
              <div className="min-w-0">
                <p className="text-xl font-bold">{activeUsers.length}</p>
                <p className="text-xs text-muted-foreground truncate">Team Members</p>
              </div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/hr/roles')}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
                <i className="fas fa-shield-alt text-purple-600 dark:text-purple-400"></i>
              </div>
              <div className="min-w-0">
                <p className="text-xl font-bold">{roles.length}</p>
                <p className="text-xs text-muted-foreground truncate">Roles</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                <i className="fas fa-map-marker-alt text-green-600 dark:text-green-400"></i>
              </div>
              <div className="min-w-0">
                <p className="text-xl font-bold">{locations.length}</p>
                <p className="text-xs text-muted-foreground truncate">Locations</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                <i className="fas fa-user-shield text-amber-600 dark:text-amber-400"></i>
              </div>
              <div className="min-w-0">
                <p className="text-xl font-bold">{adminCount}</p>
                <p className="text-xs text-muted-foreground truncate">Admins</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="company" className="w-full">
          <TabsList className={isMobile ? "grid w-full grid-cols-4 mb-4" : "mb-4"}>
            <TabsTrigger value="company">Company</TabsTrigger>
            <TabsTrigger value="locations">Locations</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="shopify"><i className="fab fa-shopify mr-1"></i>Shopify</TabsTrigger>
          </TabsList>

          <TabsContent value="company">
            <div className={isMobile ? "space-y-4" : "grid grid-cols-2 gap-6"}>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <i className="fas fa-building text-primary"></i>
                    Company Profile
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="companyName">Company Name</Label>
                    <Input
                      id="companyName"
                      value={companyForm.companyName}
                      onChange={(e) => setCompanyForm(prev => ({ ...prev, companyName: e.target.value }))}
                      data-testid="input-company-name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="timezone">Timezone</Label>
                    <Select
                      value={companyForm.timezone}
                      onValueChange={(val) => setCompanyForm(prev => ({ ...prev, timezone: val }))}
                    >
                      <SelectTrigger data-testid="select-timezone">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIMEZONES.map(tz => (
                          <SelectItem key={tz} value={tz}>
                            {formatTimezone(tz)} ({tz})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Business Start</Label>
                      <Select
                        value={String(companyForm.businessStartHour)}
                        onValueChange={(val) => setCompanyForm(prev => ({ ...prev, businessStartHour: parseInt(val) }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 24 }, (_, i) => (
                            <SelectItem key={i} value={String(i)}>{formatHour(i)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Business End</Label>
                      <Select
                        value={String(companyForm.businessEndHour)}
                        onValueChange={(val) => setCompanyForm(prev => ({ ...prev, businessEndHour: parseInt(val) }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 24 }, (_, i) => (
                            <SelectItem key={i} value={String(i)}>{formatHour(i)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <i className="fas fa-cog text-primary"></i>
                    Time & Pay Rules
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Overtime After (hrs/week)</Label>
                      <Input
                        type="number"
                        value={companyForm.overtimeThresholdHours}
                        onChange={(e) => setCompanyForm(prev => ({ ...prev, overtimeThresholdHours: parseInt(e.target.value) || 40 }))}
                        data-testid="input-overtime-threshold"
                      />
                    </div>
                    <div>
                      <Label>OT Multiplier</Label>
                      <Input
                        type="number"
                        step="0.25"
                        value={companyForm.overtimeMultiplier}
                        onChange={(e) => setCompanyForm(prev => ({ ...prev, overtimeMultiplier: e.target.value }))}
                        data-testid="input-overtime-multiplier"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Break Duration (min)</Label>
                      <Input
                        type="number"
                        value={companyForm.breakDurationMinutes}
                        onChange={(e) => setCompanyForm(prev => ({ ...prev, breakDurationMinutes: parseInt(e.target.value) || 30 }))}
                      />
                    </div>
                    <div>
                      <Label>Auto Clock-Out (min)</Label>
                      <Input
                        type="number"
                        value={companyForm.autoClockOutMinutes}
                        onChange={(e) => setCompanyForm(prev => ({ ...prev, autoClockOutMinutes: parseInt(e.target.value) || 480 }))}
                      />
                    </div>
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Geofence Enforcement</p>
                      <p className="text-xs text-muted-foreground">Require employees to be at a work location to clock in</p>
                    </div>
                    <Switch
                      checked={companyForm.geofenceEnforcement}
                      onCheckedChange={(checked) => setCompanyForm(prev => ({ ...prev, geofenceEnforcement: checked }))}
                      data-testid="switch-geofence"
                    />
                  </div>

                  <Button
                    onClick={handleSaveSettings}
                    disabled={updateSettingsMutation.isPending}
                    className="w-full"
                    data-testid="button-save-settings"
                  >
                    {updateSettingsMutation.isPending ? (
                      <><i className="fas fa-spinner fa-spin mr-2"></i>Saving...</>
                    ) : (
                      <><i className="fas fa-save mr-2"></i>Save Settings</>
                    )}
                  </Button>
                </CardContent>
              </Card>

              <Card className={isMobile ? "" : "col-span-2"}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <i className="fas fa-link text-primary"></i>
                    Quick Access
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Button variant="outline" className="h-auto py-4 flex flex-col items-center gap-2" onClick={() => navigate('/team')}>
                      <i className="fas fa-users text-blue-500 text-lg"></i>
                      <span className="text-xs font-medium">Team</span>
                      <span className="text-[10px] text-muted-foreground">{activeUsers.length} members</span>
                    </Button>
                    <Button variant="outline" className="h-auto py-4 flex flex-col items-center gap-2" onClick={() => navigate('/hr/roles')}>
                      <i className="fas fa-shield-alt text-purple-500 text-lg"></i>
                      <span className="text-xs font-medium">Roles & Permissions</span>
                      <span className="text-[10px] text-muted-foreground">{roles.length} roles</span>
                    </Button>
                    <Button variant="outline" className="h-auto py-4 flex flex-col items-center gap-2" onClick={() => navigate('/payroll')}>
                      <i className="fas fa-dollar-sign text-green-500 text-lg"></i>
                      <span className="text-xs font-medium">Payroll</span>
                      <span className="text-[10px] text-muted-foreground">Pay periods</span>
                    </Button>
                    <Button variant="outline" className="h-auto py-4 flex flex-col items-center gap-2" onClick={() => navigate('/schedules')}>
                      <i className="fas fa-calendar-alt text-amber-500 text-lg"></i>
                      <span className="text-xs font-medium">Schedules</span>
                      <span className="text-[10px] text-muted-foreground">Manage shifts</span>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="locations">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{locations.length} work location{locations.length !== 1 ? 's' : ''}</p>
                <Dialog open={showAddLocation} onOpenChange={setShowAddLocation}>
                  <DialogTrigger asChild>
                    <Button size="sm" data-testid="button-add-location">
                      <i className="fas fa-plus mr-2"></i>Add Location
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Work Location</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleAddLocation} className="space-y-4">
                      <div>
                        <Label htmlFor="loc-name">Location Name</Label>
                        <Input id="loc-name" name="name" placeholder="e.g., Main Office" required data-testid="input-location-name" />
                      </div>
                      <div>
                        <Label htmlFor="loc-address">Address</Label>
                        <Input id="loc-address" name="address" placeholder="123 Main St, City, State" data-testid="input-location-address" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label htmlFor="loc-lat">Latitude</Label>
                          <Input id="loc-lat" name="latitude" type="number" step="any" placeholder="40.7128" />
                        </div>
                        <div>
                          <Label htmlFor="loc-lng">Longitude</Label>
                          <Input id="loc-lng" name="longitude" type="number" step="any" placeholder="-74.0060" />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="loc-radius">Geofence Radius (meters)</Label>
                        <Input id="loc-radius" name="radius" type="number" defaultValue={100} />
                      </div>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setShowAddLocation(false)}>Cancel</Button>
                        <Button type="submit" disabled={addLocationMutation.isPending} data-testid="button-save-location">
                          {addLocationMutation.isPending ? 'Adding...' : 'Add Location'}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>

              {locationsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => <div key={i} className="animate-pulse h-20 bg-muted rounded-lg"></div>)}
                </div>
              ) : locations.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <i className="fas fa-map-marker-alt text-muted-foreground text-3xl mb-3"></i>
                    <p className="text-sm text-muted-foreground mb-4">No work locations set up yet</p>
                    <Button variant="outline" size="sm" onClick={() => setShowAddLocation(true)}>
                      <i className="fas fa-plus mr-2"></i>Add Your First Location
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {locations.map((loc) => (
                    <Card key={loc.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex items-start gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <i className="fas fa-map-marker-alt text-green-600 dark:text-green-400 text-sm"></i>
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-sm">{loc.name}</p>
                              {loc.address && <p className="text-xs text-muted-foreground truncate">{loc.address}</p>}
                              <div className="flex items-center gap-2 mt-1.5">
                                {loc.latitude && loc.longitude && (
                                  <Badge variant="outline" className="text-[10px]">
                                    <i className="fas fa-crosshairs mr-1"></i>
                                    {Number(loc.latitude).toFixed(4)}, {Number(loc.longitude).toFixed(4)}
                                  </Badge>
                                )}
                                <Badge variant="secondary" className="text-[10px]">
                                  {loc.radius}m radius
                                </Badge>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => setEditingLocation(loc)}
                            >
                              <i className="fas fa-edit text-xs text-muted-foreground"></i>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => {
                                if (confirm('Are you sure you want to delete this location?')) {
                                  deleteLocationMutation.mutate(loc.id);
                                }
                              }}
                            >
                              <i className="fas fa-trash text-xs"></i>
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            <Dialog open={!!editingLocation} onOpenChange={(open) => !open && setEditingLocation(null)}>
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
                        <Label htmlFor="edit-lat">Latitude</Label>
                        <Input id="edit-lat" name="latitude" type="number" step="any" defaultValue={editingLocation.latitude ? String(editingLocation.latitude) : ''} />
                      </div>
                      <div>
                        <Label htmlFor="edit-lng">Longitude</Label>
                        <Input id="edit-lng" name="longitude" type="number" step="any" defaultValue={editingLocation.longitude ? String(editingLocation.longitude) : ''} />
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
          </TabsContent>

          <TabsContent value="activity">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <i className="fas fa-history text-primary"></i>
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                {activityLogs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8">
                    <i className="fas fa-clipboard-list text-muted-foreground text-2xl mb-3"></i>
                    <p className="text-sm text-muted-foreground">No activity recorded yet</p>
                    <p className="text-xs text-muted-foreground mt-1">Actions like settings changes and user management will appear here</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activityLogs.map((log) => (
                      <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                          log.action === 'delete' ? 'bg-red-100 dark:bg-red-900/30' :
                          log.action === 'create' ? 'bg-green-100 dark:bg-green-900/30' :
                          'bg-blue-100 dark:bg-blue-900/30'
                        }`}>
                          <i className={`fas text-xs ${
                            log.action === 'delete' ? 'fa-trash text-red-600 dark:text-red-400' :
                            log.action === 'create' ? 'fa-plus text-green-600 dark:text-green-400' :
                            'fa-edit text-blue-600 dark:text-blue-400'
                          }`}></i>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{formatLogAction(log)}</p>
                          {log.details && <p className="text-xs text-muted-foreground truncate">{log.details}</p>}
                        </div>
                        <span className="text-xs text-muted-foreground flex-shrink-0">
                          {formatLogTime(log.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="shopify">
            <div className="space-y-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <i className="fab fa-shopify text-green-600"></i>
                    Store Connection
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1">
                      <Label htmlFor="shopify-domain">Store Domain</Label>
                      <div className="flex items-center gap-2 mt-1">
                        <Input
                          id="shopify-domain"
                          placeholder="your-store"
                          value={shopifyDomain}
                          onChange={(e) => setShopifyDomain(e.target.value)}
                        />
                        <span className="text-sm text-muted-foreground whitespace-nowrap">.myshopify.com</span>
                      </div>
                    </div>
                    <div className="flex items-end">
                      <Button
                        onClick={() => {
                          const domain = shopifyDomain.includes('.myshopify.com')
                            ? shopifyDomain
                            : `${shopifyDomain}.myshopify.com`;
                          connectShopifyMutation.mutate(domain);
                        }}
                        disabled={!shopifyDomain || connectShopifyMutation.isPending}
                      >
                        {connectShopifyMutation.isPending ? (
                          <><i className="fas fa-spinner fa-spin mr-2"></i>Connecting...</>
                        ) : (
                          <><i className="fas fa-plug mr-2"></i>Connect Store</>
                        )}
                      </Button>
                    </div>
                  </div>

                  <Separator />

                  {shopsLoading ? (
                    <div className="space-y-3">
                      {[1, 2].map(i => <div key={i} className="animate-pulse h-16 bg-muted rounded-lg"></div>)}
                    </div>
                  ) : shopifyShops.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8">
                      <i className="fas fa-store text-muted-foreground text-2xl mb-3"></i>
                      <p className="text-sm text-muted-foreground">No Shopify stores connected</p>
                      <p className="text-xs text-muted-foreground mt-1">Enter your store domain above to get started</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm font-medium">Connected Stores</p>
                      {shopifyShops.map((shop: any) => (
                        <div key={shop.id} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                              <i className="fab fa-shopify text-green-600 dark:text-green-400"></i>
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-sm">{shop.shopName || shop.shopDomain}</p>
                              <p className="text-xs text-muted-foreground truncate">{shop.shopDomain}</p>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                {shop.currency && (
                                  <Badge variant="outline" className="text-[10px]">{shop.currency}</Badge>
                                )}
                                {shop.lastSyncAt && (
                                  <span className="text-[10px] text-muted-foreground">
                                    Last sync: {new Date(shop.lastSyncAt).toLocaleDateString()}
                                  </span>
                                )}
                                <Badge variant={shop.isActive ? "default" : "secondary"} className="text-[10px]">
                                  {shop.isActive ? 'Active' : 'Inactive'}
                                </Badge>
                              </div>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive flex-shrink-0"
                            onClick={() => disconnectShopifyMutation.mutate(shop.shopDomain)}
                            disabled={disconnectShopifyMutation.isPending}
                          >
                            {disconnectShopifyMutation.isPending ? (
                              <i className="fas fa-spinner fa-spin"></i>
                            ) : (
                              <><i className="fas fa-unlink mr-1"></i>Disconnect</>
                            )}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {connectedShop && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <i className="fas fa-sync text-primary"></i>
                      Sales Data Sync
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Sync Shopify Sales Data</p>
                        <p className="text-xs text-muted-foreground">Import the last 365 days of sales data from your store</p>
                        {connectedShop.lastSyncAt && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Last synced: {new Date(connectedShop.lastSyncAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                      <Button
                        onClick={() => syncSalesMutation.mutate(connectedShop.shopDomain)}
                        disabled={syncSalesMutation.isPending}
                      >
                        {syncSalesMutation.isPending ? (
                          <><i className="fas fa-spinner fa-spin mr-2"></i>Syncing...</>
                        ) : (
                          <><i className="fas fa-download mr-2"></i>Sync Sales Data</>
                        )}
                      </Button>
                    </div>
                    {syncSalesMutation.isPending && (
                      <div className="w-full bg-muted rounded-full h-2">
                        <div className="bg-primary h-2 rounded-full animate-pulse" style={{ width: '60%' }}></div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {salesData?.summary && (
                <>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <i className="fas fa-chart-bar text-primary"></i>
                        Sales Analytics
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                          <p className="text-xs text-muted-foreground">Total Revenue</p>
                          <p className="text-lg font-bold text-green-700 dark:text-green-400">
                            ${Number(salesData.summary.totalRevenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                        </div>
                        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                          <p className="text-xs text-muted-foreground">Total Orders</p>
                          <p className="text-lg font-bold text-blue-700 dark:text-blue-400">
                            {Number(salesData.summary.totalOrders || 0).toLocaleString()}
                          </p>
                        </div>
                        <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800">
                          <p className="text-xs text-muted-foreground">Avg Daily Revenue</p>
                          <p className="text-lg font-bold text-purple-700 dark:text-purple-400">
                            ${Number(salesData.summary.avgDailyRevenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                        </div>
                        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                          <p className="text-xs text-muted-foreground">Avg Daily Orders</p>
                          <p className="text-lg font-bold text-amber-700 dark:text-amber-400">
                            {Number(salesData.summary.avgDailyOrders || 0).toFixed(1)}
                          </p>
                        </div>
                      </div>

                      {salesData.dayOfWeek && salesData.dayOfWeek.length > 0 && (
                        <>
                          <Separator />
                          <div>
                            <p className="text-sm font-medium mb-3">Revenue by Day of Week</p>
                            <div className="space-y-2">
                              {(() => {
                                const maxRevenue = Math.max(...salesData.dayOfWeek.map((d: any) => Number(d.avgRevenue || 0)));
                                return salesData.dayOfWeek.map((day: any) => {
                                  const pct = maxRevenue > 0 ? (Number(day.avgRevenue || 0) / maxRevenue) * 100 : 0;
                                  return (
                                    <div key={day.day} className="flex items-center gap-3">
                                      <span className="text-xs font-medium w-12 text-right">{day.day?.slice(0, 3)}</span>
                                      <div className="flex-1 bg-muted rounded-full h-6 relative overflow-hidden">
                                        <div
                                          className="bg-primary/80 h-full rounded-full transition-all duration-500"
                                          style={{ width: `${pct}%` }}
                                        ></div>
                                      </div>
                                      <div className="text-right min-w-[100px]">
                                        <span className="text-xs font-medium">
                                          ${Number(day.avgRevenue || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground ml-1">
                                          ({Number(day.avgOrders || 0).toFixed(1)} orders)
                                        </span>
                                      </div>
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <i className="fas fa-robot text-primary"></i>
                        AI Staffing Recommendations
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {!staffingRecs ? (
                        <div className="flex flex-col items-center py-6">
                          <p className="text-sm text-muted-foreground mb-3">Get AI-powered staffing recommendations based on your sales data</p>
                          <Button
                            onClick={() => refetchStaffing()}
                            disabled={staffingLoading}
                          >
                            {staffingLoading ? (
                              <><i className="fas fa-spinner fa-spin mr-2"></i>Analyzing...</>
                            ) : (
                              <><i className="fas fa-magic mr-2"></i>Get Staffing Recommendations</>
                            )}
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {staffingRecs.insight && (
                            <div className="p-4 rounded-lg bg-muted/50 border">
                              <p className="text-sm font-medium mb-1 flex items-center gap-2">
                                <i className="fas fa-lightbulb text-amber-500"></i>
                                AI Insight
                              </p>
                              <p className="text-sm text-muted-foreground">{staffingRecs.insight}</p>
                            </div>
                          )}

                          {staffingRecs.recommendations && staffingRecs.recommendations.length > 0 && (
                            <div>
                              <p className="text-sm font-medium mb-3">Daily Staffing Levels</p>
                              <div className="grid gap-2">
                                {staffingRecs.recommendations.map((rec: any) => (
                                  <div key={rec.day} className="flex items-center justify-between p-3 rounded-lg border">
                                    <div className="flex items-center gap-3">
                                      <span className="text-sm font-medium w-24">{rec.day}</span>
                                      <Badge className={`text-xs ${getStaffingLevelColor(rec.level)}`}>
                                        {rec.level?.replace('_', ' ')}
                                      </Badge>
                                    </div>
                                    <div className="text-right">
                                      <span className="text-sm font-medium">{rec.multiplier ? `${rec.multiplier}x` : '-'}</span>
                                      <span className="text-xs text-muted-foreground ml-1">staff</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => refetchStaffing()}
                            disabled={staffingLoading}
                          >
                            {staffingLoading ? (
                              <><i className="fas fa-spinner fa-spin mr-2"></i>Refreshing...</>
                            ) : (
                              <><i className="fas fa-refresh mr-2"></i>Refresh Recommendations</>
                            )}
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
