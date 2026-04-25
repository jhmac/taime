import { useState, useEffect } from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva } from "class-variance-authority";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Trash2, Calendar, Clock, MapPin, User, StickyNote, Briefcase, X } from "lucide-react";
import type { Schedule } from "@shared/schema";

interface EmpUser {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
}

interface WorkLocation {
  id: string;
  name: string;
}

interface Props {
  schedule: Schedule | null;
  onClose: () => void;
  employees: EmpUser[];
  locations: WorkLocation[];
  isUpdating: boolean;
  isDeleting: boolean;
  onUpdate: (data: {
    id: string;
    userId: string;
    startTime: Date;
    endTime: Date;
    title?: string | null;
    locationId?: string | null;
    description?: string | null;
  }) => void;
  onDelete: (id: string) => void;
}

const panelVariants = cva(
  "fixed inset-y-0 right-0 z-40 flex h-full flex-col bg-background border-l shadow-2xl " +
  "w-[min(26rem,100vw)] " +
  "transition-transform duration-300 ease-in-out " +
  "data-[state=open]:translate-x-0 data-[state=closed]:translate-x-full"
);

function displayName(emp: EmpUser): string {
  return `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'Unknown';
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function EditShiftPanel({
  schedule,
  onClose,
  employees,
  locations,
  isUpdating,
  isDeleting,
  onUpdate,
  onDelete,
}: Props) {
  const [userId, setUserId] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [title, setTitle] = useState('');
  const [locationId, setLocationId] = useState('');
  const [description, setDescription] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (!schedule) return;
    const st = new Date(schedule.startTime);
    const et = new Date(schedule.endTime);
    setUserId(schedule.userId || '');
    setDate(localDateStr(st));
    setStartTime(`${pad(st.getHours())}:${pad(st.getMinutes())}`);
    setEndTime(`${pad(et.getHours())}:${pad(et.getMinutes())}`);
    setTitle(schedule.title || '');
    setLocationId(schedule.locationId || '');
    setDescription(schedule.description || '');
    setShowDeleteConfirm(false);
  }, [schedule]);

  const handleSave = () => {
    if (!schedule || !userId || !date) return;
    const [y, mo, d2] = date.split('-').map(Number);
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const startDate = new Date(y, mo - 1, d2, sh, sm, 0, 0);
    const endDate = new Date(y, mo - 1, d2, eh, em, 0, 0);
    if (endDate <= startDate) endDate.setDate(endDate.getDate() + 1);
    onUpdate({
      id: schedule.id,
      userId,
      startTime: startDate,
      endTime: endDate,
      title: title || null,
      locationId: locationId || null,
      description: description || null,
    });
  };

  const shiftLabel = schedule
    ? new Date(schedule.startTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : '';

  return (
    <>
      <SheetPrimitive.Root
        modal={false}
        open={!!schedule}
        onOpenChange={(open) => { if (!open) onClose(); }}
      >
        <SheetPrimitive.Portal>
          <SheetPrimitive.Content
            className={panelVariants()}
            onPointerDownOutside={() => onClose()}
            onEscapeKeyDown={() => onClose()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b shrink-0">
              <div className="flex items-center gap-2 text-base font-semibold">
                <Calendar className="h-4 w-4 text-primary shrink-0" />
                Edit Shift
                {shiftLabel && (
                  <span className="text-sm font-normal text-muted-foreground ml-1">— {shiftLabel}</span>
                )}
              </div>
              <SheetPrimitive.Close
                className="rounded-sm opacity-70 hover:opacity-100 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </SheetPrimitive.Close>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Employee */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  Employee
                </Label>
                <Select value={userId} onValueChange={setUserId}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Select employee" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map(emp => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {displayName(emp)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  Date
                </Label>
                <Input
                  type="date"
                  className="h-9 text-sm"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                />
              </div>

              {/* Start / End Time */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    Start
                  </Label>
                  <Input
                    type="time"
                    className="h-9 text-sm"
                    value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    End
                  </Label>
                  <Input
                    type="time"
                    className="h-9 text-sm"
                    value={endTime}
                    onChange={e => setEndTime(e.target.value)}
                  />
                </div>
              </div>

              {/* Duration hint */}
              {date && startTime && endTime && (
                <div className="text-xs text-muted-foreground -mt-2">
                  {(() => {
                    const [sh2, sm2] = startTime.split(':').map(Number);
                    const [eh2, em2] = endTime.split(':').map(Number);
                    let mins = (eh2 * 60 + em2) - (sh2 * 60 + sm2);
                    if (mins <= 0) mins += 1440;
                    const hrs = Math.floor(mins / 60);
                    const remaining = mins % 60;
                    return remaining > 0 ? `${hrs}h ${remaining}m shift` : `${hrs}h shift`;
                  })()}
                </div>
              )}

              {/* Role / Title */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium flex items-center gap-1.5">
                  <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                  Role / Title
                  <span className="text-muted-foreground font-normal ml-1">(optional)</span>
                </Label>
                <Input
                  className="h-9 text-sm"
                  placeholder="e.g. Opener, Floor, Closer…"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                />
              </div>

              {/* Location */}
              {locations.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                    Location
                  </Label>
                  <Select value={locationId || '__none'} onValueChange={v => setLocationId(v === '__none' ? '' : v)}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Select location" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">No location</SelectItem>
                      {locations.map(loc => (
                        <SelectItem key={loc.id} value={loc.id}>
                          {loc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Notes */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium flex items-center gap-1.5">
                  <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
                  Notes
                  <span className="text-muted-foreground font-normal ml-1">(optional)</span>
                </Label>
                <Textarea
                  className="text-sm resize-none min-h-[72px]"
                  placeholder="Any notes for this shift…"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                />
              </div>
            </div>

            {/* Footer Actions */}
            <div className="border-t px-5 py-4 flex items-center justify-between gap-3 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isDeleting || isUpdating}
              >
                {isDeleting
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
                Delete
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={onClose} disabled={isUpdating || isDeleting}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={isUpdating || isDeleting || !userId || !date}
                >
                  {isUpdating
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Saving…</>
                    : 'Save Changes'}
                </Button>
              </div>
            </div>
          </SheetPrimitive.Content>
        </SheetPrimitive.Portal>
      </SheetPrimitive.Root>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this shift?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the shift from the schedule. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (schedule) onDelete(schedule.id);
                setShowDeleteConfirm(false);
              }}
            >
              Delete Shift
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
