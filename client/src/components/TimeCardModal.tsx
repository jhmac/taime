import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidatePrefix } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  CheckCircle2,
  Lock,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Clock,
  MapPin,
  Edit3,
  X,
  Save,
  History,
  MessageSquare,
  Phone,
  Mail,
} from "lucide-react";

interface TimeCardEntry {
  id: string;
  clockInTime: string;
  clockOutTime: string | null;
  breakMinutes: number;
  hours: number;
  isApproved: boolean;
  notes: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  locationId?: string | null;
  clockInSource?: string | null;
  clockOutSource?: string | null;
}

interface EmployeeInfo {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  email: string | null;
  phone?: string | null;
}

interface EditHistoryItem {
  id: string;
  timeEntryId: string;
  editedBy: string;
  editedAt: string;
  fieldChanged: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
}

interface OffsiteSessionData {
  id: string;
  exitTime: string;
  returnTime: string | null;
  durationMinutes: number | null;
  status: string;
  ruleId: string | null;
  userName?: string;
}

interface TimeCardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: TimeCardEntry | null;
  employee: EmployeeInfo | null;
  date: string;
  allEntries?: TimeCardEntry[];
  onNavigate?: (direction: "prev" | "next") => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

function formatTimeForInput(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function formatTimeDisplay(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDateDisplay(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h} hr ${m} min`;
}

function formatFieldName(field: string): string {
  const map: Record<string, string> = {
    clockInTime: "Clock In",
    clockOutTime: "Clock Out",
    breakMinutes: "Break Minutes",
    notes: "Notes",
    isApproved: "Approval Status",
    locationId: "Location",
  };
  return map[field] || field;
}

function formatHistoryValue(field: string, value: string | null): string {
  if (value === null || value === "null") return "—";
  if (field === "clockInTime" || field === "clockOutTime") {
    try {
      return new Date(value).toLocaleString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        month: "short",
        day: "numeric",
      });
    } catch {
      return value;
    }
  }
  if (field === "isApproved") {
    return value === "true" ? "Approved" : "Not Approved";
  }
  return value;
}

export default function TimeCardModal({
  open,
  onOpenChange,
  entry,
  employee,
  date,
  onNavigate,
  hasPrev = false,
  hasNext = false,
}: TimeCardModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [editClockIn, setEditClockIn] = useState("");
  const [editClockOut, setEditClockOut] = useState("");
  const [editBreakMinutes, setEditBreakMinutes] = useState("");
  const [editReason, setEditReason] = useState("");
  const [managerNote, setManagerNote] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const fullName =
    [employee?.firstName, employee?.lastName].filter(Boolean).join(" ") ||
    "Unknown";
  const initials =
    (
      (employee?.firstName?.[0] || "") + (employee?.lastName?.[0] || "")
    ).toUpperCase() || "?";

  const { data: editHistory, isLoading: historyLoading } = useQuery<
    EditHistoryItem[]
  >({
    queryKey: ["/api/time-entries", entry?.id, "history"],
    enabled: !!entry?.id && open,
  });

  const { data: offsiteSessions } = useQuery<OffsiteSessionData[]>({
    queryKey: ["/api/offsite-sessions/employee", employee?.userId],
    enabled: !!employee?.userId && open,
    select: (sessions: OffsiteSessionData[]) => {
      if (!entry) return [];
      const entryStart = new Date(entry.clockInTime).getTime();
      const entryEnd = entry.clockOutTime ? new Date(entry.clockOutTime).getTime() : Date.now();
      return sessions.filter((s) => {
        const exitTime = new Date(s.exitTime).getTime();
        return exitTime >= entryStart && exitTime <= entryEnd;
      });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!entry) return;
      await apiRequest("POST", `/api/timesheets/approve-entry/${entry.id}`);
    },
    onSuccess: () => {
      toast({
        title: "Entry approved",
        description: "Time entry has been approved.",
      });
      invalidatePrefix("/api/timesheets/review");
      queryClient.invalidateQueries({
        queryKey: ["/api/time-entries", entry?.id, "history"],
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const lockMutation = useMutation({
    mutationFn: async () => {
      if (!entry) return;
      await apiRequest("PATCH", `/api/time-entries/${entry.id}`, {
        isApproved: true,
        editReason: "Locked via time card detail",
      });
    },
    onSuccess: () => {
      toast({
        title: "Entry locked",
        description: "This time entry has been locked.",
      });
      invalidatePrefix("/api/timesheets/review");
      queryClient.invalidateQueries({
        queryKey: ["/api/time-entries", entry?.id, "history"],
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!entry) return;
      const updates: Record<string, any> = {};

      if (editClockIn) {
        const d = new Date(entry.clockInTime);
        const [h, m] = editClockIn.split(":").map(Number);
        d.setHours(h, m, 0, 0);
        updates.clockInTime = d.toISOString();
      }

      if (editClockOut) {
        const base = entry.clockOutTime
          ? new Date(entry.clockOutTime)
          : new Date(entry.clockInTime);
        const [h, m] = editClockOut.split(":").map(Number);
        base.setHours(h, m, 0, 0);
        updates.clockOutTime = base.toISOString();
      }

      if (editBreakMinutes !== "") {
        updates.breakMinutes = parseInt(editBreakMinutes, 10);
      }

      if (managerNote) {
        updates.notes = managerNote;
      }

      updates.editReason = editReason || "Edited via time card detail";

      await apiRequest("PATCH", `/api/time-entries/${entry.id}`, updates);
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Time entry updated." });
      setIsEditing(false);
      setEditReason("");
      setManagerNote("");
      invalidatePrefix("/api/timesheets/review");
      queryClient.invalidateQueries({
        queryKey: ["/api/time-entries", entry?.id, "history"],
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const startEditing = () => {
    if (!entry) return;
    setEditClockIn(formatTimeForInput(entry.clockInTime));
    setEditClockOut(formatTimeForInput(entry.clockOutTime));
    setEditBreakMinutes(String(entry.breakMinutes || 0));
    setManagerNote(entry.notes || "");
    setEditReason("");
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditReason("");
  };

  if (!entry || !employee) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg">Time Card Detail</DialogTitle>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={!hasPrev}
                onClick={() => onNavigate?.("prev")}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={!hasNext}
                onClick={() => onNavigate?.("next")}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={employee.profileImageUrl || undefined} />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <p className="font-semibold">{fullName}</p>
              <p className="text-sm text-muted-foreground">
                {formatDateDisplay(date)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {employee.email && (
              <span className="flex items-center gap-1">
                <Mail className="h-3 w-3" />
                {employee.email}
              </span>
            )}
            {employee.phone && (
              <span className="flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {employee.phone}
              </span>
            )}
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-sm">Worked Time</span>
              </div>
              {entry.isApproved ? (
                <Badge
                  variant="default"
                  className="bg-green-600 hover:bg-green-700"
                >
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Approved
                </Badge>
              ) : (
                <Badge variant="secondary">Pending</Badge>
              )}
            </div>

            <div className="bg-muted/50 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {formatDuration(entry.hours)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {formatTimeDisplay(entry.clockInTime)} –{" "}
                  {formatTimeDisplay(entry.clockOutTime)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>
                  <span className="block text-muted-foreground/60">
                    Clock In Source
                  </span>
                  <span>{entry.clockInSource || "manual"}</span>
                </div>
                <div>
                  <span className="block text-muted-foreground/60">
                    Clock Out Source
                  </span>
                  <span>{entry.clockOutSource || "—"}</span>
                </div>
              </div>
            </div>

            <div className="bg-muted/50 rounded-lg p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Break Time</span>
                <span className="font-medium">
                  {entry.breakMinutes || 0} min
                </span>
              </div>
            </div>
          </div>

          {offsiteSessions && offsiteSessions.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm">Off-Site Sessions</span>
                  <Badge variant="secondary" className="text-[10px] px-1.5">
                    {offsiteSessions.length}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {offsiteSessions.map((session) => {
                    const statusColor = session.status === "returned"
                      ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30"
                      : session.status === "exceeded"
                      ? "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30"
                      : session.status === "auto_clocked_out"
                      ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30"
                      : "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30";
                    const statusText = session.status === "returned"
                      ? "Returned"
                      : session.status === "exceeded"
                      ? "Exceeded"
                      : session.status === "auto_clocked_out"
                      ? "Auto Clocked Out"
                      : "Active";
                    const statusTextColor = session.status === "returned"
                      ? "text-green-700 dark:text-green-400"
                      : session.status === "exceeded"
                      ? "text-amber-700 dark:text-amber-400"
                      : session.status === "auto_clocked_out"
                      ? "text-red-700 dark:text-red-400"
                      : "text-blue-700 dark:text-blue-400";

                    return (
                      <div key={session.id} className={`rounded-lg border p-3 ${statusColor}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            {formatTimeDisplay(session.exitTime)}
                            {session.returnTime ? ` – ${formatTimeDisplay(session.returnTime)}` : " – still out"}
                          </span>
                          <Badge variant="outline" className={`text-[10px] ${statusTextColor}`}>
                            {statusText}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {session.durationMinutes != null
                            ? `${session.durationMinutes} min off-site`
                            : "Duration pending"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {entry.locationId && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm">
                    Location / Geofence
                  </span>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground">
                  <p>Location ID: {entry.locationId}</p>
                  <p className="text-xs mt-1">
                    Clock-in and clock-out locations validated via geofence.
                  </p>
                </div>
              </div>
            </>
          )}

          <Separator />

          {!isEditing ? (
            <div className="space-y-3">
              {entry.notes && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">Manager Notes</span>
                  </div>
                  <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
                    {entry.notes}
                  </p>
                </div>
              )}

              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={startEditing}>
                  <Edit3 className="h-3.5 w-3.5 mr-1" />
                  Edit
                </Button>
                {!entry.isApproved && (
                  <Button
                    size="sm"
                    onClick={() => approveMutation.mutate()}
                    disabled={approveMutation.isPending}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    {approveMutation.isPending ? "Approving…" : "Approve"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => lockMutation.mutate()}
                  disabled={lockMutation.isPending}
                >
                  <Lock className="h-3.5 w-3.5 mr-1" />
                  {lockMutation.isPending ? "Locking…" : "Lock"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 border rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">Edit Time Card</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={cancelEditing}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Clock In</Label>
                  <Input
                    type="time"
                    value={editClockIn}
                    onChange={(e) => setEditClockIn(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Clock Out</Label>
                  <Input
                    type="time"
                    value={editClockOut}
                    onChange={(e) => setEditClockOut(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs">Break Minutes</Label>
                <Input
                  type="number"
                  min={0}
                  value={editBreakMinutes}
                  onChange={(e) => setEditBreakMinutes(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>

              <div>
                <Label className="text-xs">Notes</Label>
                <Textarea
                  value={managerNote}
                  onChange={(e) => setManagerNote(e.target.value)}
                  placeholder="Add manager notes…"
                  className="text-sm min-h-[60px]"
                />
              </div>

              <div>
                <Label className="text-xs">
                  Reason for edit{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="e.g. Employee forgot to clock out"
                  className="h-8 text-sm"
                />
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                >
                  <Save className="h-3.5 w-3.5 mr-1" />
                  {saveMutation.isPending ? "Saving…" : "Save Changes"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={cancelEditing}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <Separator />

          <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-between"
              >
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4" />
                  <span className="text-sm font-medium">Edit History</span>
                  {editHistory && editHistory.length > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5">
                      {editHistory.length}
                    </Badge>
                  )}
                </div>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${historyOpen ? "rotate-180" : ""}`}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 space-y-2 max-h-[200px] overflow-y-auto">
                {historyLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : editHistory && editHistory.length > 0 ? (
                  editHistory.map((item) => (
                    <div
                      key={item.id}
                      className="bg-muted/50 rounded p-2 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {formatFieldName(item.fieldChanged)}
                        </span>
                        <span className="text-muted-foreground">
                          {new Date(item.editedAt).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true,
                          })}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <span className="line-through">
                          {formatHistoryValue(item.fieldChanged, item.oldValue)}
                        </span>
                        <span>→</span>
                        <span className="font-medium text-foreground">
                          {formatHistoryValue(item.fieldChanged, item.newValue)}
                        </span>
                      </div>
                      {item.reason && (
                        <p className="text-muted-foreground italic">
                          "{item.reason}"
                        </p>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground py-2 text-center">
                    No edit history for this entry.
                  </p>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </DialogContent>
    </Dialog>
  );
}
