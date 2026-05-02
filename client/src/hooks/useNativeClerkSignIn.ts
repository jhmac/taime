import { useSignIn } from '@clerk/clerk-react';
import { isNativePlatform } from '@/lib/capacitor';

// Custom URL scheme registered in Info.plist CFBundleURLTypes and capacitor.config.ts.
// Clerk must also have this URL listed as an allowed redirect origin in its dashboard.
export const NATIVE_OAUTH_REDIRECT = 'com.taimetaime://oauth-callback';

export function useNativeClerkSignIn() {
  const { signIn, isLoaded } = useSignIn();

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

  return { signInWithProvider, isNative: isNativePlatform() };
}
