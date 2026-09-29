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

// read:org lists the organizations you belong to (also ones where your membership is private),
// so their repos show up in Studio.
const SCOPES = 'read:user read:org';

/** Ways to sign in. GitHub is also what publishing needs; Google and Apple are for everyone else. */
export type AuthProvider = 'github' | 'google' | 'apple';
export const PROVIDER_LABEL: Record<AuthProvider, string> = { github: 'GitHub', google: 'Google', apple: 'Apple' };

/**
 * Which providers the Supabase project has switched on (Authentication > Providers). Buttons
 * for the others stay hidden, so turning one on in Supabase is all it takes to offer it.
 */
async function enabledProviders(): Promise<Record<AuthProvider, boolean> | null> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;
  if (!url || !key) return { github: false, google: false, apple: false };
  try {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
    if (!res.ok) return null;
    const settings = (await res.json()) as { external?: Record<string, boolean> };
    const e = settings.external ?? {};
    return { github: Boolean(e.github), google: Boolean(e.google), apple: Boolean(e.apple) };
  } catch {
    return null; // Offline or blocked: let the sign-in attempt report the real problem.
  }
}

export const useProviders = create<{ enabled: Record<AuthProvider, boolean> }>()(() => ({
  enabled: { github: true, google: false, apple: false },
}));
enabledProviders().then((e) => e && useProviders.setState({ enabled: e }));

/** Where the provider sends people back to: the app, the desktop app, or this website. */
function redirectTarget(): string {
  if (desktop) return 'arkstore://auth-callback';
  // Include the site's base path (e.g. /ArkStore on GitHub Pages).
  if (Platform.OS === 'web') return `${window.location.origin}${Constants.expoConfig?.experiments?.baseUrl ?? ''}/auth-callback`;
  return Linking.createURL('auth-callback');
}

/**
 * Runs an OAuth round trip: sign-in, or (link) adding GitHub / Google / Apple to the account
 * someone is signed in to. Desktop and web leave for the browser and come back through
 * completeSignIn(); phones use an in-app browser session.
 */
async function oauth(provider: AuthProvider, link: boolean): Promise<'signed-in' | 'cancelled' | 'redirecting'> {
  const enabled = await enabledProviders();
  if (enabled && !enabled[provider]) throw new Error(`${provider}_login_disabled`);
  const redirectTo = redirectTarget();
  const options = {
    redirectTo,
    skipBrowserRedirect: Platform.OS !== 'web' || Boolean(desktop),
    ...(provider === 'github' ? { scopes: SCOPES } : {}),
  };
  const { data, error } = link
    ? await supabase.auth.linkIdentity({ provider, options })
    : await supabase.auth.signInWithOAuth({ provider, options });
  if (error) throw error;
  if (link) linking = true;
  if (desktop) {
    await desktop.openExternal(data.url!);
    return 'redirecting';
  }
  if (Platform.OS === 'web') return 'redirecting';
  const result = await WebBrowser.openAuthSessionAsync(data.url!, redirectTo);
  if (result.type !== 'success') return 'cancelled';
  await completeSignIn(result.url);
  return 'signed-in';
}

export const signIn = (provider: AuthProvider) => oauth(provider, false);
export const signInWithGitHub = () => oauth('github', false);
/** Adds GitHub (needed to publish) or another provider to the signed-in account. */
export const linkProvider = (provider: AuthProvider) => oauth(provider, true);

// A link round trip ends with a code like a sign-in does, but someone is already signed in:
// the code still has to be exchanged, for the new identity and GitHub's token.
let linking = false;

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
      if (!linking && (await supabase.auth.getSession()).data.session) return;
      linking = false;
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

/** Which providers this account can sign in with. */
export function linkedProviders(session: Session | null): AuthProvider[] {
  return (session?.user.identities ?? []).map((i) => i.provider).filter((p): p is AuthProvider => p in PROVIDER_LABEL);
}

/** Publishing lists repos under a GitHub account, so it needs GitHub linked (checked again by the database). */
export const hasGitHub = (session: Session | null) => linkedProviders(session).includes('github');

/**
 * The profile to show, from whichever providers are linked: GitHub's username when there is
 * one (apps are published under it), otherwise the name and photo from Google or Apple.
 * Supabase keeps all of it on the account (auth.users), so it survives signing in elsewhere.
 */
export function githubProfile(session: Session | null) {
  if (!session) return null;
  const meta = session.user.user_metadata ?? {};
  const ids = session.user.identities ?? [];
  const github = ids.find((i) => i.provider === 'github')?.identity_data ?? {};
  const other = ids.find((i) => i.provider !== 'github')?.identity_data ?? {};
  const email = (session.user.email ?? meta.email ?? other.email ?? '') as string;
  return {
    /** GitHub username, or '' when GitHub isn't linked. */
    login: (github.user_name ?? github.preferred_username ?? '') as string,
    name: (meta.full_name ?? meta.name ?? other.full_name ?? other.name ?? github.full_name ?? '') as string,
    email,
    avatar: (meta.avatar_url ?? meta.picture ?? github.avatar_url ?? other.avatar_url ?? other.picture ?? null) as string | null,
  };
}
