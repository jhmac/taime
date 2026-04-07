import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { WorkLocation } from '@shared/schema';
import {
  MapPin, Phone, Mail, Clock, Globe, Plus, Edit2, Trash2,
  ChevronDown, ChevronUp, CheckCircle2, XCircle, Building2,
  ExternalLink,
} from 'lucide-react';

const DAYS = [
  { key: 'monday', label: 'Mon', full: 'Monday' },
  { key: 'tuesday', label: 'Tue', full: 'Tuesday' },
  { key: 'wednesday', label: 'Wed', full: 'Wednesday' },
  { key: 'thursday', label: 'Thu', full: 'Thursday' },
  { key: 'friday', label: 'Fri', full: 'Friday' },
  { key: 'saturday', label: 'Sat', full: 'Saturday' },
  { key: 'sunday', label: 'Sun', full: 'Sunday' },
];

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'America/Anchorage', label: 'Alaska (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HT)' },
];

const DEFAULT_HOURS = Object.fromEntries(
  DAYS.map(({ key }) => [
    key,
    { isOpen: key !== 'sunday', open: key === 'saturday' ? '10:00' : '09:00', close: key === 'saturday' ? '17:00' : '18:00' },
  ])
);

type DayHours = { isOpen: boolean; open: string; close: string };
type HoursMap = Record<string, DayHours>;

function formatHours(hours: HoursMap | null | undefined) {
  if (!hours) return null;
  const openDays = DAYS.filter(d => hours[d.key]?.isOpen);
  if (openDays.length === 0) return 'Closed all week';
  if (openDays.length === 7) {
    const first = hours[DAYS[0].key];
    const allSame = DAYS.every(d => hours[d.key].open === first.open && hours[d.key].close === first.close);
    if (allSame) return `Daily ${formatTime(first.open)} – ${formatTime(first.close)}`;
  }
  return `Open ${openDays.length} days/week`;
}

function formatTime(t: string) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return m === 0 ? `${hour} ${ampm}` : `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

function HoursEditor({ value, onChange }: { value: HoursMap; onChange: (h: HoursMap) => void }) {
  const update = (day: string, field: keyof DayHours, val: string | boolean) => {
    onChange({ ...value, [day]: { ...value[day], [field]: val } });
  };
  return (
    <div className="space-y-2">
      {DAYS.map(({ key, full }) => {
        const day = value[key] || { isOpen: false, open: '09:00', close: '18:00' };
        return (
          <div key={key} className="flex items-center gap-3">
            <Switch checked={day.isOpen} onCheckedChange={v => update(key, 'isOpen', v)} />
            <span className={cn('w-24 text-sm', day.isOpen ? 'text-foreground' : 'text-muted-foreground')}>{full}</span>
            {day.isOpen ? (
              <div className="flex items-center gap-2 flex-1">
                <Input type="time" value={day.open} onChange={e => update(key, 'open', e.target.value)}
                  className="h-8 text-sm w-28" />
                <span className="text-muted-foreground text-sm">–</span>
                <Input type="time" value={day.close} onChange={e => update(key, 'close', e.target.value)}
                  className="h-8 text-sm w-28" />
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Closed</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LocationCard({
  loc, onEdit, onDelete,
}: {
  loc: WorkLocation;
  onEdit: (loc: WorkLocation) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hours = loc.hoursOfOperation as HoursMap | null;
  const mapsUrl = loc.address ? `https://maps.google.com?q=${encodeURIComponent(loc.address)}` : null;

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-base text-foreground">{loc.name}</h3>
                <Badge variant={loc.isActive ? 'default' : 'secondary'} className="text-[11px]">
                  {loc.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </div>
              {loc.address && (
                <div className="flex items-center gap-1.5 mt-1">
                  <MapPin className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <a
                    href={mapsUrl || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-muted-foreground hover:text-primary truncate flex items-center gap-1"
                  >
                    {loc.address}
                    {mapsUrl && <ExternalLink className="w-3 h-3 flex-shrink-0" />}
                  </a>
                </div>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                {loc.phone && (
                  <a href={`tel:${loc.phone}`} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary">
                    <Phone className="w-3.5 h-3.5" />{loc.phone}
                  </a>
                )}
                {loc.email && (
                  <a href={`mailto:${loc.email}`} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary">
                    <Mail className="w-3.5 h-3.5" />{loc.email}
                  </a>
                )}
                {loc.timezone && (
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Globe className="w-3.5 h-3.5" />
                    {TIMEZONES.find(t => t.value === loc.timezone)?.label || loc.timezone}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(loc)}>
              <Edit2 className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => onDelete(loc.id)}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {hours && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Clock className="w-3.5 h-3.5" />
            <span>{formatHours(hours) || 'View hours'}</span>
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {expanded && hours && (
        <div className="border-t border-border bg-muted/30 px-4 py-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {DAYS.map(({ key, label }) => {
              const day = hours[key];
              return (
                <div key={key} className="flex items-center gap-3 text-sm">
                  <span className="w-8 text-muted-foreground font-medium">{label}</span>
                  {day?.isOpen ? (
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      {formatTime(day.open)} – {formatTime(day.close)}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <XCircle className="w-3.5 h-3.5" /> Closed
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

type LocationFormData = {
  name: string;
  address: string;
  phone: string;
  email: string;
  timezone: string;
  hoursOfOperation: HoursMap;
};

function LocationForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Partial<LocationFormData & WorkLocation>;
  onSave: (data: LocationFormData) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<LocationFormData>({
    name: initial?.name || '',
    address: initial?.address || '',
    phone: initial?.phone || '',
    email: initial?.email || '',
    timezone: initial?.timezone || 'America/Chicago',
    hoursOfOperation: (initial?.hoursOfOperation as HoursMap) || { ...DEFAULT_HOURS },
  });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <Label>Location name *</Label>
          <Input
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Libby Story Ridgeland"
            className="mt-1"
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Address</Label>
          <Input
            value={form.address}
            onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
            placeholder="123 Main St, City, ST 12345"
            className="mt-1"
          />
        </div>
        <div>
          <Label>Phone</Label>
          <Input
            value={form.phone}
            onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
            placeholder="(601) 856-0080"
            className="mt-1"
          />
        </div>
        <div>
          <Label>Email</Label>
          <Input
            type="email"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            placeholder="ridgeland@libbystory.com"
            className="mt-1"
          />
        </div>
        <div>
          <Label>Timezone</Label>
          <select
            value={form.timezone}
            onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}
            className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {TIMEZONES.map(tz => (
              <option key={tz.value} value={tz.value}>{tz.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label className="block mb-3">Hours of operation</Label>
        <HoursEditor value={form.hoursOfOperation} onChange={h => setForm(f => ({ ...f, hoursOfOperation: h }))} />
      </div>

      <div className="flex gap-2 pt-2">
        <Button onClick={() => onSave(form)} disabled={!form.name || saving}>
          {saving ? 'Saving…' : 'Save location'}
        </Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export default function StoreLocationsSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<WorkLocation | null>(null);

  const { data: locations = [], isLoading } = useQuery<WorkLocation[]>({
    queryKey: ['/api/work-locations'],
  });

  const createMutation = useMutation({
    mutationFn: (data: LocationFormData) => apiRequest('POST', '/api/work-locations', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/work-locations'] });
      setShowAdd(false);
      toast({ title: 'Location added', description: 'New store location created successfully.' });
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: LocationFormData }) =>
      apiRequest('PUT', `/api/work-locations/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/work-locations'] });
      setEditing(null);
      toast({ title: 'Location updated', description: 'Store location saved successfully.' });
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/work-locations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/work-locations'] });
      toast({ title: 'Location removed' });
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const handleDelete = (id: string) => {
    if (!confirm('Remove this location? This cannot be undone.')) return;
    deleteMutation.mutate(id);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Store locations</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage your store locations, contact info, and hours of operation.
          </p>
        </div>
        {!showAdd && !editing && (
          <Button onClick={() => setShowAdd(true)} size="sm" className="gap-1.5">
            <Plus className="w-4 h-4" /> Add location
          </Button>
        )}
      </div>

      {showAdd && (
        <div className="border border-border rounded-xl p-5 bg-card">
          <h3 className="font-semibold mb-4">New location</h3>
          <LocationForm
            onSave={data => createMutation.mutate(data)}
            onCancel={() => setShowAdd(false)}
            saving={createMutation.isPending}
          />
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : locations.length === 0 ? (
        <div className="border-2 border-dashed border-border rounded-xl p-10 text-center">
          <Building2 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium text-foreground">No locations yet</p>
          <p className="text-sm text-muted-foreground mt-1">Add your first store location to get started.</p>
          <Button className="mt-4 gap-1.5" onClick={() => setShowAdd(true)}>
            <Plus className="w-4 h-4" /> Add location
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {locations.map(loc =>
            editing?.id === loc.id ? (
              <div key={loc.id} className="border border-primary/30 rounded-xl p-5 bg-card">
                <h3 className="font-semibold mb-4">Edit — {loc.name}</h3>
                <LocationForm
                  initial={loc as any}
                  onSave={data => updateMutation.mutate({ id: loc.id, data })}
                  onCancel={() => setEditing(null)}
                  saving={updateMutation.isPending}
                />
              </div>
            ) : (
              <LocationCard
                key={loc.id}
                loc={loc}
                onEdit={setEditing}
                onDelete={handleDelete}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}
