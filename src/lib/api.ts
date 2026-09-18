import { useQuery } from '@tanstack/react-query';

import { supabase } from './supabase';
import {
  LIST_COLUMNS,
  type AppVersion,
  type Category,
  type DownloadDay,
  type ListApp,
  type StoreApp,
} from './types';

export type AppOrder = 'stars' | 'downloads' | 'released' | 'created';

const ORDER_COLUMN: Record<AppOrder, string> = {
  stars: 'stars',
  downloads: 'downloads',
  released: 'latest_published_at',
  created: 'created_at',
};

async function unwrap<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

export const keys = {
  categories: ['categories'] as const,
  apps: (order: AppOrder, category?: string, limit?: number) => ['apps', order, category ?? '*', limit] as const,
  app: (id: string) => ['app', id] as const,
  versions: (id: string) => ['versions', id] as const,
  search: (q: string) => ['search', q] as const,
  developer: (login: string) => ['developer', login] as const,
  mine: (uid: string) => ['mine', uid] as const,
  stats: (uid: string) => ['stats', uid] as const,
  byIds: (ids: string[]) => ['byIds', ...ids] as const,
};

export function useCategories() {
  return useQuery({
    queryKey: keys.categories,
    queryFn: () => unwrap<Category[]>(supabase.from('categories').select('*').order('sort')),
    staleTime: 60 * 60 * 1000,
  });
}

type AppsOptions = { category?: string; limit?: number; featuredFirst?: boolean };

export function fetchApps(order: AppOrder, opts: AppsOptions = {}) {
  let q = supabase.from('apps').select(LIST_COLUMNS).eq('status', 'published');
  if (opts.featuredFirst) q = q.order('featured', { ascending: false });
  q = q.order(ORDER_COLUMN[order], { ascending: false, nullsFirst: false }).limit(opts.limit ?? 30);
  if (opts.category) q = q.eq('category', opts.category);
  return unwrap<ListApp[]>(q);
}

export function useApps(order: AppOrder, opts: AppsOptions = {}) {
  return useQuery({
    queryKey: [...keys.apps(order, opts.category, opts.limit), opts.featuredFirst ?? false],
    queryFn: () => fetchApps(order, opts),
  });
}

/** Apps the store gives priority to (apps.featured). */
export function useFeatured() {
  return useQuery({
    queryKey: ['featured'],
    queryFn: () =>
      unwrap<ListApp[]>(
        supabase
          .from('apps')
          .select(LIST_COLUMNS)
          .eq('status', 'published')
          .eq('featured', true)
          .order('latest_published_at', { ascending: false, nullsFirst: false })
          .limit(10),
      ),
  });
}

export function useApp(id: string | undefined) {
  return useQuery({
    queryKey: keys.app(id ?? ''),
    enabled: Boolean(id),
    queryFn: () => unwrap<StoreApp>(supabase.from('apps').select('*').eq('id', id!).single()),
  });
}

export function useVersions(appId: string | undefined) {
  return useQuery({
    queryKey: keys.versions(appId ?? ''),
    enabled: Boolean(appId),
    queryFn: () =>
      unwrap<AppVersion[]>(
        supabase
          .from('app_versions')
          .select('id,app_id,version,name,notes,published_at,prerelease,apk_size')
          .eq('app_id', appId!)
          .order('published_at', { ascending: false })
          .limit(30),
      ),
  });
}

export function useSearch(query: string) {
  const term = query.replace(/[,()*%\\]/g, ' ').trim();
  return useQuery({
    queryKey: keys.search(term.toLowerCase()),
    enabled: term.length >= 2,
    queryFn: () =>
      unwrap<ListApp[]>(
        supabase
          .from('apps')
          .select(LIST_COLUMNS)
          .eq('status', 'published')
          .or(
            ['name', 'subtitle', 'developer_login', 'repo_full_name', 'category']
              .map((c) => `${c}.ilike.%${term}%`)
              .join(','),
          )
          .order('featured', { ascending: false })
          .order('stars', { ascending: false })
          .limit(40),
      ),
  });
}

export function useDeveloperApps(login: string | undefined) {
  return useQuery({
    queryKey: keys.developer(login ?? ''),
    enabled: Boolean(login),
    queryFn: () =>
      unwrap<ListApp[]>(
        supabase
          .from('apps')
          .select(LIST_COLUMNS)
          .eq('status', 'published')
          .ilike('developer_login', login!)
          .order('stars', { ascending: false })
          .limit(12),
      ),
  });
}

export function fetchAppsByIds(ids: string[]) {
  if (ids.length === 0) return Promise.resolve([] as ListApp[]);
  return unwrap<ListApp[]>(supabase.from('apps').select(LIST_COLUMNS).in('id', ids));
}

export function useMyApps(uid: string | undefined) {
  return useQuery({
    queryKey: keys.mine(uid ?? ''),
    enabled: Boolean(uid),
    queryFn: () =>
      unwrap<StoreApp[]>(
        supabase.from('apps').select('*').eq('owner_id', uid!).order('created_at', { ascending: false }),
      ),
  });
}

/** Curated listings of repos under the developer's GitHub login, ready to claim. */
export function useClaimable(login: string | undefined) {
  return useQuery({
    queryKey: ['claimable', login ?? ''],
    enabled: Boolean(login),
    queryFn: () =>
      unwrap<ListApp[]>(
        supabase
          .from('apps')
          .select(LIST_COLUMNS)
          .is('owner_id', null)
          .ilike('developer_login', login!)
          .limit(20),
      ),
  });
}

export function useMyStats(uid: string | undefined, appIds: string[], days = 30) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return useQuery({
    queryKey: [...keys.stats(uid ?? ''), days, appIds.join(',')],
    enabled: Boolean(uid) && appIds.length > 0,
    queryFn: () =>
      unwrap<DownloadDay[]>(
        supabase
          .from('app_download_stats')
          .select('app_id,day,downloads,installs,updates')
          .in('app_id', appIds)
          .gte('day', since)
          .order('day'),
      ),
  });
}

export async function recordDownload(
  appId: string,
  deviceId: string,
  kind: 'download' | 'install' | 'update',
  version: string | null,
) {
  const { data, error } = await supabase.rpc('record_download', {
    p_app_id: appId,
    p_device_id: deviceId,
    p_kind: kind,
    p_version: version,
  });
  if (error) throw error;
  return data as number;
}
