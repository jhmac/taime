import { useSignIn } from '@clerk/clerk-react';
import { isNativePlatform } from '@/lib/capacitor';

// Custom URL scheme registered in Info.plist CFBundleURLTypes and capacitor.config.ts.
// Clerk must also have this URL listed as an allowed redirect origin in its dashboard.
export const NATIVE_OAUTH_REDIRECT = 'com.taimetaime://oauth-callback';

export type EmailStep = 'email' | 'password' | 'code';

export function useNativeClerkSignIn() {
  const { signIn, setActive, isLoaded } = useSignIn();

  async function signInWithProvider(provider: 'oauth_google' | 'oauth_apple' | 'oauth_github') {
    if (!isLoaded || !signIn) return;

    if (!isNativePlatform()) {
      await signIn.authenticateWithRedirect({
        strategy: provider,
        redirectUrl: '/sso-callback',
        redirectUrlComplete: '/',
      });
      return;
    }

    const { Browser } = await import('@capacitor/browser');

    const result = await signIn.create({
      strategy: provider,
      redirectUrl: NATIVE_OAUTH_REDIRECT,
      actionCompleteRedirectUrl: NATIVE_OAUTH_REDIRECT,
    });

    const externalUrl =
      result.firstFactorVerification?.externalVerificationRedirectURL;

    if (externalUrl) {
      await Browser.open({
        url: externalUrl.toString(),
        presentationStyle: 'popover',
      });
    }
  }

  /**
   * Step 1 – submit the email address.
   * Returns the next step: 'password' or 'code' (email OTP).
   */
  async function prepareEmailSignIn(email: string): Promise<EmailStep> {
    if (!isLoaded || !signIn) throw new Error('Sign-in not loaded');

    const result = await signIn.create({ identifier: email });

    const supported = result.supportedFirstFactors ?? [];

    const hasPassword = supported.some((f) => f.strategy === 'password');
    if (hasPassword) return 'password';

    const emailCodeFactor = supported.find((f) => f.strategy === 'email_code');
    if (emailCodeFactor && 'emailAddressId' in emailCodeFactor) {
      await signIn.prepareFirstFactor({
        strategy: 'email_code',
        emailAddressId: emailCodeFactor.emailAddressId as string,
      });
      return 'code';
    }

    throw new Error('No supported sign-in strategy found for this email.');
  }

  /** Step 2a – verify with password */
  async function signInWithPassword(password: string): Promise<void> {
    if (!isLoaded || !signIn || !setActive) throw new Error('Sign-in not loaded');

    const result = await signIn.attemptFirstFactor({
      strategy: 'password',
      password,
    });

    if (result.status === 'complete') {
      await setActive({ session: result.createdSessionId });
    } else {
      throw new Error('Sign-in incomplete. Please try again.');
    }
  }

  /** Step 2b – verify with email OTP code */
  async function signInWithEmailCode(code: string): Promise<void> {
    if (!isLoaded || !signIn || !setActive) throw new Error('Sign-in not loaded');

    const result = await signIn.attemptFirstFactor({
      strategy: 'email_code',
      code,
    });

    if (result.status === 'complete') {
      await setActive({ session: result.createdSessionId });
    } else {
      throw new Error('Invalid or expired code. Please try again.');
    }
  }

  return {
    signInWithProvider,
    prepareEmailSignIn,
    signInWithPassword,
    signInWithEmailCode,
    isNative: isNativePlatform(),
  };
}
