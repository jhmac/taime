import { useState } from 'react';
import { useNativeClerkSignIn, EmailStep } from '@/hooks/useNativeClerkSignIn';
import { SiGoogle, SiApple } from 'react-icons/si';
import { Mail, ArrowLeft, Eye, EyeOff } from 'lucide-react';

export default function NativeLanding() {
  const { signInWithProvider, prepareEmailSignIn, signInWithPassword, signInWithEmailCode } =
    useNativeClerkSignIn();

  const [loading, setLoading] = useState<string | null>(null);
  const [step, setStep] = useState<EmailStep>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleProvider(provider: 'oauth_google' | 'oauth_apple') {
    setLoading(provider);
    setError(null);
    try {
      await signInWithProvider(provider);
    } catch (err: any) {
      setError(err?.message ?? 'Sign-in failed. Please try again.');
    } finally {
      setLoading(null);
    }
  }

  async function handleEmailContinue(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading('email');
    setError(null);
    try {
      const next = await prepareEmailSignIn(email.trim());
      setStep(next);
    } catch (err: any) {
      setError(err?.errors?.[0]?.longMessage ?? err?.message ?? 'Could not find that account.');
    } finally {
      setLoading(null);
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setLoading('password');
    setError(null);
    try {
      await signInWithPassword(password);
    } catch (err: any) {
      setError(err?.errors?.[0]?.longMessage ?? err?.message ?? 'Incorrect password.');
    } finally {
      setLoading(null);
    }
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading('code');
    setError(null);
    try {
      await signInWithEmailCode(code.trim());
    } catch (err: any) {
      setError(err?.errors?.[0]?.longMessage ?? err?.message ?? 'Invalid or expired code.');
    } finally {
      setLoading(null);
    }
  }

  function resetToEmail() {
    setStep('email');
    setPassword('');
    setCode('');
    setError(null);
  }

  const isLoading = loading !== null;

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
          <div className="px-6 pt-8 pb-2 flex items-center gap-2">
            {step !== 'email' && (
              <button
                onClick={resetToEmail}
                className="mr-1 p-1 rounded-full hover:bg-muted transition-colors"
                aria-label="Back"
              >
                <ArrowLeft className="w-5 h-5 text-muted-foreground" />
              </button>
            )}
            <div>
              <h2 className="text-2xl font-extrabold text-foreground tracking-tight">
                {step === 'email' ? 'Welcome back' : step === 'password' ? 'Enter password' : 'Check your email'}
              </h2>
              <p className="text-muted-foreground text-sm mt-1">
                {step === 'email'
                  ? 'Sign in to continue to your store'
                  : step === 'password'
                  ? email
                  : `We sent a code to ${email}`}
              </p>
            </div>
          </div>

          <div className="px-6 py-6 flex flex-col gap-3">

            {/* ── Email step ── */}
            {step === 'email' && (
              <>
                {/* Sign in with Google */}
                <button
                  onClick={() => handleProvider('oauth_google')}
                  disabled={isLoading}
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
                  disabled={isLoading}
                  className="flex items-center justify-center gap-3 border border-border bg-white text-foreground font-semibold rounded-xl h-12 shadow-sm hover:bg-muted/50 active:bg-muted transition-colors disabled:opacity-60 w-full"
                >
                  {loading === 'oauth_apple' ? (
                    <span className="h-4 w-4 rounded-full border-2 border-foreground/30 border-t-foreground animate-spin" />
                  ) : (
                    <SiApple className="w-4 h-4 text-foreground" />
                  )}
                  <span className="text-sm">Continue with Apple</span>
                </button>

                {/* Divider */}
                <div className="flex items-center gap-3 my-1">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground font-medium">or</span>
                  <div className="flex-1 h-px bg-border" />
                </div>

                {/* Email form */}
                <form onSubmit={handleEmailContinue} className="flex flex-col gap-3">
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <input
                      type="email"
                      autoComplete="email"
                      placeholder="Email address"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={isLoading}
                      className="w-full h-12 pl-10 pr-4 rounded-xl border border-border bg-white text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#F47D31]/50 disabled:opacity-60"
                    />
                  </div>

                  {error && <p className="text-sm text-destructive">{error}</p>}

                  <button
                    type="submit"
                    disabled={isLoading || !email.trim()}
                    className="flex items-center justify-center gap-2 bg-[#F47D31] text-white font-semibold rounded-xl h-12 shadow-sm hover:bg-[#e8702a] active:bg-[#c95e1a] transition-colors disabled:opacity-60 w-full"
                  >
                    {loading === 'email' ? (
                      <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    ) : (
                      <span className="text-sm">Continue with Email</span>
                    )}
                  </button>
                </form>
              </>
            )}

            {/* ── Password step ── */}
            {step === 'password' && (
              <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-3">
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus
                    disabled={isLoading}
                    className="w-full h-12 pl-4 pr-10 rounded-xl border border-border bg-white text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#F47D31]/50 disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                <button
                  type="submit"
                  disabled={isLoading || !password}
                  className="flex items-center justify-center gap-2 bg-[#F47D31] text-white font-semibold rounded-xl h-12 shadow-sm hover:bg-[#e8702a] active:bg-[#c95e1a] transition-colors disabled:opacity-60 w-full"
                >
                  {loading === 'password' ? (
                    <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                  ) : (
                    <span className="text-sm">Sign In</span>
                  )}
                </button>
              </form>
            )}

            {/* ── Email code step ── */}
            {step === 'code' && (
              <form onSubmit={handleCodeSubmit} className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  Enter the 6-digit code from your email to sign in.
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  required
                  autoFocus
                  disabled={isLoading}
                  className="w-full h-12 px-4 rounded-xl border border-border bg-white text-sm text-foreground placeholder:text-muted-foreground text-center tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-[#F47D31]/50 disabled:opacity-60"
                />

                {error && <p className="text-sm text-destructive">{error}</p>}

                <button
                  type="submit"
                  disabled={isLoading || code.length < 6}
                  className="flex items-center justify-center gap-2 bg-[#F47D31] text-white font-semibold rounded-xl h-12 shadow-sm hover:bg-[#e8702a] active:bg-[#c95e1a] transition-colors disabled:opacity-60 w-full"
                >
                  {loading === 'code' ? (
                    <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                  ) : (
                    <span className="text-sm">Verify Code</span>
                  )}
                </button>
              </form>
            )}

          </div>
        </div>

      </div>
    </div>
  );
}
