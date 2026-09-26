// ArkStore for AI agents: the catalog of MCP servers and Claude Code plugins (public.agent_tools,
// filled overnight from the MCP registry and plugin marketplaces), ArkStore's own MCP server
// (supabase/functions/mcp), and the personal tokens that let an agent publish for you.
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { AgentToolLike } from './agent-install';
import { supabase } from './supabase';

export type AgentTool = AgentToolLike & {
  id: string;
  key: string;
  source: 'registry' | 'marketplace' | 'arkstore';
  description: string;
  publisher: string | null;
  category: string | null;
  icon_url: string | null;
  repo_url: string | null;
  homepage: string | null;
  version: string | null;
  featured: boolean;
  updated_at: string;
};

export type AgentKind = 'mcp' | 'plugin';

export type ApiToken = { id: string; name: string; prefix: string; created_at: string; last_used_at: string | null };

/** ArkStore's MCP server. */
export const ARKSTORE_MCP_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://not-configured.supabase.co'}/functions/v1/mcp`;

/** The Claude Code plugin marketplace in this repo (.claude-plugin/marketplace.json). */
export const ARKSTORE_MARKETPLACE_REPO = 'Ark-Devs/ArkStore';

async function unwrap<T>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

export function useAgentTools(query: string, kind: AgentKind | null, limit = 40) {
  const q = query.trim();
  return useQuery({
    queryKey: ['agent-tools', q.toLowerCase(), kind, limit],
    queryFn: () =>
      unwrap<AgentTool[]>(supabase.rpc('search_agent_tools', { p_query: q || null, p_kind: kind, p_limit: limit })),
    staleTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

export function useAgentTool(id: string | undefined) {
  return useQuery({
    queryKey: ['agent-tool', id ?? ''],
    enabled: Boolean(id),
    queryFn: () => unwrap<AgentTool>(supabase.from('agent_tools').select('*').eq('id', id!).single()),
  });
}

export function useApiTokens(uid: string | undefined) {
  return useQuery({
    queryKey: ['api-tokens', uid ?? ''],
    enabled: Boolean(uid),
    queryFn: () =>
      unwrap<ApiToken[]>(
        supabase.from('api_tokens').select('id,name,prefix,created_at,last_used_at').order('created_at', { ascending: false }),
      ),
  });
}

export function useTokenActions(uid: string | undefined) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ['api-tokens', uid ?? ''] });
  return {
    /** The token is shown once: only its hash is stored. */
    async create(name: string): Promise<string> {
      const rows = await unwrap<{ id: string; token: string }[]>(supabase.rpc('create_api_token', { p_name: name }));
      await refresh();
      return rows[0].token;
    },
    async revoke(id: string) {
      await unwrap(supabase.from('api_tokens').delete().eq('id', id));
      await refresh();
    },
  };
}
