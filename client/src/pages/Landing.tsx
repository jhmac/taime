import { SignIn } from '@clerk/clerk-react';
import { Clock, Brain, BarChart3, Bell } from 'lucide-react';

const features = [
  {
    icon: Clock,
    title: 'Smart Time Tracking',
    description: 'Geofenced clock-in/out with AI monitoring',
  },
  {
    icon: Brain,
    title: 'AI Task Assignment',
    description: 'Claude AI optimizes workload distribution',
  },
  {
    icon: BarChart3,
    title: 'Smart Analytics',
    description: 'Real-time insights and anomaly detection',
  },
  {
    icon: Bell,
    title: 'Smart Notifications',
    description: 'Location-based reminders and alerts',
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#FFFBF5] flex items-center justify-center p-4 md:p-8">
      <div className="w-full max-w-5xl rounded-2xl shadow-xl overflow-hidden flex flex-col md:flex-row bg-white">

        {/* Brand panel — orange gradient matching Taime identity */}
        <div className="md:w-1/2 bg-gradient-to-br from-[#F47D31] to-[#d4611a] p-6 md:p-12 flex flex-col justify-center text-white">
          <div className="flex items-center gap-3 mb-2 md:mb-6">
            <img src="/taime-icon.png" alt="Taime" className="h-10 md:h-12 w-auto rounded-xl" />
            <p className="text-orange-100 text-xs md:hidden">AI Boutique Manager</p>
          </div>

          <p className="hidden md:block text-orange-100 text-base md:text-lg mb-8 leading-relaxed">
            AI Boutique Manager — streamline scheduling, time tracking, and team productivity.
          </p>

          <div className="hidden md:block space-y-5">
            {features.map((feature) => (
              <div key={feature.title} className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-white/15 flex items-center justify-center shrink-0 mt-0.5">
                  <feature.icon className="w-5 h-5 text-orange-100" />
                </div>
                <div>
                  <p className="font-semibold text-sm text-white">{feature.title}</p>
                  <p className="text-orange-100 text-sm leading-snug">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden md:flex mt-2 md:mt-10 pt-2 md:pt-6 border-t border-white/20 flex-wrap gap-3 md:block">
            <p className="text-orange-200 text-xs">
              Trusted by boutique teams to manage workforce operations efficiently.
            </p>
          </div>
        </div>

        {/* Sign-in panel */}
        <div className="md:w-1/2 flex items-center justify-center p-8 md:p-12 bg-[#FFFBF5]">
          <div className="w-full max-w-sm space-y-6">
            <div className="text-center md:text-left">
              <h2 className="text-xl font-semibold text-foreground">Welcome back</h2>
              <p className="text-muted-foreground text-sm mt-1">Sign in to your account to continue</p>
            </div>

            <div data-testid="clerk-sign-in">
              <SignIn
                afterSignInUrl="/"
                afterSignUpUrl="/"
                appearance={{
                  elements: {
                    rootBox: "w-full",
                    card: "shadow-none border-0 p-0 bg-transparent",
                  }
                }}
              />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
