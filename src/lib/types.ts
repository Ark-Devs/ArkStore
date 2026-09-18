import type { ApkAsset } from './github/apk';

export type Category = { slug: string; name: string; icon: string; sort: number };

/** Row of public.apps as the store reads it. */
export type StoreApp = {
  id: string;
  owner_id: string | null;
  source: 'developer' | 'curated';
  repo_full_name: string;
  name: string;
  subtitle: string;
  description: string;
  category: string;
  icon_url: string | null;
  screenshots: string[];
  homepage: string | null;
  developer_login: string;
  developer_avatar: string | null;
  license: string | null;
  package_name: string | null;
  min_sdk: number | null;
  stars: number;
  topics: string[];
  latest_version: string | null;
  latest_release_name: string | null;
  latest_release_notes: string | null;
  latest_published_at: string | null;
  latest_prerelease: boolean;
  apk_name: string | null;
  apk_url: string | null;
  apk_size: number | null;
  apk_assets: ApkAsset[];
  /** APK files downloaded through ArkStore. */
  downloads: number;
  /** Installs Android confirmed (first installs, not updates). */
  installs: number;
  status: 'published' | 'hidden';
  featured: boolean;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Columns needed for rows, shelves and cards (no long text). */
export const LIST_COLUMNS =
  'id,owner_id,source,repo_full_name,name,subtitle,category,icon_url,screenshots,developer_login,stars,latest_version,latest_published_at,latest_prerelease,apk_name,apk_url,apk_size,apk_assets,downloads,installs,status,featured,package_name,created_at' as const;

export type ListApp = Pick<
  StoreApp,
  | 'id'
  | 'owner_id'
  | 'source'
  | 'repo_full_name'
  | 'name'
  | 'subtitle'
  | 'category'
  | 'icon_url'
  | 'screenshots'
  | 'developer_login'
  | 'stars'
  | 'latest_version'
  | 'latest_published_at'
  | 'latest_prerelease'
  | 'apk_name'
  | 'apk_url'
  | 'apk_size'
  | 'apk_assets'
  | 'downloads'
  | 'installs'
  | 'status'
  | 'featured'
  | 'package_name'
  | 'created_at'
>;

export type AppVersion = {
  id: number;
  app_id: string;
  version: string;
  name: string | null;
  notes: string | null;
  published_at: string | null;
  prerelease: boolean;
  apk_size: number | null;
};

export type DownloadDay = { app_id: string; day: string; downloads: number; installs: number; updates: number };
