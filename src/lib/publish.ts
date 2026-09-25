import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import type { GitHubRepo } from './github/detect';
import { supabase } from './supabase';
import type { StoreApp } from './types';

export type ListingInput = {
  repo: string;
  name: string;
  subtitle: string;
  description: string;
  category: string;
  icon_url: string | null;
  screenshots: string[];
  homepage?: string | null;
  package_name?: string | null;
  min_sdk?: number | null;
};

/** Public repos the signed-in developer can publish, most recently pushed first. */
async function ghList<T>(path: string, token: string): Promise<T[]> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(res.status === 401 ? 'github_token_expired' : `GitHub returned ${res.status}`);
  return (await res.json()) as T[];
}

/**
 * Public repos you can publish: your own, ones you collaborate on, and every organization you
 * belong to. Organizations that restrict third-party apps only show up once an owner approves
 * ArkStore on GitHub (see GITHUB_APP_ACCESS_URL).
 */
export async function listMyRepos(token: string): Promise<GitHubRepo[]> {
  const [mine, orgs] = await Promise.all([
    ghList<GitHubRepo>('/user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator,organization_member', token),
    ghList<{ login: string }>('/user/orgs?per_page=100', token).catch(() => []),
  ]);
  const orgRepos = await Promise.all(
    orgs.map((o) => ghList<GitHubRepo>(`/orgs/${o.login}/repos?type=public&sort=pushed&per_page=100`, token).catch(() => [])),
  );
  const seen = new Set<string>();
  return [...mine, ...orgRepos.flat()]
    .filter((r) => !r.private && !r.archived)
    .filter((r) => (seen.has(r.full_name) ? false : (seen.add(r.full_name), true)))
    .sort((a, b) => Date.parse(b.pushed_at ?? '0') - Date.parse(a.pushed_at ?? '0'));
}

/** Where an organization owner approves ArkStore's GitHub sign-in for their organization. */
export const GITHUB_APP_ACCESS_URL = process.env.EXPO_PUBLIC_GITHUB_CLIENT_ID
  ? `https://github.com/settings/connections/applications/${process.env.EXPO_PUBLIC_GITHUB_CLIENT_ID}`
  : 'https://github.com/settings/applications';

/** Create a listing, update your own, or claim a curated one. Ownership is checked in the database. */
export async function publishApp(input: ListingInput, githubToken: string | null): Promise<StoreApp> {
  const { data, error } = await supabase.rpc('publish_app', { p: input, p_github_token: githubToken });
  if (error) throw error;
  return data as StoreApp;
}

export async function updateListing(
  id: string,
  patch: Partial<Pick<StoreApp, 'name' | 'subtitle' | 'description' | 'category' | 'icon_url' | 'screenshots' | 'homepage' | 'status'>>,
) {
  const { data, error } = await supabase.from('apps').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  return data as StoreApp;
}

export async function refreshListing(id: string, githubToken: string | null) {
  const { data, error } = await supabase.rpc('refresh_app', { p_app_id: id, p_github_token: githubToken });
  if (error) throw error;
  return data as StoreApp;
}

export async function deleteListing(id: string) {
  const { error } = await supabase.from('apps').delete().eq('id', id);
  if (error) throw error;
}

/** Upload an icon or screenshot picked from the gallery; returns its public URL. */
export async function uploadImage(uri: string, uid: string, mimeType = 'image/jpeg'): Promise<string> {
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const path = `${uid}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const body = Platform.OS === 'web' ? await (await fetch(uri)).blob() : await new File(uri).bytes();
  const { error } = await supabase.storage.from('media').upload(path, body, { contentType: mimeType, upsert: false });
  if (error) throw error;
  return supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
}
