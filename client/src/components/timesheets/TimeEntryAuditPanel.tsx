import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ChevronDown, ChevronUp, Clock, Edit2, LogIn, LogOut, Coffee, MapPin, Zap, History } from "lucide-react";
import { cn } from "@/lib/utils";

interface AuditEvent {
  id: string;
  eventType: string;
  timestamp: string;
  actorId: string;
  actorName: string;
  label: string;
  detail?: Record<string, unknown> | null;
}

interface AuditTrailData {
  entryId: string;
  employee: { id: string; firstName: string | null; lastName: string | null; email: string | null } | null;
  clockInTime: string;
  clockOutTime: string | null;
  hasBreakEventRecords: boolean;
  events: AuditEvent[];
}

function formatTs(ts: string): string {
  try {
    return format(new Date(ts), "MMM d, yyyy 'at' h:mm a");
  } catch {
    return ts;
  }
}

function formatFieldValue(field: string, value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (field === "clockInTime" || field === "clockOutTime" || field === "approvedAt") {
    try {
      return format(new Date(value), "MMM d, yyyy h:mm a");
    } catch {
      return value;
    }
  }
  if (field === "isApproved") return value === "true" ? "Approved" : "Unapproved";
  if (field === "breakMinutes") return `${value} min`;
  return value;
}

function EventIcon({ eventType }: { eventType: string }) {
  const base = "h-4 w-4 flex-shrink-0";
  switch (eventType) {
    case "clock_in":
      return <LogIn className={cn(base, "text-green-600 dark:text-green-400")} />;
    case "clock_out":
      return <LogOut className={cn(base, "text-blue-600 dark:text-blue-400")} />;
    case "break_start":
      return <Coffee className={cn(base, "text-amber-500")} />;
    case "break_end":
      return <Coffee className={cn(base, "text-amber-700 dark:text-amber-400")} />;
    case "edit":
      return <Edit2 className={cn(base, "text-violet-600 dark:text-violet-400")} />;
    case "geofence_exit":
    case "geofence_enter":
    case "auto_clock_out":
    case "location_check":
      return <MapPin className={cn(base, "text-orange-500")} />;
    default:
      return <Zap className={cn(base, "text-muted-foreground")} />;
  }
}

function eventTypeColor(eventType: string): string {
  switch (eventType) {
    case "clock_in": return "border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-950/30";
    case "clock_out": return "border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-950/30";
    case "break_start":
    case "break_end": return "border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/20";
    case "edit": return "border-violet-400 dark:border-violet-600 bg-violet-50 dark:bg-violet-950/20";
    case "auto_clock_out":
    case "geofence_exit":
    case "geofence_enter":
    case "location_check": return "border-orange-400 dark:border-orange-600 bg-orange-50 dark:bg-orange-950/20";
    default: return "border-border bg-muted/30";
  }
}

function EditDetail({ detail }: { detail: Record<string, unknown> }) {
  const { fieldChanged, oldValue, newValue, reason } = detail as {
    fieldChanged?: string;
    oldValue?: string | null;
    newValue?: string | null;
    reason?: string | null;
  };

  const field = fieldChanged || "";
  const displayField = field.replace(/([A-Z])/g, " $1").toLowerCase();

  return (
    <div className="mt-2 space-y-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground font-medium uppercase tracking-wide text-[10px]">Field</span>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{displayField}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 px-2 py-1">
          <p className="text-[10px] font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide mb-0.5">Before</p>
          <p className="text-red-800 dark:text-red-300 font-mono">{formatFieldValue(field, oldValue)}</p>
        </div>
        <div className="rounded border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20 px-2 py-1">
          <p className="text-[10px] font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide mb-0.5">After</p>
          <p className="text-green-800 dark:text-green-300 font-mono">{formatFieldValue(field, newValue)}</p>
        </div>
      </div>
      {reason && (
        <div className="rounded border border-muted bg-muted/30 px-2 py-1">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Reason</p>
          <p className="text-foreground">{reason}</p>
        </div>
      )}
    </div>
  );
}

function GenericDetail({ detail }: { detail: Record<string, unknown> }) {
  const entries = Object.entries(detail).filter(([, v]) => v !== null && v !== undefined);
  if (entries.length === 0) return null;
  return (
    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <span className="font-medium capitalize">{k.replace(/([A-Z])/g, " $1").toLowerCase()}:</span>
          <span>{String(v)}</span>
        </div>
      ))}
    </div>
  );
}

function AuditEventCard({ event }: { event: AuditEvent }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = event.detail && Object.keys(event.detail).length > 0;
  const isEdit = event.eventType === "edit";

  return (
    <div className={cn("rounded-lg border px-3 py-2.5 transition-colors", eventTypeColor(event.eventType))}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <div className="mt-0.5">
            <EventIcon eventType={event.eventType} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium leading-snug">{event.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {event.actorName} &bull; {formatTs(event.timestamp)}
            </p>
          </div>
        </div>
        {hasDetail && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        )}
      </div>

      {expanded && hasDetail && event.detail && (
        isEdit
          ? <EditDetail detail={event.detail as Record<string, unknown>} />
          : <GenericDetail detail={event.detail as Record<string, unknown>} />
      )}
    </div>
  );
}

interface TimeEntryAuditPanelProps {
  entryId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function useIsMobile(breakpoint = 640): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return isMobile;
}

export default function TimeEntryAuditPanel({ entryId, open, onOpenChange }: TimeEntryAuditPanelProps) {
  const isMobile = useIsMobile();
  const { data, isLoading, isError } = useQuery<AuditTrailData>({
    queryKey: ["/api/time-entries", entryId, "audit-trail"],
    queryFn: async () => {
      const res = await fetch(`/api/time-entries/${entryId}/audit-trail`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load audit trail");
      return res.json();
    },
    enabled: !!entryId && open,
    staleTime: 30000,
  });

  const employeeName = data?.employee
    ? [data.employee.firstName, data.employee.lastName].filter(Boolean).join(" ") || data.employee.email || "Employee"
    : "Employee";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "overflow-y-auto p-0",
          isMobile ? "max-h-[85dvh] rounded-t-2xl" : "w-full sm:max-w-md"
        )}
      >
        <div className="sticky top-0 z-10 bg-background border-b px-6 py-4">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-muted-foreground" />
              Entry History
            </SheetTitle>
            <SheetDescription className="text-xs">
              {data ? (
                <>
                  {employeeName} &bull;{" "}
                  {data.clockInTime ? format(new Date(data.clockInTime), "MMM d, yyyy") : "—"}
                </>
              ) : (
                "Loading audit trail…"
              )}
            </SheetDescription>
          </SheetHeader>
        </div>

        <div className="px-6 py-4">
          {isLoading && (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <AlertTriangle className="h-8 w-8 text-amber-500" />
              <p className="text-sm font-medium">Could not load audit trail</p>
              <p className="text-xs text-muted-foreground">Check your permissions or try again.</p>
            </div>
          )}

          {data && !isLoading && (
            <div className="space-y-3">
              {/* Summary row */}
              <div className="rounded-lg border bg-muted/30 px-3 py-2 flex gap-4 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {data.events.length} event{data.events.length !== 1 ? "s" : ""}
                </span>
                {!data.hasBreakEventRecords && (
                  <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <Coffee className="h-3.5 w-3.5" />
                    No individual break records
                  </span>
                )}
                <span className="ml-auto italic">Read-only view</span>
              </div>

              {/* Timeline */}
              {data.events.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  No recorded events for this entry.
                </div>
              ) : (
                <div className="relative space-y-2">
                  {/* Vertical connector line */}
                  <div className="absolute left-[18px] top-5 bottom-5 w-px bg-border z-0" />
                  <div className="relative z-10 space-y-2">
                    {data.events.map((event) => (
                      <AuditEventCard key={event.id} event={event} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
