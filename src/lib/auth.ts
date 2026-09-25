// Sign in with GitHub through Supabase Auth. The GitHub token Supabase hands back is kept
// on the device (SecureStore) and used for GitHub API calls while publishing, and to prove
// push access to organisation repos. It never goes into the database.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { showAlert } from './alert';
import { desktop, onDesktopUrl } from './desktop';
import { forgetThisDevice } from './devices';
import { friendlyError, supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

const TOKEN_KEY = 'arkstore.github_token';

async function saveToken(token: string) {
  if (Platform.OS === 'web') await AsyncStorage.setItem(TOKEN_KEY, token);
  else await SecureStore.setItemAsync(TOKEN_KEY, token);
}

async function clearToken() {
  if (Platform.OS === 'web') await AsyncStorage.removeItem(TOKEN_KEY);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function getGitHubToken(): Promise<string | null> {
  try {
    return Platform.OS === 'web' ? await AsyncStorage.getItem(TOKEN_KEY) : await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

type AuthState = { session: Session | null; ready: boolean };
export const useAuth = create<AuthState>()(() => ({ session: null, ready: false }));

supabase.auth
  .getSession()
  .then(({ data }) => useAuth.setState({ session: data.session, ready: true }))
  .catch(() => useAuth.setState({ ready: true }));

supabase.auth.onAuthStateChange((event, session) => {
  useAuth.setState({ session, ready: true });
  if (session?.provider_token) saveToken(session.provider_token).catch(() => undefined);
  if (event === 'SIGNED_OUT') clearToken().catch(() => undefined);
});

const SCOPES = 'read:user';

/**
 * Whether the Supabase project has the GitHub provider switched on. Checked up front so
 * people get a readable message instead of Supabase's raw "provider is not enabled" page.
 */
async function githubSignInEnabled(): Promise<boolean | null> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;
  if (!url || !key) return false;
  try {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
    if (!res.ok) return null;
    const settings = (await res.json()) as { external?: Record<string, boolean> };
    return Boolean(settings.external?.github);
  } catch {
    return null; // Offline or blocked: let the sign-in attempt report the real problem.
  }
}

export async function signInWithGitHub(): Promise<'signed-in' | 'cancelled' | 'redirecting'> {
  if ((await githubSignInEnabled()) === false) throw new Error('github_login_disabled');

  if (desktop) {
    // Sign in in the person's own browser (where they're likely signed in to GitHub already);
    // GitHub sends them back to arkstore://auth-callback, which the desktop app hands to
    // completeSignIn() below.
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: 'arkstore://auth-callback', skipBrowserRedirect: true, scopes: SCOPES },
    });
    if (error) throw error;
    await desktop.openExternal(data.url);
    return 'redirecting';
  }

  if (Platform.OS === 'web') {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      // Include the site's base path (e.g. /ArkStore on GitHub Pages).
      options: { redirectTo: `${window.location.origin}${Constants.expoConfig?.experiments?.baseUrl ?? ''}/auth-callback`, scopes: SCOPES },
    });
    if (error) throw error;
    return 'redirecting';
  }

  const redirectTo = Linking.createURL('auth-callback');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo, skipBrowserRedirect: true, scopes: SCOPES },
  });
  if (error) throw error;

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return 'cancelled';
  await completeSignIn(result.url);
  return 'signed-in';
}

// A redirect can reach us twice on Android (the auth browser session and the deep-link
// handler both see it). A code can only be exchanged once, so share one exchange per code.
const exchanges = new Map<string, Promise<void>>();

/** Finishes the OAuth round trip from the redirect URL (?code=...). Safe to call twice. */
export function completeSignIn(url: string): Promise<void> {
  const { queryParams } = Linking.parse(url);
  const errorText = queryParams?.error_description ?? queryParams?.error;
  if (errorText) return Promise.reject(new Error(String(errorText)));
  const code = queryParams?.code;
  if (typeof code !== 'string') return Promise.resolve();

  let pending = exchanges.get(code);
  if (!pending) {
    pending = (async () => {
      if ((await supabase.auth.getSession()).data.session) return;
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      if (data.session?.provider_token) await saveToken(data.session.provider_token);
    })();
    exchanges.set(code, pending);
  }
  return pending;
}

// Desktop: the browser hands the sign-in redirect to the app as an arkstore:// link.
onDesktopUrl((url) => {
  if (url.startsWith('arkstore://auth-callback')) {
    completeSignIn(url).catch((e) => showAlert("Couldn't sign in", friendlyError(e)));
  }
});

export async function signOut() {
  await forgetThisDevice().catch(() => undefined);
  await supabase.auth.signOut();
  await clearToken();
}

export function githubProfile(session: Session | null) {
  if (!session) return null;
  const meta = session.user.user_metadata ?? {};
  const identity = session.user.identities?.find((i) => i.provider === 'github')?.identity_data ?? {};
  return {
    login: (identity.user_name ?? meta.user_name ?? meta.preferred_username ?? '') as string,
    name: (meta.full_name ?? meta.name ?? '') as string,
    avatar: (meta.avatar_url ?? identity.avatar_url ?? null) as string | null,
  };
}
