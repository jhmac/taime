import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { MapPin, Plus, Trash2, Circle, Pentagon, Crosshair, Save, Settings2, Shield, Clock } from 'lucide-react';

declare global {
  interface Window {
    L: any;
  }
}

interface WorkLocation {
  id: string;
  name: string;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  radius: number | null;
  isActive: boolean;
  geofenceType: string | null;
  geofencePolygon: Array<{ lat: number; lng: number }> | null;
  geofenceGraceMinutes: number | null;
  geofenceEnabled: boolean | null;
  autoClockOut: boolean | null;
}

function loadLeaflet(): Promise<void> {
  return new Promise((resolve) => {
    if (window.L) { resolve(); return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => resolve();
    document.head.appendChild(script);
  });
}

function MapComponent({ location, onLocationChange, onPolygonChange, isDrawing, drawMode }: {
  location: WorkLocation | null;
  onLocationChange: (lat: number, lng: number) => void;
  onPolygonChange: (points: Array<{ lat: number; lng: number }>) => void;
  isDrawing: boolean;
  drawMode: 'radius' | 'polygon';
}) {
  const mapRef = useRef<any>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const circleRef = useRef<any>(null);
  const polygonRef = useRef<any>(null);
  const polygonPointsRef = useRef<Array<{ lat: number; lng: number }>>([]);
  const markersRef = useRef<any[]>([]);

  useEffect(() => {
    loadLeaflet().then(() => {
      if (!mapRef.current || mapInstanceRef.current) return;
      const L = window.L;
      const lat = location?.latitude ? parseFloat(location.latitude) : 39.8283;
      const lng = location?.longitude ? parseFloat(location.longitude) : -98.5795;
      const zoom = location?.latitude ? 16 : 4;

      const map = L.map(mapRef.current, { zoomControl: true }).setView([lat, lng], zoom);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      mapInstanceRef.current = map;

      if (location?.latitude && location?.longitude) {
        updateMapDisplay(location);
      }

      map.on('click', (e: any) => {
        if (isDrawing && drawMode === 'polygon') {
          polygonPointsRef.current.push({ lat: e.latlng.lat, lng: e.latlng.lng });
          const m = L.circleMarker(e.latlng, { radius: 5, fillColor: '#3b82f6', fillOpacity: 1, color: '#fff', weight: 2 }).addTo(map);
          markersRef.current.push(m);
          if (polygonPointsRef.current.length >= 2) {
            if (polygonRef.current) map.removeLayer(polygonRef.current);
            polygonRef.current = L.polygon(polygonPointsRef.current.map((p: any) => [p.lat, p.lng]), {
              color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.15, weight: 2,
            }).addTo(map);
          }
          onPolygonChange([...polygonPointsRef.current]);
        } else if (!isDrawing) {
          onLocationChange(e.latlng.lat, e.latlng.lng);
        }
      });
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  const updateMapDisplay = useCallback((loc: WorkLocation) => {
    if (!mapInstanceRef.current || !window.L) return;
    const L = window.L;
    const map = mapInstanceRef.current;
    const lat = parseFloat(loc.latitude || '0');
    const lng = parseFloat(loc.longitude || '0');

    if (markerRef.current) map.removeLayer(markerRef.current);
    if (circleRef.current) map.removeLayer(circleRef.current);
    if (polygonRef.current) map.removeLayer(polygonRef.current);
    markersRef.current.forEach((m: any) => map.removeLayer(m));
    markersRef.current = [];

    markerRef.current = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'custom-marker',
        html: `<div style="background:#3b82f6;width:24px;height:24px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);"></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }),
    }).addTo(map);

    const geofenceType = loc.geofenceType || 'radius';
    if (geofenceType === 'polygon' && loc.geofencePolygon && loc.geofencePolygon.length >= 3) {
      polygonRef.current = L.polygon(
        loc.geofencePolygon.map((p: any) => [p.lat, p.lng]),
        { color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.15, weight: 2, dashArray: '5,5' }
      ).addTo(map);
      map.fitBounds(polygonRef.current.getBounds(), { padding: [50, 50] });
    } else {
      const radius = loc.radius || 100;
      circleRef.current = L.circle([lat, lng], {
        radius,
        color: '#3b82f6',
        fillColor: '#3b82f6',
        fillOpacity: 0.15,
        weight: 2,
        dashArray: '5,5',
      }).addTo(map);
      map.fitBounds(circleRef.current.getBounds(), { padding: [50, 50] });
    }
  }, []);

  useEffect(() => {
    if (location && location.latitude && location.longitude && mapInstanceRef.current) {
      updateMapDisplay(location);
    }
  }, [location, updateMapDisplay]);

  useEffect(() => {
    if (isDrawing && drawMode === 'polygon') {
      polygonPointsRef.current = [];
      markersRef.current.forEach((m: any) => {
        if (mapInstanceRef.current) mapInstanceRef.current.removeLayer(m);
      });
      markersRef.current = [];
      if (polygonRef.current && mapInstanceRef.current) {
        mapInstanceRef.current.removeLayer(polygonRef.current);
        polygonRef.current = null;
      }
    }
  }, [isDrawing, drawMode]);

  return (
    <div ref={mapRef} className="w-full h-[400px] rounded-lg border" style={{ zIndex: 0 }} />
  );
}

export default function GeofenceMapSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: locations, isLoading } = useQuery<WorkLocation[]>({
    queryKey: ['/api/work-locations'],
  });

  const [selectedLocation, setSelectedLocation] = useState<WorkLocation | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawMode, setDrawMode] = useState<'radius' | 'polygon'>('radius');

  const [formName, setFormName] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formLat, setFormLat] = useState('');
  const [formLng, setFormLng] = useState('');
  const [formRadius, setFormRadius] = useState(100);
  const [formGeofenceType, setFormGeofenceType] = useState<'radius' | 'polygon'>('radius');
  const [formPolygon, setFormPolygon] = useState<Array<{ lat: number; lng: number }>>([]);
  const [formGraceMinutes, setFormGraceMinutes] = useState(5);
  const [formGeofenceEnabled, setFormGeofenceEnabled] = useState(true);
  const [formAutoClockOut, setFormAutoClockOut] = useState(true);

  const createMutation = useMutation({
    mutationFn: async (data: any) => apiRequest('POST', '/api/work-locations', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/work-locations'] });
      setIsCreating(false);
      resetForm();
      toast({ title: "Location Created", description: "New store location added with geofence." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create location.", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => apiRequest('PUT', `/api/work-locations/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/work-locations'] });
      setIsEditing(false);
      toast({ title: "Saved", description: "Location updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update location.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest('DELETE', `/api/work-locations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/work-locations'] });
      setSelectedLocation(null);
      toast({ title: "Removed", description: "Location deactivated." });
    },
  });

  const resetForm = () => {
    setFormName('');
    setFormAddress('');
    setFormLat('');
    setFormLng('');
    setFormRadius(100);
    setFormGeofenceType('radius');
    setFormPolygon([]);
    setFormGraceMinutes(5);
    setFormGeofenceEnabled(true);
    setFormAutoClockOut(true);
    setIsDrawing(false);
  };

  const loadLocationIntoForm = (loc: WorkLocation) => {
    setFormName(loc.name);
    setFormAddress(loc.address || '');
    setFormLat(loc.latitude || '');
    setFormLng(loc.longitude || '');
    setFormRadius(loc.radius || 100);
    setFormGeofenceType((loc.geofenceType as 'radius' | 'polygon') || 'radius');
    setFormPolygon(loc.geofencePolygon || []);
    setFormGraceMinutes(loc.geofenceGraceMinutes ?? 5);
    setFormGeofenceEnabled(loc.geofenceEnabled !== false);
    setFormAutoClockOut(loc.autoClockOut !== false);
  };

  const handleSave = () => {
    const data = {
      name: formName,
      address: formAddress || null,
      latitude: formLat ? parseFloat(formLat) : null,
      longitude: formLng ? parseFloat(formLng) : null,
      radius: formRadius,
      geofenceType: formGeofenceType,
      geofencePolygon: formGeofenceType === 'polygon' ? formPolygon : null,
      geofenceGraceMinutes: formGraceMinutes,
      geofenceEnabled: formGeofenceEnabled,
      autoClockOut: formAutoClockOut,
    };

    if (isEditing && selectedLocation) {
      updateMutation.mutate({ id: selectedLocation.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleMapClick = (lat: number, lng: number) => {
    setFormLat(lat.toFixed(8));
    setFormLng(lng.toFixed(8));
  };

  const startCreate = () => {
    resetForm();
    setIsCreating(true);
    setIsEditing(false);
    setSelectedLocation(null);
  };

  const startEdit = (loc: WorkLocation) => {
    loadLocationIntoForm(loc);
    setSelectedLocation(loc);
    setIsEditing(true);
    setIsCreating(false);
  };

  const displayLocation: WorkLocation | null = isCreating
    ? { id: 'new', name: formName, address: formAddress, latitude: formLat, longitude: formLng, radius: formRadius, isActive: true, geofenceType: formGeofenceType, geofencePolygon: formGeofenceType === 'polygon' ? formPolygon : null, geofenceGraceMinutes: formGraceMinutes, geofenceEnabled: formGeofenceEnabled, autoClockOut: formAutoClockOut }
    : isEditing && selectedLocation
      ? { ...selectedLocation, latitude: formLat, longitude: formLng, radius: formRadius, geofenceType: formGeofenceType, geofencePolygon: formGeofenceType === 'polygon' ? formPolygon : null }
      : selectedLocation;

  if (isLoading) {
    return <div className="p-4">Loading locations...</div>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            Store Locations & Geofencing
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Add your store locations and draw geofence boundaries on the map. Employees will be tracked within these boundaries when clocked in.
            Click the map to set a location, then configure the geofence shape and settings.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            {locations?.map(loc => (
              <Button
                key={loc.id}
                variant={selectedLocation?.id === loc.id ? "default" : "outline"}
                size="sm"
                className="gap-1.5"
                onClick={() => { setSelectedLocation(loc); setIsEditing(false); setIsCreating(false); }}
              >
                <MapPin className="h-3 w-3" />
                {loc.name}
                {loc.geofenceEnabled !== false && (
                  <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-1">
                    {(loc.geofenceType || 'radius') === 'polygon' ? 'Polygon' : `${loc.radius || 100}m`}
                  </Badge>
                )}
              </Button>
            ))}
            <Button variant="outline" size="sm" className="gap-1 border-dashed" onClick={startCreate}>
              <Plus className="h-3 w-3" /> Add Location
            </Button>
          </div>

          <MapComponent
            location={displayLocation}
            onLocationChange={handleMapClick}
            onPolygonChange={setFormPolygon}
            isDrawing={isDrawing}
            drawMode={drawMode}
          />

          {(isCreating || isEditing) && (
            <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{isCreating ? 'New Location' : `Edit: ${formName}`}</h3>
                <Button variant="ghost" size="sm" onClick={() => { setIsCreating(false); setIsEditing(false); resetForm(); }}>
                  Cancel
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Location Name</Label>
                  <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Main Store" />
                </div>
                <div>
                  <Label className="text-xs">Address</Label>
                  <Input value={formAddress} onChange={e => setFormAddress(e.target.value)} placeholder="123 Main St" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Latitude</Label>
                  <Input value={formLat} onChange={e => setFormLat(e.target.value)} placeholder="Click map to set" />
                </div>
                <div>
                  <Label className="text-xs">Longitude</Label>
                  <Input value={formLng} onChange={e => setFormLng(e.target.value)} placeholder="Click map to set" />
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-medium">Geofence Boundary</span>
                </div>
                <Select value={formGeofenceType} onValueChange={(v: 'radius' | 'polygon') => setFormGeofenceType(v)}>
                  <SelectTrigger className="w-36 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="radius">
                      <div className="flex items-center gap-1.5">
                        <Circle className="h-3 w-3" /> Circle Radius
                      </div>
                    </SelectItem>
                    <SelectItem value="polygon">
                      <div className="flex items-center gap-1.5">
                        <Pentagon className="h-3 w-3" /> Custom Polygon
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formGeofenceType === 'radius' ? (
                <div>
                  <Label className="text-xs">Radius (meters)</Label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={25}
                      max={500}
                      step={25}
                      value={formRadius}
                      onChange={e => setFormRadius(parseInt(e.target.value))}
                      className="flex-1"
                    />
                    <span className="text-sm font-mono w-14 text-right">{formRadius}m</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formRadius < 50 ? 'Very tight — requires employees to be right at the door' :
                     formRadius < 150 ? 'Standard — covers the building and immediate area' :
                     formRadius < 300 ? 'Wide — includes parking lot area' :
                     'Very wide — covers a large campus area'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      Click points on the map to draw a custom boundary. {formPolygon.length < 3 ? `Need ${3 - formPolygon.length} more point(s).` : `${formPolygon.length} points drawn.`}
                    </p>
                    <div className="flex gap-1">
                      <Button
                        variant={isDrawing ? "default" : "outline"}
                        size="sm"
                        className="gap-1 h-7 text-xs"
                        onClick={() => { setIsDrawing(!isDrawing); setDrawMode('polygon'); }}
                      >
                        <Crosshair className="h-3 w-3" />
                        {isDrawing ? 'Stop Drawing' : 'Draw Boundary'}
                      </Button>
                      {formPolygon.length > 0 && (
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setFormPolygon([]); setIsDrawing(true); }}>
                          Clear
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <Separator />

              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Settings2 className="h-3.5 w-3.5" />
                    <span className="text-xs">Geofencing Active</span>
                  </div>
                  <Switch checked={formGeofenceEnabled} onCheckedChange={setFormGeofenceEnabled} />
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5" />
                    <span className="text-xs">Auto Clock-Out</span>
                  </div>
                  <Switch checked={formAutoClockOut} onCheckedChange={setFormAutoClockOut} />
                </div>
              </div>

              {formAutoClockOut && (
                <div>
                  <Label className="text-xs">Grace Period (minutes before auto clock-out)</Label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={1}
                      max={30}
                      value={formGraceMinutes}
                      onChange={e => setFormGraceMinutes(parseInt(e.target.value))}
                      className="flex-1"
                    />
                    <span className="text-sm font-mono w-10 text-right">{formGraceMinutes}m</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    After leaving the geofence, the employee has {formGraceMinutes} minute{formGraceMinutes !== 1 ? 's' : ''} to return before being automatically clocked out.
                  </p>
                </div>
              )}

              <div className="flex justify-between pt-2">
                {isEditing && selectedLocation && (
                  <Button variant="destructive" size="sm" onClick={() => deleteMutation.mutate(selectedLocation.id)}>
                    <Trash2 className="h-3 w-3 mr-1" /> Remove Location
                  </Button>
                )}
                <div className="flex-1" />
                <Button
                  onClick={handleSave}
                  disabled={!formName || !formLat || !formLng || createMutation.isPending || updateMutation.isPending}
                  className="gap-1.5"
                >
                  <Save className="h-3.5 w-3.5" />
                  {createMutation.isPending || updateMutation.isPending ? 'Saving...' : isCreating ? 'Create Location' : 'Save Changes'}
                </Button>
              </div>
            </div>
          )}

          {selectedLocation && !isEditing && !isCreating && (
            <div className="p-4 bg-muted/30 rounded-lg border space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">{selectedLocation.name}</h3>
                  {selectedLocation.address && <p className="text-xs text-muted-foreground">{selectedLocation.address}</p>}
                </div>
                <Button variant="outline" size="sm" onClick={() => startEdit(selectedLocation)}>
                  Edit
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">
                  {(selectedLocation.geofenceType || 'radius') === 'polygon'
                    ? `Polygon (${selectedLocation.geofencePolygon?.length || 0} points)`
                    : `Circle: ${selectedLocation.radius || 100}m radius`}
                </Badge>
                <Badge variant={selectedLocation.geofenceEnabled !== false ? 'default' : 'secondary'}>
                  {selectedLocation.geofenceEnabled !== false ? 'Geofence Active' : 'Geofence Off'}
                </Badge>
                {selectedLocation.autoClockOut !== false && (
                  <Badge variant="outline">Auto Clock-Out: {selectedLocation.geofenceGraceMinutes ?? 5}min grace</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Coordinates: {selectedLocation.latitude}, {selectedLocation.longitude}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
