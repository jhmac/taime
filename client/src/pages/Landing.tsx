import { SignIn } from '@clerk/clerk-react';

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col bg-[#F47D31]">
      <div className="flex-1 flex flex-col w-full max-w-md mx-auto bg-[#FFFBF5] shadow-2xl relative min-h-screen">

      {/* ── Top hero banner ────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-gradient-to-br from-[#F47D31] via-[#e8702a] to-[#c95e1a] px-6 pt-14 pb-10 flex flex-col items-center text-center">
        <div className="w-20 h-20 rounded-3xl bg-white/20 backdrop-blur-sm flex items-center justify-center mb-4 shadow-lg ring-4 ring-white/30">
          <img src="/taime-icon.png" alt="Taime" className="w-12 h-12 rounded-2xl" />
        </div>
        <h1 className="text-3xl font-black text-white tracking-tight leading-none">Taime</h1>
        <p className="text-orange-100 text-sm mt-1.5 font-medium">AI Boutique Manager</p>
      </div>

      {/* ── Card that slides up from the bottom ────────────────── */}
      <div className="flex-1 bg-[#FFFBF5] -mt-4 rounded-t-3xl overflow-hidden flex flex-col">
        <div className="px-6 pt-8 pb-2">
          <h2 className="text-2xl font-extrabold text-foreground tracking-tight">Welcome back</h2>
          <p className="text-muted-foreground text-sm mt-1">Sign in to continue to your store</p>
        </div>

        <div className="flex-1 px-6 py-4">
          <SignIn
            fallbackRedirectUrl="/"
            signUpFallbackRedirectUrl="/"
            appearance={{
              layout: {
                showOptionalFields: false,
                logoPlacement: "none",
              },
              variables: {
                colorPrimary: "#F47D31",
                colorBackground: "#FFFBF5",
                colorText: "#1a1a1a",
                colorTextSecondary: "#6b7280",
                colorInputBackground: "#ffffff",
                colorInputText: "#1a1a1a",
                borderRadius: "0.75rem",
                fontFamily: "inherit",
                fontSize: "0.9375rem",
                spacingUnit: "1rem",
              },
              elements: {
                // Hide Clerk's own header — we have ours above
                headerTitle: "hidden",
                headerSubtitle: "hidden",
                header: "hidden",

                // Card: transparent so the page background shows through
                card: "shadow-none bg-transparent p-0 gap-0",
                rootBox: "w-full",

                // Social button (Google etc.) — pill style, white with border
                socialButtonsBlockButton:
                  "border border-border bg-white text-foreground font-semibold rounded-xl h-12 shadow-sm hover:bg-muted/50 transition-colors",
                socialButtonsBlockButtonText: "font-semibold text-sm",

                // Divider
                dividerRow: "my-4",
                dividerText: "text-xs text-muted-foreground",

                // Inputs
                formFieldInput:
                  "rounded-xl border-border bg-white h-12 px-4 text-sm focus:ring-2 focus:ring-[#F47D31]/30 focus:border-[#F47D31]",
                formFieldLabel: "text-sm font-semibold text-foreground mb-1",
                formFieldRow: "mb-3",

                // Primary action button — brand orange
                formButtonPrimary:
                  "bg-[#F47D31] hover:bg-[#e06b21] active:bg-[#c95e1a] text-white font-bold rounded-xl h-12 w-full text-sm shadow-md transition-colors mt-1",

                // Footer links (Sign up, Forgot password)
                footerActionLink: "text-[#F47D31] font-semibold hover:text-[#e06b21]",
                footerActionText: "text-muted-foreground text-sm",
                footer: "mt-4",

                // "Secured by Clerk" badge — keep but subdue it
                footerPages: "mt-2",
                internal: "text-muted-foreground/60",
              },
            }}
          />
        </div>
      </div>

      </div>
    </div>
  );
}
