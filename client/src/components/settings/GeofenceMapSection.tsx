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
import { MapPin, Plus, Trash2, Circle, Pentagon, Crosshair, Save, Settings2, Shield, Clock, Search, Undo2 } from 'lucide-react';

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

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
      { headers: { 'Accept': 'application/json' } }
    );
    const results = await response.json();
    if (results && results.length > 0) {
      return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
    }
    return null;
  } catch {
    return null;
  }
}

function MapComponent({ location, onLocationChange, onPolygonChange, isDrawing, drawMode, flyToCoords, externalPolygonPoints }: {
  location: WorkLocation | null;
  onLocationChange: (lat: number, lng: number) => void;
  onPolygonChange: (points: Array<{ lat: number; lng: number }>) => void;
  isDrawing: boolean;
  drawMode: 'radius' | 'polygon';
  flyToCoords: { lat: number; lng: number } | null;
  externalPolygonPoints: Array<{ lat: number; lng: number }>;
}) {
  const mapRef = useRef<any>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const circleRef = useRef<any>(null);
  const polygonRef = useRef<any>(null);
  const polygonPointsRef = useRef<Array<{ lat: number; lng: number }>>([]);
  const markersRef = useRef<any[]>([]);
  const isDrawingRef = useRef(isDrawing);
  const drawModeRef = useRef(drawMode);
  const onLocationChangeRef = useRef(onLocationChange);
  const onPolygonChangeRef = useRef(onPolygonChange);
  const skipNextDisplayUpdate = useRef(false);
  const lastExternalUpdateRef = useRef<string>('');

  useEffect(() => { isDrawingRef.current = isDrawing; }, [isDrawing]);
  useEffect(() => { drawModeRef.current = drawMode; }, [drawMode]);
  useEffect(() => { onLocationChangeRef.current = onLocationChange; }, [onLocationChange]);
  useEffect(() => { onPolygonChangeRef.current = onPolygonChange; }, [onPolygonChange]);

  const renderPolygonMarkers = useCallback((points: Array<{ lat: number; lng: number }>, editable: boolean) => {
    if (!mapInstanceRef.current || !window.L) return;
    const L = window.L;
    const map = mapInstanceRef.current;

    markersRef.current.forEach((m: any) => map.removeLayer(m));
    markersRef.current = [];
    if (polygonRef.current) {
      map.removeLayer(polygonRef.current);
      polygonRef.current = null;
    }

    points.forEach((p, idx) => {
      if (editable) {
        const m = L.marker([p.lat, p.lng], {
          draggable: true,
          icon: L.divIcon({
            className: 'polygon-point-marker',
            html: `<div style="background:#3b82f6;width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3);cursor:grab;"></div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6],
          }),
        }).addTo(map);
        m.on('dragend', () => {
          const pos = m.getLatLng();
          polygonPointsRef.current[idx] = { lat: pos.lat, lng: pos.lng };
          skipNextDisplayUpdate.current = true;
          onPolygonChangeRef.current([...polygonPointsRef.current]);
        });
        m.on('drag', () => {
          const pos = m.getLatLng();
          const tempPoints = [...polygonPointsRef.current];
          tempPoints[idx] = { lat: pos.lat, lng: pos.lng };
          if (polygonRef.current) map.removeLayer(polygonRef.current);
          if (tempPoints.length >= 2) {
            polygonRef.current = L.polygon(
              tempPoints.map((pt: any) => [pt.lat, pt.lng]),
              { color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.15, weight: 2 }
            ).addTo(map);
          }
        });
        markersRef.current.push(m);
      } else {
        const m = L.circleMarker([p.lat, p.lng], {
          radius: 6, fillColor: '#3b82f6', fillOpacity: 1, color: '#fff', weight: 2
        }).addTo(map);
        markersRef.current.push(m);
      }
    });

    if (points.length >= 2) {
      polygonRef.current = L.polygon(
        points.map(pt => [pt.lat, pt.lng]),
        { color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.15, weight: 2 }
      ).addTo(map);
    }
  }, []);

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
        updateMapDisplay(location, true);
      }

      map.on('click', (e: any) => {
        if (isDrawingRef.current && drawModeRef.current === 'polygon') {
          polygonPointsRef.current.push({ lat: e.latlng.lat, lng: e.latlng.lng });
          skipNextDisplayUpdate.current = true;
          renderPolygonMarkers([...polygonPointsRef.current], false);
          onPolygonChangeRef.current([...polygonPointsRef.current]);
        } else if (drawModeRef.current === 'polygon' && !isDrawingRef.current) {
          return;
        } else {
          onLocationChangeRef.current(e.latlng.lat, e.latlng.lng);
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

  const updateMapDisplay = useCallback((loc: WorkLocation, shouldFitBounds: boolean) => {
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
    polygonRef.current = null;

    if (!loc.latitude || !loc.longitude) return;

    const geofenceType = loc.geofenceType || 'radius';

    markerRef.current = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'custom-marker',
        html: `<div style="background:#3b82f6;width:24px;height:24px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);"></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }),
    }).addTo(map);

    if (geofenceType === 'polygon' && loc.geofencePolygon && loc.geofencePolygon.length >= 3) {
      polygonRef.current = L.polygon(
        loc.geofencePolygon.map((p: any) => [p.lat, p.lng]),
        { color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.15, weight: 2, dashArray: '5,5' }
      ).addTo(map);
      if (shouldFitBounds) {
        map.fitBounds(polygonRef.current.getBounds(), { padding: [50, 50] });
      }
    } else if (geofenceType !== 'polygon') {
      const radius = loc.radius || 100;
      circleRef.current = L.circle([lat, lng], {
        radius,
        color: '#3b82f6',
        fillColor: '#3b82f6',
        fillOpacity: 0.15,
        weight: 2,
        dashArray: '5,5',
      }).addTo(map);
      if (shouldFitBounds) {
        map.fitBounds(circleRef.current.getBounds(), { padding: [50, 50] });
      }
    }
  }, []);

  useEffect(() => {
    if (!mapInstanceRef.current) return;
    if (skipNextDisplayUpdate.current) {
      skipNextDisplayUpdate.current = false;
      return;
    }
    if (isDrawingRef.current && drawModeRef.current === 'polygon') return;
    if (location && location.latitude && location.longitude) {
      updateMapDisplay(location, false);
    }
  }, [location, updateMapDisplay]);

  useEffect(() => {
    if (flyToCoords && mapInstanceRef.current) {
      mapInstanceRef.current.setView([flyToCoords.lat, flyToCoords.lng], 17, { animate: true });
    }
  }, [flyToCoords]);

  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    if (isDrawing && drawMode === 'polygon') {
      polygonPointsRef.current = [];
      markersRef.current.forEach((m: any) => map.removeLayer(m));
      markersRef.current = [];
      if (polygonRef.current) {
        map.removeLayer(polygonRef.current);
        polygonRef.current = null;
      }
      map.getContainer().style.cursor = 'crosshair';
    } else {
      map.getContainer().style.cursor = '';
      if (drawMode === 'polygon' && polygonPointsRef.current.length >= 1) {
        renderPolygonMarkers([...polygonPointsRef.current], true);
      }
    }
  }, [isDrawing, drawMode, renderPolygonMarkers]);

  useEffect(() => {
    if (!mapInstanceRef.current || !window.L) return;
    if (drawModeRef.current !== 'polygon') return;

    const key = JSON.stringify(externalPolygonPoints);
    if (key === lastExternalUpdateRef.current) return;
    lastExternalUpdateRef.current = key;

    if (skipNextDisplayUpdate.current) {
      skipNextDisplayUpdate.current = false;
      return;
    }

    polygonPointsRef.current = [...externalPolygonPoints];
    const editable = !isDrawingRef.current && externalPolygonPoints.length >= 1;
    renderPolygonMarkers(externalPolygonPoints, editable);
  }, [externalPolygonPoints, renderPolygonMarkers]);

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
  const [flyToCoords, setFlyToCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geocoding, setGeocoding] = useState(false);

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
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/work-locations', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/work-locations'] });
      setIsCreating(false);
      resetForm();
      toast({ title: "Location Created", description: "New store location added with geofence." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create location.", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest('PUT', `/api/work-locations/${id}`, data);
      return res.json();
    },
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
    const geoType = (loc.geofenceType as 'radius' | 'polygon') || 'radius';
    setFormGeofenceType(geoType);
    setDrawMode(geoType);
    setFormPolygon(loc.geofencePolygon || []);
    setFormGraceMinutes(loc.geofenceGraceMinutes ?? 5);
    setFormGeofenceEnabled(loc.geofenceEnabled !== false);
    setFormAutoClockOut(loc.autoClockOut !== false);
    setIsDrawing(false);
  };

  const handleSave = () => {
    if (!formName.trim()) {
      toast({ title: "Missing Info", description: "Please enter a location name.", variant: "destructive" });
      return;
    }

    if (formGeofenceType === 'polygon') {
      if (formPolygon.length < 3) {
        toast({ title: "Missing Boundary", description: "Please draw at least 3 points for a polygon boundary.", variant: "destructive" });
        return;
      }
      const center = formPolygon.reduce(
        (acc, p) => ({ lat: acc.lat + p.lat / formPolygon.length, lng: acc.lng + p.lng / formPolygon.length }),
        { lat: 0, lng: 0 }
      );
      const data = {
        name: formName.trim(),
        address: formAddress.trim() || null,
        latitude: center.lat,
        longitude: center.lng,
        radius: formRadius,
        geofenceType: 'polygon',
        geofencePolygon: formPolygon,
        geofenceGraceMinutes: formGraceMinutes,
        geofenceEnabled: formGeofenceEnabled,
        autoClockOut: formAutoClockOut,
      };
      if (isEditing && selectedLocation) {
        updateMutation.mutate({ id: selectedLocation.id, data });
      } else {
        createMutation.mutate(data);
      }
    } else {
      if (!formLat || !formLng) {
        toast({ title: "Missing Location", description: "Please click the map or enter an address to set the location.", variant: "destructive" });
        return;
      }
      const data = {
        name: formName.trim(),
        address: formAddress.trim() || null,
        latitude: parseFloat(formLat),
        longitude: parseFloat(formLng),
        radius: formRadius,
        geofenceType: 'radius',
        geofencePolygon: null,
        geofenceGraceMinutes: formGraceMinutes,
        geofenceEnabled: formGeofenceEnabled,
        autoClockOut: formAutoClockOut,
      };
      if (isEditing && selectedLocation) {
        updateMutation.mutate({ id: selectedLocation.id, data });
      } else {
        createMutation.mutate(data);
      }
    }
  };

  const handleMapClick = (lat: number, lng: number) => {
    if (isCreating || isEditing) {
      setFormLat(lat.toFixed(8));
      setFormLng(lng.toFixed(8));
    }
  };

  const handleAddressLookup = async () => {
    if (!formAddress.trim()) return;
    setGeocoding(true);
    const coords = await geocodeAddress(formAddress.trim());
    setGeocoding(false);
    if (coords) {
      setFormLat(coords.lat.toFixed(8));
      setFormLng(coords.lng.toFixed(8));
      setFlyToCoords({ lat: coords.lat, lng: coords.lng });
      toast({ title: "Address Found", description: "Map moved to the address location. You can fine-tune by clicking the map." });
    } else {
      toast({ title: "Address Not Found", description: "Could not find that address. Try a more specific address or click the map directly.", variant: "destructive" });
    }
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

  const handleUndoLastPoint = () => {
    if (formPolygon.length > 0) {
      setFormPolygon(prev => prev.slice(0, -1));
    }
  };

  const displayLocation: WorkLocation | null = isCreating
    ? {
        id: 'new', name: formName, address: formAddress,
        latitude: formLat || null, longitude: formLng || null,
        radius: formRadius, isActive: true,
        geofenceType: formGeofenceType,
        geofencePolygon: null,
        geofenceGraceMinutes: formGraceMinutes,
        geofenceEnabled: formGeofenceEnabled,
        autoClockOut: formAutoClockOut,
      }
    : isEditing && selectedLocation
      ? {
          ...selectedLocation,
          latitude: formLat || selectedLocation.latitude,
          longitude: formLng || selectedLocation.longitude,
          radius: formRadius,
          geofenceType: formGeofenceType,
          geofencePolygon: null,
        }
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
                onClick={() => {
                  setSelectedLocation(loc);
                  setIsEditing(false);
                  setIsCreating(false);
                  if (loc.latitude && loc.longitude) {
                    setFlyToCoords({ lat: parseFloat(loc.latitude), lng: parseFloat(loc.longitude) });
                  }
                }}
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

          {isDrawing && (
            <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex items-center gap-2">
              <Crosshair className="h-4 w-4 text-blue-600 shrink-0" />
              <p className="text-sm text-blue-800 dark:text-blue-300 flex-1">
                Drawing mode active — click on the map to add points to your polygon boundary.
                {formPolygon.length > 0 && ` (${formPolygon.length} point${formPolygon.length !== 1 ? 's' : ''} placed)`}
              </p>
              <Button variant="outline" size="sm" className="h-7 text-xs shrink-0" onClick={() => setIsDrawing(false)}>
                Done Drawing
              </Button>
            </div>
          )}

          <MapComponent
            location={displayLocation}
            onLocationChange={handleMapClick}
            onPolygonChange={setFormPolygon}
            isDrawing={isDrawing}
            drawMode={drawMode}
            flyToCoords={flyToCoords}
            externalPolygonPoints={formPolygon}
          />

          {(isCreating || isEditing) && (
            <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{isCreating ? 'New Location' : `Edit: ${formName}`}</h3>
                <Button variant="ghost" size="sm" onClick={() => { setIsCreating(false); setIsEditing(false); resetForm(); }}>
                  Cancel
                </Button>
              </div>

              <div>
                <Label className="text-xs">Location Name</Label>
                <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Main Store" />
              </div>

              <div>
                <Label className="text-xs">Address</Label>
                <div className="flex gap-2">
                  <Input
                    value={formAddress}
                    onChange={e => setFormAddress(e.target.value)}
                    placeholder="123 Main St, City, State"
                    className="flex-1"
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddressLookup(); } }}
                    onBlur={() => { if (formAddress.trim()) handleAddressLookup(); }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 shrink-0"
                    onClick={handleAddressLookup}
                    disabled={geocoding || !formAddress.trim()}
                  >
                    <Search className="h-3 w-3" />
                    {geocoding ? 'Searching...' : 'Find on Map'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Type an address and the map will auto-locate when you leave the field. You can also click "Find on Map" or click directly on the map.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Latitude</Label>
                  <Input value={formLat} onChange={e => setFormLat(e.target.value)} placeholder="Auto-set from address/map" readOnly className="bg-muted/50" />
                </div>
                <div>
                  <Label className="text-xs">Longitude</Label>
                  <Input value={formLng} onChange={e => setFormLng(e.target.value)} placeholder="Auto-set from address/map" readOnly className="bg-muted/50" />
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-medium">Geofence Boundary</span>
                </div>
                <Select value={formGeofenceType} onValueChange={(v: 'radius' | 'polygon') => {
                  setFormGeofenceType(v);
                  setIsDrawing(false);
                  if (v === 'polygon') {
                    setDrawMode('polygon');
                    setFormPolygon([]);
                  } else {
                    setDrawMode('radius');
                  }
                }}>
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
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <p className="text-xs text-muted-foreground">
                      {formPolygon.length === 0
                        ? 'Click "Start Drawing" then click on the map to place boundary points.'
                        : formPolygon.length < 3
                          ? `${formPolygon.length} point${formPolygon.length !== 1 ? 's' : ''} placed — need at least ${3 - formPolygon.length} more.`
                          : `${formPolygon.length} points — boundary complete.`}
                    </p>
                    <div className="flex gap-1">
                      {!isDrawing ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1 h-7 text-xs"
                          onClick={() => { setIsDrawing(true); setDrawMode('polygon'); }}
                        >
                          <Crosshair className="h-3 w-3" />
                          {formPolygon.length > 0 ? 'Redraw Boundary' : 'Start Drawing'}
                        </Button>
                      ) : (
                        <Button
                          variant="default"
                          size="sm"
                          className="gap-1 h-7 text-xs"
                          onClick={() => setIsDrawing(false)}
                        >
                          <Crosshair className="h-3 w-3" />
                          Done Drawing
                        </Button>
                      )}
                      {formPolygon.length > 0 && (
                        <>
                          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={handleUndoLastPoint}>
                            <Undo2 className="h-3 w-3" /> Undo
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => { setFormPolygon([]); setIsDrawing(true); setDrawMode('polygon'); }}>
                            Clear All
                          </Button>
                        </>
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
                  disabled={!formName || createMutation.isPending || updateMutation.isPending}
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
