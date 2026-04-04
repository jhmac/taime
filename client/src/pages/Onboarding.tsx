import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Bot, Building2, MapPin, Users, Store, ChevronRight, ChevronLeft, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: "company", title: "Your Company", icon: Building2, description: "Tell us about your business" },
  { id: "location", title: "Store Location", icon: MapPin, description: "Where is your boutique?" },
  { id: "team", title: "Your Team", icon: Users, description: "Help us set up for your team size" },
];

const step1Schema = z.object({
  companyName: z.string().min(1, "Company name is required").max(200),
});

const step2Schema = z.object({
  address1: z.string().min(1, "Street address is required").max(200),
  city: z.string().min(1, "City is required").max(100),
  stateProvince: z.string().min(1, "State / Province is required").max(100),
  zipCode: z.string().max(20).optional(),
  country: z.string().max(100).optional(),
});

const step3Schema = z.object({
  numberOfEmployees: z.coerce.number().int().min(1, "Please select team size"),
  shopifyUrl: z.string().url("Please enter a valid URL").optional().or(z.literal("")),
});

const fullSchema = step1Schema.merge(step2Schema).merge(step3Schema);
type FormValues = z.infer<typeof fullSchema>;

const TEAM_SIZE_OPTIONS = [
  { value: "1", label: "Just me" },
  { value: "2", label: "2–5 employees" },
  { value: "6", label: "6–10 employees" },
  { value: "11", label: "11–25 employees" },
  { value: "26", label: "26–50 employees" },
  { value: "51", label: "51+ employees" },
];

export default function Onboarding() {
  const [currentStep, setCurrentStep] = useState(0);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<FormValues>({
    resolver: zodResolver(fullSchema),
    defaultValues: {
      companyName: "",
      address1: "",
      city: "",
      stateProvince: "",
      zipCode: "",
      country: "United States",
      numberOfEmployees: 1,
      shopifyUrl: "",
    },
    mode: "onTouched",
  });

  const createCompanyMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      const res = await apiRequest("POST", "/api/companies", {
        companyName: data.companyName,
        address1: data.address1,
        city: data.city,
        stateProvince: data.stateProvince,
        zipCode: data.zipCode || undefined,
        country: data.country || "United States",
        numberOfEmployees: data.numberOfEmployees,
        shopifyUrl: data.shopifyUrl || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
      navigate("/admin");
    },
    onError: (error: any) => {
      toast({
        title: "Setup failed",
        description: error.message || "Could not create your company. Please try again.",
        variant: "destructive",
      });
    },
  });

  async function handleNext() {
    let fieldsToValidate: (keyof FormValues)[] = [];
    if (currentStep === 0) fieldsToValidate = ["companyName"];
    if (currentStep === 1) fieldsToValidate = ["address1", "city", "stateProvince", "zipCode", "country"];
    if (currentStep === 2) fieldsToValidate = ["numberOfEmployees", "shopifyUrl"];

    const isValid = await form.trigger(fieldsToValidate);
    if (!isValid) return;

    if (currentStep < STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      form.handleSubmit((data) => createCompanyMutation.mutate(data))();
    }
  }

  function handleBack() {
    if (currentStep > 0) setCurrentStep(prev => prev - 1);
  }

  const isLastStep = currentStep === STEPS.length - 1;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-100 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl rounded-2xl shadow-xl overflow-hidden flex flex-col md:flex-row bg-white">

        <div className="md:w-2/5 bg-gradient-to-br from-primary to-blue-700 p-8 md:p-12 flex flex-col justify-between text-white">
          <div>
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 bg-white/15 backdrop-blur-sm rounded-xl flex items-center justify-center">
                <Bot className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">Taime</h1>
            </div>

            <h2 className="text-xl font-semibold mb-2">Let's get you set up</h2>
            <p className="text-blue-100 text-sm mb-10 leading-relaxed">
              A few quick steps and your boutique will be ready for your team.
            </p>

            <div className="space-y-4">
              {STEPS.map((step, index) => {
                const Icon = step.icon;
                const isCompleted = index < currentStep;
                const isActive = index === currentStep;
                return (
                  <div
                    key={step.id}
                    className={cn(
                      "flex items-center gap-4 p-3 rounded-xl transition-all",
                      isActive && "bg-white/15",
                      !isActive && !isCompleted && "opacity-50"
                    )}
                  >
                    <div
                      className={cn(
                        "w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm font-semibold border-2 transition-all",
                        isCompleted && "bg-white text-primary border-white",
                        isActive && "bg-white/20 text-white border-white",
                        !isActive && !isCompleted && "bg-transparent text-blue-200 border-blue-300/50"
                      )}
                    >
                      {isCompleted ? <Check className="w-4 h-4" /> : index + 1}
                    </div>
                    <div>
                      <p className={cn("text-sm font-semibold", isActive ? "text-white" : "text-blue-100")}>{step.title}</p>
                      <p className="text-blue-200 text-xs">{step.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <p className="text-blue-200 text-xs mt-8">
            You can update all of this later in Admin Settings.
          </p>
        </div>

        <div className="md:w-3/5 flex flex-col p-8 md:p-12">
          <div className="flex-1">
            <div className="mb-8">
              <h3 className="text-xl font-semibold text-foreground">{STEPS[currentStep].title}</h3>
              <p className="text-muted-foreground text-sm mt-1">{STEPS[currentStep].description}</p>
            </div>

            <Form {...form}>
              <form onSubmit={e => e.preventDefault()} className="space-y-5">
                {currentStep === 0 && (
                  <FormField
                    control={form.control}
                    name="companyName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company / Boutique Name</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. Bloom Boutique"
                            autoFocus
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {currentStep === 1 && (
                  <>
                    <FormField
                      control={form.control}
                      name="address1"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Street Address</FormLabel>
                          <FormControl>
                            <Input placeholder="123 Main St" autoFocus {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="city"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>City</FormLabel>
                            <FormControl>
                              <Input placeholder="Nashville" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="stateProvince"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>State / Province</FormLabel>
                            <FormControl>
                              <Input placeholder="TN" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="zipCode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>ZIP / Postal Code</FormLabel>
                            <FormControl>
                              <Input placeholder="37201" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="country"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Country</FormLabel>
                            <FormControl>
                              <Input placeholder="United States" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </>
                )}

                {currentStep === 2 && (
                  <>
                    <FormField
                      control={form.control}
                      name="numberOfEmployees"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Team Size</FormLabel>
                          <Select
                            onValueChange={(val) => field.onChange(parseInt(val))}
                            defaultValue={field.value?.toString()}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="How many people on your team?" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {TEAM_SIZE_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="shopifyUrl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">
                            <Store className="w-4 h-4" />
                            Shopify Store URL
                            <span className="text-muted-foreground font-normal text-xs">(optional)</span>
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder="https://your-store.myshopify.com"
                              type="url"
                              {...field}
                            />
                          </FormControl>
                          <p className="text-xs text-muted-foreground">
                            You can connect your Shopify store now or later in Admin Settings.
                          </p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}
              </form>
            </Form>
          </div>

          <div className="flex items-center justify-between mt-10 pt-6 border-t">
            <Button
              variant="ghost"
              onClick={handleBack}
              disabled={currentStep === 0}
              className="gap-2"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </Button>

            <div className="flex items-center gap-2">
              {STEPS.map((_, index) => (
                <div
                  key={index}
                  className={cn(
                    "h-2 rounded-full transition-all",
                    index === currentStep ? "w-6 bg-primary" : "w-2 bg-muted"
                  )}
                />
              ))}
            </div>

            <Button
              onClick={handleNext}
              disabled={createCompanyMutation.isPending}
              className="gap-2"
            >
              {createCompanyMutation.isPending ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              ) : isLastStep ? (
                <>
                  Launch Dashboard
                  <Check className="w-4 h-4" />
                </>
              ) : (
                <>
                  Continue
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
