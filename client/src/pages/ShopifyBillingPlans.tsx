import { useState, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, AlertCircle, Loader2, Zap, Building2, Rocket } from "lucide-react";

interface PlanDetails {
  name: string;
  price: number;
  trialDays: number;
  features: string[];
}

interface BillingPlans {
  free_trial: PlanDetails;
  starter: PlanDetails;
  pro: PlanDetails;
}

interface BillingStatus {
  shopDomain: string;
  planName: string;
  billingStatus: string;
  trialEndsAt: string | null;
  subscriptionId: string | null;
  planDetails: PlanDetails;
  isActive: boolean;
}

const planIcons: Record<string, typeof Zap> = {
  free_trial: Zap,
  starter: Building2,
  pro: Rocket,
};

const planColors: Record<string, string> = {
  free_trial: "border-gray-200 dark:border-gray-700",
  starter: "border-blue-500",
  pro: "border-purple-500",
};

const planBadgeColors: Record<string, string> = {
  free_trial: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
  starter: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  pro: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
};

export default function ShopifyBillingPlans() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const params = new URLSearchParams(search);
  const shopDomain = params.get("shop") || "";
  const successParam = params.get("success");
  const errorParam = params.get("error");
  const messageParam = params.get("message");
  const planParam = params.get("plan");

  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [subscribing, setSubscribing] = useState(false);

  useEffect(() => {
    if (successParam) {
      toast({
        title: "Subscription activated!",
        description: `You are now on the ${planParam || "selected"} plan.`,
      });
    }
    if (errorParam && messageParam) {
      toast({
        title: "Billing error",
        description: decodeURIComponent(messageParam),
        variant: "destructive",
      });
    }
  }, [successParam, errorParam]);

  const { data: plans, isLoading: plansLoading } = useQuery<BillingPlans>({
    queryKey: ["/api/shopify/billing/plans"],
    enabled: true,
  });

  const { data: billingStatus, isLoading: statusLoading, refetch: refetchStatus } = useQuery<BillingStatus>({
    queryKey: ["/api/shopify/billing/status", shopDomain],
    queryFn: async () => {
      const r = await fetch(`/api/shopify/billing/status?shop=${encodeURIComponent(shopDomain)}`);
      if (!r.ok) throw new Error(`Billing status fetch failed: ${r.status}`);
      return r.json();
    },
    enabled: !!shopDomain,
  });

  const subscribeMutation = useMutation({
    mutationFn: async (planName: string) => {
      const res = await apiRequest("POST", "/api/shopify/billing/subscribe", {
        shopDomain,
        planName,
      });
      return res.json();
    },
    onSuccess: (data, planName) => {
      if (planName === "free_trial") {
        toast({ title: "Free trial started!", description: "Your 14-day free trial is now active." });
        refetchStatus();
        setSubscribing(false);
        setSelectedPlan(null);
      } else if (data.confirmationUrl) {
        window.location.href = data.confirmationUrl;
      }
    },
    onError: (err: any) => {
      toast({ title: "Subscription failed", description: err.message || "Please try again.", variant: "destructive" });
      setSubscribing(false);
      setSelectedPlan(null);
    },
  });

  const changePlanMutation = useMutation({
    mutationFn: async (planName: string) => {
      const res = await apiRequest("POST", "/api/shopify/billing/change-plan", {
        shopDomain,
        planName,
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.confirmationUrl) {
        window.location.href = data.confirmationUrl;
      }
    },
    onError: (err: any) => {
      toast({ title: "Plan change failed", description: err.message || "Please try again.", variant: "destructive" });
      setSubscribing(false);
      setSelectedPlan(null);
    },
  });

  const handleSelectPlan = (planKey: string) => {
    if (subscribing) return;
    setSelectedPlan(planKey);
    setSubscribing(true);

    const isCurrentlyActive = billingStatus?.billingStatus === 'active' || billingStatus?.billingStatus === 'trial';
    const isChangingPlan = isCurrentlyActive && billingStatus?.planName !== planKey && planKey !== 'free_trial';

    if (isChangingPlan) {
      changePlanMutation.mutate(planKey);
    } else {
      subscribeMutation.mutate(planKey);
    }
  };

  const formatTrialEnd = (date: string | null) => {
    if (!date) return null;
    return new Date(date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  };

  if (!shopDomain) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="w-5 h-5" />
              Shop not specified
            </CardTitle>
            <CardDescription>
              No shop domain was provided. Please reconnect your Shopify store.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button onClick={() => setLocation("/admin")} className="w-full">
              Back to Dashboard
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (plansLoading || statusLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <p className="text-gray-500 dark:text-gray-400 text-sm">Loading billing information...</p>
        </div>
      </div>
    );
  }

  const currentPlan = billingStatus?.planName || "free_trial";
  const currentStatus = billingStatus?.billingStatus || "trial";
  const isExpired = currentStatus === "expired";
  const isActive = billingStatus?.isActive;

  const planEntries = plans
    ? (Object.entries(plans) as [string, PlanDetails][])
    : [];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">
            MAinager for Shopify
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-lg">
            Choose the plan that fits your boutique
          </p>
          {billingStatus && (
            <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm">
              <span className="text-sm text-gray-500 dark:text-gray-400">Store:</span>
              <span className="text-sm font-medium text-gray-900 dark:text-white">{shopDomain}</span>
              {isExpired ? (
                <Badge variant="destructive" className="text-xs">Trial Expired</Badge>
              ) : isActive ? (
                <Badge className="text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 border-0">
                  {currentStatus === "trial" ? "Trial Active" : "Active"}
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-xs">Inactive</Badge>
              )}
            </div>
          )}
          {currentStatus === "trial" && billingStatus?.trialEndsAt && (
            <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">
              Your free trial ends on {formatTrialEnd(billingStatus.trialEndsAt)}
            </p>
          )}
          {isExpired && (
            <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg max-w-lg mx-auto">
              <p className="text-red-700 dark:text-red-300 text-sm font-medium">
                Your free trial has expired. Please select a plan to continue using MAinager.
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {planEntries.map(([planKey, plan]) => {
            const Icon = planIcons[planKey] || Zap;
            const isCurrent = currentPlan === planKey;
            const isPopular = planKey === "starter";
            const isFree = planKey === "free_trial";
            const alreadyOnTrial = isFree && (currentStatus === "trial" || currentStatus === "active");

            return (
              <Card
                key={planKey}
                className={`relative flex flex-col border-2 transition-all ${planColors[planKey]} ${
                  isCurrent ? "shadow-lg" : "hover:shadow-md"
                } bg-white dark:bg-gray-800`}
              >
                {isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="bg-blue-500 text-white text-xs font-semibold px-3 py-1 rounded-full">
                      Most Popular
                    </span>
                  </div>
                )}
                {isCurrent && (
                  <div className="absolute -top-3 right-4">
                    <span className="bg-green-500 text-white text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      Current Plan
                    </span>
                  </div>
                )}
                <CardHeader className="pb-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${planBadgeColors[planKey]}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <CardTitle className="text-xl font-bold text-gray-900 dark:text-white">
                    {plan.name}
                  </CardTitle>
                  <div className="flex items-baseline gap-1 mt-1">
                    {plan.price === 0 ? (
                      <span className="text-3xl font-bold text-gray-900 dark:text-white">Free</span>
                    ) : (
                      <>
                        <span className="text-3xl font-bold text-gray-900 dark:text-white">${plan.price}</span>
                        <span className="text-gray-500 dark:text-gray-400 text-sm">/month</span>
                      </>
                    )}
                  </div>
                  {plan.trialDays > 0 && (
                    <CardDescription className="text-sm text-blue-600 dark:text-blue-400 font-medium mt-1">
                      {plan.trialDays}-day free trial included
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="flex-1">
                  <ul className="space-y-2">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter className="pt-4">
                  {isCurrent && !isExpired ? (
                    <Button className="w-full" variant="outline" disabled>
                      Current Plan
                    </Button>
                  ) : alreadyOnTrial && !isExpired ? (
                    <Button className="w-full" variant="outline" disabled>
                      Trial Active
                    </Button>
                  ) : (
                    <Button
                      className={`w-full ${isPopular ? "bg-blue-600 hover:bg-blue-700" : planKey === "pro" ? "bg-purple-600 hover:bg-purple-700" : ""}`}
                      onClick={() => handleSelectPlan(planKey)}
                      disabled={subscribing}
                    >
                      {subscribing && selectedPlan === planKey ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Processing...
                        </span>
                      ) : isFree ? (
                        "Start Free Trial"
                      ) : isCurrent ? (
                        "Current Plan"
                      ) : currentStatus === "active" ? (
                        `Switch to ${plan.name}`
                      ) : (
                        `Get ${plan.name}`
                      )}
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>

        <div className="mt-8 text-center">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            All paid plans are billed through your Shopify account. You can upgrade, downgrade, or cancel anytime.
          </p>
          <Button
            variant="link"
            className="text-xs text-gray-400 dark:text-gray-500 mt-1"
            onClick={() => setLocation("/admin")}
          >
            Back to Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
