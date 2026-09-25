import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;

export const isConfigured = Boolean(url && key);

export const supabase = createClient(url ?? 'https://not-configured.supabase.co', key ?? 'missing', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
    flowType: 'pkce',
  },
});

// Refresh tokens only while the app is in the foreground.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

const FRIENDLY: Record<string, string> = {
  sign_in_required: 'Sign in with GitHub first.',
  github_login_disabled:
    "GitHub sign-in isn't switched on for this ArkStore server yet. In Supabase, enable the GitHub provider under Authentication > Providers.",
  'provider is not enabled':
    "GitHub sign-in isn't switched on for this ArkStore server yet. In Supabase, enable the GitHub provider under Authentication > Providers.",
  github_account_required: 'Your ArkStore account needs to be linked to GitHub.',
  invalid_repo: "That doesn't look like a GitHub repo link.",
  invalid_name: 'Give your app a name (up to 40 characters).',
  invalid_category: 'Pick a category.',
  repo_not_found: "GitHub can't find that repo. Check the link and that the repo is public.",
  repo_private: 'That repo is private. Only public repos can be listed.',
  not_repo_owner:
    "You can only publish repos you own or can push to. For an organisation's repo, sign out and in again so ArkStore can check your access.",
  // Historic name: raised when the newest release has nothing installable for any platform.
  no_apk_release:
    'Nothing to install in your releases yet. Attach an APK, EXE, MSI, DMG, AppImage or DEB to a GitHub release and try again.',
  already_listed: 'Someone else already listed this repo. If it is yours, contact us to transfer it.',
  github_rate_limited: 'GitHub is busy. Try again in a minute.',
  github_unavailable: "Couldn't reach GitHub. Try again in a minute.",
  not_app_owner: "Only the app's developer can do that.",
  app_not_found: 'This app is no longer listed.',
  device_not_found: 'That device is already signed out.',
  PGRST205: "ArkStore's database isn't set up yet. Run supabase/setup.sql in your Supabase project.",
  PGRST202: "ArkStore's database needs an update. Run supabase/setup.sql in your Supabase project again.",
  '42703': "ArkStore's database needs an update. Run supabase/setup.sql in your Supabase project again.",
};

/** Maps database error codes (raised by our SQL functions) to sentences people can act on. */
export function friendlyError(error: unknown): string {
  if (!error) return 'Something went wrong.';
  const e = error as { message?: string; code?: string };
  if (e.code && FRIENDLY[e.code]) return FRIENDLY[e.code];
  const message = e.message ?? String(error);
  for (const [code, text] of Object.entries(FRIENDLY)) {
    if (message.includes(code)) return text;
  }
  if (/network request failed|failed to fetch/i.test(message)) return "You're offline. Check your connection.";
  return message;
}
