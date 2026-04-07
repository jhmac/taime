import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  Store, MapPin, Phone, Mail, Globe, Clock, ArrowRight,
  CheckCircle, Sparkles, Loader2,
} from "lucide-react";

const DAYS = [
  { key: "monday", label: "Mon", full: "Monday" },
  { key: "tuesday", label: "Tue", full: "Tuesday" },
  { key: "wednesday", label: "Wed", full: "Wednesday" },
  { key: "thursday", label: "Thu", full: "Thursday" },
  { key: "friday", label: "Fri", full: "Friday" },
  { key: "saturday", label: "Sat", full: "Saturday" },
  { key: "sunday", label: "Sun", full: "Sunday" },
];

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Anchorage", label: "Alaska (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii (HT)" },
];

const DEFAULT_HOURS = Object.fromEntries(
  DAYS.map(({ key }) => [
    key,
    {
      isOpen: key !== "sunday",
      open: key === "saturday" ? "10:00" : "09:00",
      close: key === "saturday" ? "17:00" : "18:00",
    },
  ])
);

type DayHours = { isOpen: boolean; open: string; close: string };
type HoursMap = Record<string, DayHours>;

function HoursEditor({ value, onChange }: { value: HoursMap; onChange: (h: HoursMap) => void }) {
  const update = (day: string, field: keyof DayHours, val: string | boolean) => {
    onChange({ ...value, [day]: { ...value[day], [field]: val } });
  };
  return (
    <div className="space-y-2.5">
      {DAYS.map(({ key, full }) => {
        const day = value[key] || { isOpen: false, open: "09:00", close: "18:00" };
        return (
          <div key={key} className="flex items-center gap-3">
            <Switch
              checked={day.isOpen}
              onCheckedChange={v => update(key, "isOpen", v)}
            />
            <span className={cn("w-24 text-sm font-medium", day.isOpen ? "text-foreground" : "text-muted-foreground")}>
              {full}
            </span>
            {day.isOpen ? (
              <div className="flex items-center gap-2 flex-1">
                <Input
                  type="time"
                  value={day.open}
                  onChange={e => update(key, "open", e.target.value)}
                  className="h-8 text-sm w-28"
                />
                <span className="text-muted-foreground text-sm">–</span>
                <Input
                  type="time"
                  value={day.close}
                  onChange={e => update(key, "close", e.target.value)}
                  className="h-8 text-sm w-28"
                />
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

type StepId = "welcome" | "details" | "hours" | "done";

interface FormData {
  name: string;
  address: string;
  phone: string;
  email: string;
  timezone: string;
  hoursOfOperation: HoursMap;
}

interface StoreSetupWizardProps {
  onComplete: () => void;
}

export default function StoreSetupWizard({ onComplete }: StoreSetupWizardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<StepId>("welcome");
  const [form, setForm] = useState<FormData>({
    name: "",
    address: "",
    phone: "",
    email: "",
    timezone: "America/Chicago",
    hoursOfOperation: { ...DEFAULT_HOURS },
  });

  const createMutation = useMutation({
    mutationFn: (data: FormData) => apiRequest("POST", "/api/onboarding/store", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
      setStep("done");
    },
    onError: (err: any) => {
      toast({ title: "Setup failed", description: err.message || "Could not create store. Please try again.", variant: "destructive" });
    },
  });

  const update = (field: keyof FormData, value: any) =>
    setForm(f => ({ ...f, [field]: value }));

  const stepIndex: Record<StepId, number> = { welcome: 0, details: 1, hours: 2, done: 3 };
  const progress = Math.round((stepIndex[step] / 3) * 100);

  return (
    <div className="fixed inset-0 z-50 bg-[#FFFBF5] flex flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto px-6 py-10 min-h-full flex flex-col">

          {/* Logo */}
          <div className="flex items-center gap-2 mb-8">
            <div className="w-9 h-9 rounded-xl bg-[#F47D31] flex items-center justify-center shadow-sm">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-extrabold text-[#1A1A2E] tracking-tight">Taime</span>
          </div>

          {/* Progress bar (hidden on welcome/done) */}
          {step !== "welcome" && step !== "done" && (
            <div className="mb-8">
              <div className="flex justify-between text-xs text-muted-foreground mb-2">
                <span>Store setup</span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 bg-orange-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#F47D31] rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex-1">
            {/* ---- WELCOME ---- */}
            {step === "welcome" && (
              <div className="flex flex-col items-center text-center py-8 gap-6">
                <div className="w-20 h-20 rounded-2xl bg-orange-100 flex items-center justify-center">
                  <Store className="w-10 h-10 text-[#F47D31]" />
                </div>
                <div className="space-y-2">
                  <h1 className="text-2xl font-extrabold text-[#1A1A2E]">
                    Welcome to Taime!
                  </h1>
                  <p className="text-muted-foreground text-sm max-w-xs">
                    Let's get your boutique set up. It only takes a minute to configure your store details.
                  </p>
                </div>
                <div className="w-full space-y-2.5 mt-2">
                  {[
                    { icon: Store, text: "Set up your store location" },
                    { icon: Clock, text: "Configure hours of operation" },
                    { icon: Sparkles, text: "Start managing your team with AI" },
                  ].map(({ icon: Icon, text }) => (
                    <div key={text} className="flex items-center gap-3 bg-white rounded-xl px-4 py-3 shadow-sm border border-orange-100">
                      <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0">
                        <Icon className="w-4 h-4 text-[#F47D31]" />
                      </div>
                      <span className="text-sm font-medium text-[#1A1A2E]">{text}</span>
                    </div>
                  ))}
                </div>
                <Button
                  className="w-full h-12 text-base font-semibold bg-[#F47D31] hover:bg-[#e06b1f] text-white shadow-lg shadow-orange-200 gap-2"
                  onClick={() => setStep("details")}
                >
                  Get started <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            )}

            {/* ---- DETAILS ---- */}
            {step === "details" && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-[#1A1A2E]">Store details</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Tell us about your boutique location.
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <Label className="flex items-center gap-1.5 mb-1.5 text-sm font-medium">
                      <Store className="w-3.5 h-3.5 text-[#F47D31]" />
                      Store name <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      value={form.name}
                      onChange={e => update("name", e.target.value)}
                      placeholder="e.g. Libby Story Ridgeland"
                      className="h-11"
                      autoFocus
                    />
                  </div>

                  <div>
                    <Label className="flex items-center gap-1.5 mb-1.5 text-sm font-medium">
                      <MapPin className="w-3.5 h-3.5 text-[#F47D31]" />
                      Address
                    </Label>
                    <Input
                      value={form.address}
                      onChange={e => update("address", e.target.value)}
                      placeholder="770 S Pear Orchard Rd, Ridgeland, MS 39157"
                      className="h-11"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="flex items-center gap-1.5 mb-1.5 text-sm font-medium">
                        <Phone className="w-3.5 h-3.5 text-[#F47D31]" />
                        Phone
                      </Label>
                      <Input
                        value={form.phone}
                        onChange={e => update("phone", e.target.value)}
                        placeholder="(601) 856-0080"
                        className="h-11"
                      />
                    </div>
                    <div>
                      <Label className="flex items-center gap-1.5 mb-1.5 text-sm font-medium">
                        <Mail className="w-3.5 h-3.5 text-[#F47D31]" />
                        Email
                      </Label>
                      <Input
                        type="email"
                        value={form.email}
                        onChange={e => update("email", e.target.value)}
                        placeholder="hello@yourboutique.com"
                        className="h-11"
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="flex items-center gap-1.5 mb-1.5 text-sm font-medium">
                      <Globe className="w-3.5 h-3.5 text-[#F47D31]" />
                      Timezone
                    </Label>
                    <select
                      value={form.timezone}
                      onChange={e => update("timezone", e.target.value)}
                      className="flex h-11 w-full rounded-md border border-input bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {TIMEZONES.map(tz => (
                        <option key={tz.value} value={tz.value}>{tz.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button
                    variant="outline"
                    className="flex-1 h-11"
                    onClick={() => setStep("welcome")}
                  >
                    Back
                  </Button>
                  <Button
                    className="flex-1 h-11 bg-[#F47D31] hover:bg-[#e06b1f] text-white gap-2"
                    onClick={() => setStep("hours")}
                    disabled={!form.name.trim()}
                  >
                    Continue <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* ---- HOURS ---- */}
            {step === "hours" && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-[#1A1A2E]">Hours of operation</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Set your store's regular schedule. You can always change this later.
                  </p>
                </div>

                <div className="bg-white rounded-xl border border-border p-4 shadow-sm">
                  <HoursEditor
                    value={form.hoursOfOperation}
                    onChange={h => update("hoursOfOperation", h)}
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <Button
                    variant="outline"
                    className="flex-1 h-11"
                    onClick={() => setStep("details")}
                  >
                    Back
                  </Button>
                  <Button
                    className="flex-1 h-11 bg-[#F47D31] hover:bg-[#e06b1f] text-white gap-2"
                    onClick={() => createMutation.mutate(form)}
                    disabled={createMutation.isPending}
                  >
                    {createMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Setting up…
                      </>
                    ) : (
                      <>
                        Finish setup <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* ---- DONE ---- */}
            {step === "done" && (
              <div className="flex flex-col items-center text-center py-8 gap-6">
                <div className="w-20 h-20 rounded-2xl bg-green-100 flex items-center justify-center">
                  <CheckCircle className="w-10 h-10 text-green-500" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-extrabold text-[#1A1A2E]">
                    You're all set!
                  </h2>
                  <p className="text-muted-foreground text-sm max-w-xs">
                    <strong>{form.name}</strong> is ready. Start scheduling, tracking time, and managing your team with AI.
                  </p>
                </div>
                <Button
                  className="w-full h-12 text-base font-semibold bg-[#F47D31] hover:bg-[#e06b1f] text-white shadow-lg shadow-orange-200"
                  onClick={onComplete}
                >
                  Go to dashboard
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
