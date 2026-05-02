import { useState } from 'react';
import { useNativeClerkSignIn } from '@/hooks/useNativeClerkSignIn';
import { SiGoogle, SiApple } from 'react-icons/si';

export default function NativeLanding() {
  const { signInWithProvider } = useNativeClerkSignIn();
  const [loading, setLoading] = useState<string | null>(null);

  async function handleProvider(provider: 'oauth_google' | 'oauth_apple') {
    setLoading(provider);
    try {
      await signInWithProvider(provider);
    } catch (err) {
      console.error('Native sign-in error:', err);
    } finally {
      setLoading(null);
    }
  }

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

        {/* ── Sign-in card ────────────────────────────────────────── */}
        <div className="flex-1 bg-[#FFFBF5] -mt-4 rounded-t-3xl overflow-hidden flex flex-col">
          <div className="px-6 pt-8 pb-2">
            <h2 className="text-2xl font-extrabold text-foreground tracking-tight">Welcome back</h2>
            <p className="text-muted-foreground text-sm mt-1">Sign in to continue to your store</p>
          </div>

          <div className="px-6 py-6 flex flex-col gap-3">
            {/* Sign in with Google */}
            <button
              onClick={() => handleProvider('oauth_google')}
              disabled={loading !== null}
              className="flex items-center justify-center gap-3 border border-border bg-white text-foreground font-semibold rounded-xl h-12 shadow-sm hover:bg-muted/50 active:bg-muted transition-colors disabled:opacity-60 w-full"
            >
              {loading === 'oauth_google' ? (
                <span className="h-4 w-4 rounded-full border-2 border-foreground/30 border-t-foreground animate-spin" />
              ) : (
                <SiGoogle className="w-4 h-4 text-[#4285F4]" />
              )}
              <span className="text-sm">Continue with Google</span>
            </button>

            {/* Sign in with Apple */}
            <button
              onClick={() => handleProvider('oauth_apple')}
              disabled={loading !== null}
              className="flex items-center justify-center gap-3 border border-border bg-white text-foreground font-semibold rounded-xl h-12 shadow-sm hover:bg-muted/50 active:bg-muted transition-colors disabled:opacity-60 w-full"
            >
              {loading === 'oauth_apple' ? (
                <span className="h-4 w-4 rounded-full border-2 border-foreground/30 border-t-foreground animate-spin" />
              ) : (
                <SiApple className="w-4 h-4 text-foreground" />
              )}
              <span className="text-sm">Continue with Apple</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
