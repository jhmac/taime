import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { cn } from "@/lib/utils";
import {
  Store, MapPin, Phone, Mail, Globe, Clock, ArrowRight,
  CheckCircle, Sparkles, Loader2, Building2,
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

const STORE_TYPES = [
  { value: "boutique", label: "Boutique / Apparel" },
  { value: "gift", label: "Gift Shop" },
  { value: "beauty", label: "Beauty / Salon" },
  { value: "jewelry", label: "Jewelry" },
  { value: "home_decor", label: "Home Décor" },
  { value: "other", label: "Other" },
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

// Zod schema for the wizard form
const storeFormSchema = z.object({
  name: z.string().min(1, "Store name is required").max(100, "Max 100 characters"),
  storeType: z.string().optional(),
  address: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  email: z
    .string()
    .optional()
    .refine(v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { message: "Invalid email" })
    .default(""),
  timezone: z.string().default("America/Chicago"),
  hoursOfOperation: z.record(
    z.object({
      isOpen: z.boolean(),
      open: z.string(),
      close: z.string(),
    })
  ).default(DEFAULT_HOURS),
});

type StoreFormValues = z.infer<typeof storeFormSchema>;

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

type StepId = "welcome" | "details" | "hours" | "review" | "done";

const STEPS: StepId[] = ["details", "hours", "review"];

interface StoreSetupWizardProps {
  onComplete: () => void;
}

export default function StoreSetupWizard({ onComplete }: StoreSetupWizardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<StepId>("welcome");

  const form = useForm<StoreFormValues>({
    resolver: zodResolver(storeFormSchema),
    defaultValues: {
      name: "",
      storeType: "boutique",
      address: "",
      phone: "",
      email: "",
      timezone: "America/Chicago",
      hoursOfOperation: { ...DEFAULT_HOURS },
    },
    mode: "onTouched",
  });

  const createMutation = useMutation({
    mutationFn: (data: StoreFormValues) => apiRequest("POST", "/api/onboarding/store", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
      setStep("done");
    },
    onError: (err: any) => {
      toast({
        title: "Setup failed",
        description: err.message || "Could not create store. Please try again.",
        variant: "destructive",
      });
    },
  });

  const stepIndex = STEPS.indexOf(step as any);
  const progress = step === "welcome" || step === "done"
    ? 0
    : Math.round(((stepIndex + 1) / STEPS.length) * 100);

  const goToDetails = () => setStep("details");
  const goToHours = async () => {
    const valid = await form.trigger(["name", "storeType", "address", "phone", "email", "timezone"]);
    if (valid) setStep("hours");
  };
  const goToReview = () => setStep("review");
  const submitForm = form.handleSubmit(data => createMutation.mutate(data));

  const values = form.watch();

  return (
    <div className="fixed inset-0 z-50 bg-[#FFFBF5] flex flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto px-6 py-10 min-h-full flex flex-col">

          {/* Logo */}
          <div className="flex items-center gap-2 mb-8">
            <img src="/TAIME-logo.png" alt="Taime" className="h-9 w-auto" />
          </div>

          {/* Progress bar (visible during data-entry steps) */}
          {step !== "welcome" && step !== "done" && (
            <div className="mb-8">
              <div className="flex justify-between text-xs text-muted-foreground mb-2">
                <span className="font-medium">Store setup</span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 bg-orange-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#F47D31] rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex gap-2 mt-3">
                {STEPS.map((s, i) => (
                  <span
                    key={s}
                    className={cn(
                      "text-xs font-medium capitalize",
                      i === stepIndex ? "text-[#F47D31]" : i < stepIndex ? "text-green-500" : "text-muted-foreground"
                    )}
                  >
                    {i < stepIndex ? "✓ " : ""}{s}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex-1">
            <Form {...form}>
              <form onSubmit={submitForm}>

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
                        { icon: Store, text: "Enter your store details" },
                        { icon: Clock, text: "Set hours of operation" },
                        { icon: Sparkles, text: "Review & go live with AI management" },
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
                      type="button"
                      className="w-full h-12 text-base font-semibold bg-[#F47D31] hover:bg-[#e06b1f] text-white shadow-lg shadow-orange-200 gap-2"
                      onClick={goToDetails}
                    >
                      Get started <ArrowRight className="w-4 h-4" />
                    </Button>
                  </div>
                )}

                {/* ---- DETAILS ---- */}
                {step === "details" && (
                  <div className="space-y-5">
                    <div>
                      <h2 className="text-xl font-bold text-[#1A1A2E]">Store details</h2>
                      <p className="text-sm text-muted-foreground mt-1">
                        Tell us about your boutique location.
                      </p>
                    </div>

                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-1.5">
                            <Store className="w-3.5 h-3.5 text-[#F47D31]" />
                            Store name <span className="text-red-500">*</span>
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="e.g. Libby Story Ridgeland"
                              className="h-11"
                              autoFocus
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="storeType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-1.5">
                            <Building2 className="w-3.5 h-3.5 text-[#F47D31]" />
                            Store type
                          </FormLabel>
                          <FormControl>
                            <div className="flex flex-wrap gap-2 mt-1">
                              {STORE_TYPES.map(t => (
                                <button
                                  key={t.value}
                                  type="button"
                                  onClick={() => field.onChange(t.value)}
                                  className={cn(
                                    "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
                                    field.value === t.value
                                      ? "bg-[#F47D31] text-white border-[#F47D31]"
                                      : "bg-white text-muted-foreground border-border hover:border-[#F47D31] hover:text-[#F47D31]"
                                  )}
                                >
                                  {t.label}
                                </button>
                              ))}
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 text-[#F47D31]" />
                            Address
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="770 S Pear Orchard Rd, Ridgeland, MS 39157"
                              className="h-11"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-1.5">
                              <Phone className="w-3.5 h-3.5 text-[#F47D31]" />
                              Phone
                            </FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="(601) 856-0080" className="h-11" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-1.5">
                              <Mail className="w-3.5 h-3.5 text-[#F47D31]" />
                              Email
                            </FormLabel>
                            <FormControl>
                              <Input {...field} type="email" placeholder="hello@boutique.com" className="h-11" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="timezone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-1.5">
                            <Globe className="w-3.5 h-3.5 text-[#F47D31]" />
                            Timezone
                          </FormLabel>
                          <FormControl>
                            <select
                              value={field.value}
                              onChange={e => field.onChange(e.target.value)}
                              className="flex h-11 w-full rounded-md border border-input bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                              {TIMEZONES.map(tz => (
                                <option key={tz.value} value={tz.value}>{tz.label}</option>
                              ))}
                            </select>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="flex gap-3 pt-2">
                      <Button type="button" variant="outline" className="flex-1 h-11" onClick={() => setStep("welcome")}>
                        Back
                      </Button>
                      <Button
                        type="button"
                        className="flex-1 h-11 bg-[#F47D31] hover:bg-[#e06b1f] text-white gap-2"
                        onClick={goToHours}
                      >
                        Continue <ArrowRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* ---- HOURS ---- */}
                {step === "hours" && (
                  <div className="space-y-5">
                    <div>
                      <h2 className="text-xl font-bold text-[#1A1A2E]">Hours of operation</h2>
                      <p className="text-sm text-muted-foreground mt-1">
                        Set your store's regular schedule. You can change this any time.
                      </p>
                    </div>

                    <FormField
                      control={form.control}
                      name="hoursOfOperation"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <div className="bg-white rounded-xl border border-border p-4 shadow-sm">
                              <HoursEditor
                                value={field.value as HoursMap}
                                onChange={field.onChange}
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="flex gap-3 pt-2">
                      <Button type="button" variant="outline" className="flex-1 h-11" onClick={() => setStep("details")}>
                        Back
                      </Button>
                      <Button
                        type="button"
                        className="flex-1 h-11 bg-[#F47D31] hover:bg-[#e06b1f] text-white gap-2"
                        onClick={goToReview}
                      >
                        Review <ArrowRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* ---- REVIEW ---- */}
                {step === "review" && (
                  <div className="space-y-5">
                    <div>
                      <h2 className="text-xl font-bold text-[#1A1A2E]">Review & confirm</h2>
                      <p className="text-sm text-muted-foreground mt-1">
                        Everything look right? You can always edit these in Settings.
                      </p>
                    </div>

                    <div className="bg-white rounded-xl border border-border divide-y divide-border shadow-sm overflow-hidden">
                      <div className="px-4 py-3 flex items-start gap-3">
                        <Store className="w-4 h-4 text-[#F47D31] mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground font-medium">Store name</p>
                          <p className="text-sm font-semibold text-[#1A1A2E]">{values.name}</p>
                        </div>
                        {values.storeType && (
                          <Badge variant="secondary" className="ml-auto text-xs capitalize">
                            {STORE_TYPES.find(t => t.value === values.storeType)?.label || values.storeType}
                          </Badge>
                        )}
                      </div>
                      {values.address && (
                        <div className="px-4 py-3 flex items-start gap-3">
                          <MapPin className="w-4 h-4 text-[#F47D31] mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-xs text-muted-foreground font-medium">Address</p>
                            <p className="text-sm text-[#1A1A2E]">{values.address}</p>
                          </div>
                        </div>
                      )}
                      {values.phone && (
                        <div className="px-4 py-3 flex items-start gap-3">
                          <Phone className="w-4 h-4 text-[#F47D31] mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-xs text-muted-foreground font-medium">Phone</p>
                            <p className="text-sm text-[#1A1A2E]">{values.phone}</p>
                          </div>
                        </div>
                      )}
                      {values.email && (
                        <div className="px-4 py-3 flex items-start gap-3">
                          <Mail className="w-4 h-4 text-[#F47D31] mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-xs text-muted-foreground font-medium">Email</p>
                            <p className="text-sm text-[#1A1A2E]">{values.email}</p>
                          </div>
                        </div>
                      )}
                      <div className="px-4 py-3 flex items-start gap-3">
                        <Globe className="w-4 h-4 text-[#F47D31] mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground font-medium">Timezone</p>
                          <p className="text-sm text-[#1A1A2E]">
                            {TIMEZONES.find(t => t.value === values.timezone)?.label || values.timezone}
                          </p>
                        </div>
                      </div>
                      <div className="px-4 py-3 flex items-start gap-3">
                        <Clock className="w-4 h-4 text-[#F47D31] mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground font-medium mb-1.5">Hours</p>
                          <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
                            {DAYS.map(({ key, label }) => {
                              const d = (values.hoursOfOperation as HoursMap)?.[key];
                              return (
                                <div key={key} className="flex items-center gap-2 text-xs">
                                  <span className="w-7 text-muted-foreground font-medium">{label}</span>
                                  {d?.isOpen ? (
                                    <span className="text-[#1A1A2E]">{d.open} – {d.close}</span>
                                  ) : (
                                    <span className="text-muted-foreground">Closed</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-3 pt-2">
                      <Button type="button" variant="outline" className="flex-1 h-11" onClick={() => setStep("hours")}>
                        Back
                      </Button>
                      <Button
                        type="submit"
                        className="flex-1 h-11 bg-[#F47D31] hover:bg-[#e06b1f] text-white gap-2"
                        disabled={createMutation.isPending}
                      >
                        {createMutation.isPending ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Setting up…
                          </>
                        ) : (
                          <>
                            Confirm & launch <ArrowRight className="w-4 h-4" />
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
                      <h2 className="text-2xl font-extrabold text-[#1A1A2E]">You're all set!</h2>
                      <p className="text-muted-foreground text-sm max-w-xs">
                        <strong>{values.name}</strong> is ready. Start scheduling, tracking time, and managing your team with AI.
                      </p>
                    </div>
                    <Button
                      type="button"
                      className="w-full h-12 text-base font-semibold bg-[#F47D31] hover:bg-[#e06b1f] text-white shadow-lg shadow-orange-200"
                      onClick={onComplete}
                    >
                      Go to dashboard
                    </Button>
                  </div>
                )}

              </form>
            </Form>
          </div>
        </div>
      </div>
    </div>
  );
}
