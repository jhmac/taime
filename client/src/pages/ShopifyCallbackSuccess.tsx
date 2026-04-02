import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { CheckCircle, Store, Users, Clock, ArrowRight, AlertCircle } from "lucide-react";

type Phase = "loading" | "onboarding" | "error";

export default function ShopifyCallbackSuccess() {
  const search = useSearch();
  const [phase, setPhase] = useState<Phase>("loading");
  const [shop, setShop] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(search);
    const shopParam = params.get("shop");
    const error = params.get("error");
    const message = params.get("message");

    if (window.opener && !window.opener.closed) {
      if (error) {
        window.opener.postMessage(
          { type: "shopify-oauth-error", message: message || "Connection failed" },
          window.location.origin
        );
      } else {
        window.opener.postMessage(
          { type: "shopify-oauth-success", shop: shopParam },
          window.location.origin
        );
      }
      window.close();
      return;
    }

    if (error) {
      setErrorMessage(message || "Connection failed. Please try again.");
      setPhase("error");
    } else {
      setShop(shopParam);
      setPhase("onboarding");
    }
  }, [search]);

  const steps = [
    {
      icon: <Store className="w-6 h-6 text-green-600" />,
      title: "Shopify Store Connected",
      description: "Your store's sales data will now sync automatically to power staffing recommendations.",
    },
    {
      icon: <Users className="w-6 h-6 text-blue-600" />,
      title: "Add Your Team Members",
      description: "Head to the Team section to invite staff. MAinager uses your team roster to build schedules.",
    },
    {
      icon: <Clock className="w-6 h-6 text-purple-600" />,
      title: "Set Your Store Hours",
      description: "Configure your operating hours in Admin Settings so the scheduler knows when to staff.",
    },
  ];

  if (phase === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center space-y-4 p-8">
          <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto animate-pulse">
            <Store className="w-6 h-6 text-green-600" />
          </div>
          <p className="text-gray-500 text-sm">Connecting your store...</p>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white p-4">
        <div className="max-w-sm w-full text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto">
            <AlertCircle className="w-8 h-8 text-red-600" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-gray-900">Connection Failed</h1>
            <p className="text-sm text-gray-500">{errorMessage}</p>
          </div>
          <button
            onClick={() => (window.location.href = "/admin")}
            className="w-full py-3 px-4 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            Back to Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center space-y-3">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <CheckCircle className="w-10 h-10 text-green-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">You're connected!</h1>
            {shop && (
              <p className="text-sm text-gray-500 mt-1 font-medium">{shop}</p>
            )}
            <p className="text-gray-600 text-sm mt-2">
              MAinager is now linked to your Shopify store. Here's how to get the most out of it:
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {steps.map((step, index) => (
            <div
              key={index}
              className={`flex items-start gap-4 p-4 rounded-xl border transition-all duration-300 ${
                currentStep >= index
                  ? "bg-white border-gray-200 shadow-sm"
                  : "bg-gray-50 border-gray-100 opacity-60"
              }`}
            >
              <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center flex-shrink-0">
                {step.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-500 text-xs flex items-center justify-center flex-shrink-0 font-medium">
                    {index + 1}
                  </span>
                  <h3 className="text-sm font-semibold text-gray-900">{step.title}</h3>
                </div>
                <p className="text-xs text-gray-500 mt-1 ml-7">{step.description}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          {currentStep < steps.length - 1 ? (
            <button
              onClick={() => setCurrentStep((s) => s + 1)}
              className="w-full py-3 px-4 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
            >
              Next step
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={() => (window.location.href = "/admin?shopify=connected&shop=" + encodeURIComponent(shop || ""))}
              className="w-full py-3 px-4 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
            >
              Go to Dashboard
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => (window.location.href = "/admin?shopify=connected&shop=" + encodeURIComponent(shop || ""))}
            className="w-full py-3 px-4 text-gray-500 text-sm hover:text-gray-700 transition-colors"
          >
            Skip setup
          </button>
        </div>

        <p className="text-center text-xs text-gray-400">
          MAinager only reads your orders and products — your store data stays secure.
        </p>
      </div>
    </div>
  );
}
