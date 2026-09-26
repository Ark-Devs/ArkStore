// Supabase Edge Function: https://<project>.supabase.co/functions/v1/mcp
// Deployed with verify_jwt off: MCP clients don't send Supabase JWTs. Anyone can read the public
// catalog; publishing checks the caller's ArkStore token in the database (public.mcp_*).
import { createClient } from 'npm:@supabase/supabase-js@2';

import { handle, type App, type PublishInput, type Store, type Tool } from './server.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  // The public (anon) key: this function only does what any ArkStore visitor can.
  Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function unwrap<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

const APP_COLUMNS =
  'id,repo_full_name,name,subtitle,description,category,platforms,stars,downloads,latest_version,latest_published_at,latest_release_notes,license,homepage,developer_login,owner_id,status,assets';

/** owner/name from "owner/name", a GitHub URL, or null when it's an id. */
function repoOf(ref: string): string | null {
  const m = ref.trim().match(/^(?:https?:\/\/github\.com\/)?([A-Za-z0-9-]+\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/);
  return m ? m[1] : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const store: Store = {
  searchApps: (query, platform, category, limit) =>
    unwrap<App[]>(
      supabase.rpc('search_apps', { p_query: query, p_platform: platform, p_category: category, p_limit: limit }).select(APP_COLUMNS),
    ),

  async getApp(ref) {
    const repo = repoOf(ref);
    let q = supabase.from('apps').select(APP_COLUMNS).eq('status', 'published');
    if (repo) q = q.ilike('repo_full_name', repo.replace(/[%_\\]/g, (c) => `\\${c}`));
    else if (UUID.test(ref.trim())) q = q.eq('id', ref.trim());
    else return null;
    return unwrap<App | null>(q.maybeSingle());
  },

  categories: () => unwrap(supabase.from('categories').select('slug,name').order('sort')),

  searchTools: (query, kind, limit) =>
    unwrap<Tool[]>(supabase.rpc('search_agent_tools', { p_query: query, p_kind: kind, p_limit: limit })),

  getTool: (key) => unwrap<Tool | null>(supabase.from('agent_tools').select('*').eq('key', key).maybeSingle()),

  whoami: (token) => unwrap(supabase.rpc('mcp_whoami', { p_token: token })),

  myApps: (token) => unwrap<App[]>(supabase.rpc('mcp_my_apps', { p_token: token }).select(APP_COLUMNS)),

  publish: (token, input: PublishInput) => unwrap<App>(supabase.rpc('mcp_publish', { p_token: token, p: input }).select(APP_COLUMNS).single()),
};

Deno.serve((req) => handle(req, store));
