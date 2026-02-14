import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Edit } from 'lucide-react';
import { TIMEZONES } from '@/components/settings/constants';
import type { BasicInfoSectionProps } from '@/components/settings/types';

export default function BasicInfoSection({
  settingsForm,
  updateForm,
  locations,
  showAddLocation,
  setShowAddLocation,
  editingLocation,
  setEditingLocation,
  addLocationMutation,
  updateLocationMutation,
  deleteLocationMutation,
  handleAddLocation,
  handleUpdateLocation,
}: BasicInfoSectionProps) {
  return (
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
}
