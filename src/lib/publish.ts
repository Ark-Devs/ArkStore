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
export async function listMyRepos(token: string): Promise<GitHubRepo[]> {
  const res = await fetch(
    'https://api.github.com/user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator,organization_member',
    { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(res.status === 401 ? 'github_token_expired' : `GitHub returned ${res.status}`);
  const repos = (await res.json()) as GitHubRepo[];
  return repos.filter((r) => !r.private && !r.archived);
}

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
