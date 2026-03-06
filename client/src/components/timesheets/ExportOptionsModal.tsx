import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Download, Mail } from "lucide-react";

const ALL_EXPORT_FIELDS = [
  { key: "employeeName", label: "Employee Name", group: "employee" },
  { key: "employeeEmail", label: "Employee Email", group: "employee" },
  { key: "date", label: "Date", group: "time" },
  { key: "clockIn", label: "Clock-In", group: "time" },
  { key: "clockOut", label: "Clock-Out", group: "time" },
  { key: "regularHours", label: "Regular Hours", group: "hours" },
  { key: "otHours", label: "OT Hours", group: "hours" },
  { key: "holidayHours", label: "Holiday Hours", group: "hours" },
  { key: "breakMinutes", label: "Break Minutes", group: "hours" },
  { key: "offsiteMinutes", label: "Off-Site Minutes", group: "hours" },
  { key: "hourlyRate", label: "Hourly Rate", group: "pay" },
  { key: "regularPay", label: "Regular Pay", group: "pay" },
  { key: "otPay", label: "OT Pay", group: "pay" },
  { key: "holidayPay", label: "Holiday Pay", group: "pay" },
  { key: "totalPay", label: "Total Pay", group: "pay" },
  { key: "location", label: "Location", group: "other" },
  { key: "notes", label: "Notes", group: "other" },
] as const;

const PRESET_CONFIGS: Record<string, { label: string; description: string; fields: string[] }> = {
  custom: { label: "Custom", description: "Select individual fields", fields: [] },
  all: { label: "All Fields", description: "Export all available columns", fields: ALL_EXPORT_FIELDS.map((f) => f.key) },
  quickbooks: { label: "QuickBooks", description: "Name, date, hours, rates, and pay", fields: ["employeeName", "date", "regularHours", "otHours", "hourlyRate", "regularPay", "otPay", "totalPay"] },
  gusto: { label: "Gusto", description: "Name, email, date, hours, breaks, total pay", fields: ["employeeName", "employeeEmail", "date", "regularHours", "otHours", "holidayHours", "breakMinutes", "totalPay"] },
  adp: { label: "ADP", description: "Full detail with clock times and pay breakdown", fields: ["employeeName", "employeeEmail", "date", "clockIn", "clockOut", "regularHours", "otHours", "breakMinutes", "hourlyRate", "regularPay", "otPay", "totalPay"] },
};

const FIELD_GROUPS = [
  { key: "employee", label: "Employee Info" },
  { key: "time", label: "Time Details" },
  { key: "hours", label: "Hours" },
  { key: "pay", label: "Pay" },
  { key: "other", label: "Other" },
];

export default function ExportOptionsModal({
  open,
  onOpenChange,
  startDate,
  endDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startDate: string;
  endDate: string;
}) {
  const { toast } = useToast();
  const [selectedFields, setSelectedFields] = useState<Set<string>>(
    new Set(ALL_EXPORT_FIELDS.map((f) => f.key))
  );
  const [hourFormat, setHourFormat] = useState<"decimal" | "clock">("decimal");
  const [preset, setPreset] = useState("all");
  const [exportStartDate, setExportStartDate] = useState(startDate);
  const [exportEndDate, setExportEndDate] = useState(endDate);

  const handlePresetChange = (value: string) => {
    setPreset(value);
    if (value !== "custom") {
      const config = PRESET_CONFIGS[value];
      if (config) {
        setSelectedFields(new Set(config.fields));
      }
    }
  };

  const toggleField = (key: string) => {
    setPreset("custom");
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAllFields = () => {
    setSelectedFields(new Set(ALL_EXPORT_FIELDS.map((f) => f.key)));
    setPreset("all");
  };

  const clearAllFields = () => {
    setSelectedFields(new Set());
    setPreset("custom");
  };

  const handleDownload = async () => {
    if (selectedFields.size === 0) {
      toast({ title: "No fields selected", description: "Please select at least one field to export.", variant: "destructive" });
      return;
    }

    const params = new URLSearchParams();
    params.set("startDate", exportStartDate);
    params.set("endDate", exportEndDate);
    params.set("hourFormat", hourFormat);

    if (preset !== "custom" && preset !== "all" && PRESET_CONFIGS[preset]) {
      params.set("preset", preset);
    } else {
      params.set("fields", Array.from(selectedFields).join(","));
    }

    try {
      const url = `/api/timesheets/export?${params.toString()}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Export failed");
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `timesheets-${exportStartDate}-to-${exportEndDate}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);

      toast({ title: "Export complete", description: "Your CSV file has been downloaded." });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    }
  };

  const handleEmailAccountant = () => {
    toast({ title: "Coming soon", description: "Email export will be available shortly." });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Export Timesheets
          </DialogTitle>
          <DialogDescription>
            Customize which fields to include in your CSV export.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Date Range</Label>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={exportStartDate}
                onChange={(e) => setExportStartDate(e.target.value)}
                className="flex-1 text-sm"
              />
              <span className="text-muted-foreground text-sm">to</span>
              <Input
                type="date"
                value={exportEndDate}
                onChange={(e) => setExportEndDate(e.target.value)}
                className="flex-1 text-sm"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Format Preset</Label>
            <Select value={preset} onValueChange={handlePresetChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PRESET_CONFIGS).map(([key, config]) => (
                  <SelectItem key={key} value={key}>
                    <div className="flex flex-col">
                      <span>{config.label}</span>
                      <span className="text-xs text-muted-foreground">{config.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Hour Format</Label>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${hourFormat === "decimal" ? "font-semibold" : "text-muted-foreground"}`}>
                  Decimal (8.50)
                </span>
                <Switch
                  checked={hourFormat === "clock"}
                  onCheckedChange={(checked) => setHourFormat(checked ? "clock" : "decimal")}
                />
                <span className={`text-xs ${hourFormat === "clock" ? "font-semibold" : "text-muted-foreground"}`}>
                  Clock (8:30)
                </span>
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Fields to Export</Label>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={selectAllFields}>
                  Select All
                </Button>
                <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={clearAllFields}>
                  Clear
                </Button>
              </div>
            </div>

            {FIELD_GROUPS.map((group) => {
              const fields = ALL_EXPORT_FIELDS.filter((f) => f.group === group.key);
              return (
                <div key={group.key} className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {group.label}
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {fields.map((field) => (
                      <label
                        key={field.key}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                      >
                        <Checkbox
                          checked={selectedFields.has(field.key)}
                          onCheckedChange={() => toggleField(field.key)}
                        />
                        <span className="text-sm">{field.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="text-xs text-muted-foreground">
            {selectedFields.size} of {ALL_EXPORT_FIELDS.length} fields selected
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 mt-2">
          <Button variant="outline" size="sm" onClick={handleEmailAccountant} className="flex-1 sm:flex-none">
            <Mail className="h-4 w-4 mr-1" />
            Email to Accountant
          </Button>
          <Button onClick={handleDownload} size="sm" className="flex-1 sm:flex-none" disabled={selectedFields.size === 0}>
            <Download className="h-4 w-4 mr-1" />
            Download CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
