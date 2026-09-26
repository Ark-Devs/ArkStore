-- ArkStore for AI agents.
--
-- 1. agent_tools: MCP servers and agent plugins people can install into Claude Code, Codex,
--    Claude Desktop and other MCP clients. Filled from the official MCP registry
--    (registry.modelcontextprotocol.io) and from Claude Code plugin marketplaces
--    (arkstore_private.plugin_marketplaces), overnight with app discovery.
-- 2. api_tokens: personal tokens a developer creates in ArkStore and gives their agent, so the
--    agent can publish apps for them through ArkStore's MCP server (supabase/functions/mcp).
-- 3. search_apps / search_agent_tools: the searches the MCP server (and anyone) can run.
-- 4. mcp_*: what the MCP server calls with a token. Publishing goes through the same checks as
--    publishing in Studio (arkstore_private.publish_app_for is public.publish_app for a given user).

-- ---------------------------------------------------------------------------
-- Agent tools catalog
-- ---------------------------------------------------------------------------

create table if not exists public.agent_tools (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  kind text not null check (kind in ('mcp', 'plugin')),
  source text not null check (source in ('registry', 'marketplace', 'arkstore')),
  -- The name to install it under (claude mcp add <name>, /plugin install <name>@<marketplace>).
  name text not null,
  title text not null,
  description text not null default '',
  publisher text,
  category text,
  icon_url text,
  repo_url text,
  homepage text,
  version text,
  -- MCP registry package and remote entries, as the registry gives them.
  packages jsonb not null default '[]',
  remotes jsonb not null default '[]',
  -- Plugins: the marketplace's name and the repo to add it from (owner/repo).
  marketplace text,
  marketplace_repo text,
  featured boolean not null default false,
  status text not null default 'published' check (status in ('published', 'hidden')),
  search tsvector generated always as (
    to_tsvector('english', title || ' ' || name || ' ' || description || ' ' || coalesce(publisher, '') || ' ' || coalesce(category, ''))
  ) stored,
  seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_tools_search_idx on public.agent_tools using gin (search);
create index if not exists agent_tools_kind_idx on public.agent_tools (kind, featured desc, updated_at desc) where status = 'published';

alter table public.agent_tools enable row level security;
drop policy if exists "agent tools are public" on public.agent_tools;
create policy "agent tools are public" on public.agent_tools for select using (status = 'published');

create table if not exists arkstore_private.agent_sync_state (
  id boolean primary key default true check (id),
  registry_cursor text,
  -- Incremental passes: only servers updated since the start of the last complete pass.
  registry_since timestamptz,
  registry_pass_started timestamptz,
  registry_synced_at timestamptz,
  marketplaces_synced_at timestamptz
);
insert into arkstore_private.agent_sync_state (id) values (true) on conflict do nothing;

-- Claude Code plugin marketplaces ArkStore lists plugins from (a repo with .claude-plugin/marketplace.json).
create table if not exists arkstore_private.plugin_marketplaces (
  repo text primary key,
  ref text not null default 'main'
);
insert into arkstore_private.plugin_marketplaces (repo) values
  ('anthropics/claude-plugins-official'),
  ('Ark-Devs/ArkStore')
on conflict do nothing;

-- Pages of the MCP registry, continuing where the last call stopped. After the first full pass,
-- each pass only asks for servers updated since the previous pass began.
create or replace function arkstore_private.sync_mcp_registry(p_pages integer default 3)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_state record;
  v_cursor text;
  v_started timestamptz;
  v_resp extensions.http_response;
  v_json jsonb;
  s jsonb;
  v_srv jsonb;
  v_full text;
  v_ns text;
  v_name text;
  v_repo text;
  v_icon text;
  v_n integer := 0;
  i integer;
begin
  select * into v_state from arkstore_private.agent_sync_state for update;
  v_cursor := v_state.registry_cursor;
  v_started := case when v_cursor is null then now() else coalesce(v_state.registry_pass_started, now()) end;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '30');
  for i in 1 .. p_pages loop
    -- A slow or failed page ends this run; the next run carries on from the same cursor.
    begin
      v_resp := extensions.http_get(
        'https://registry.modelcontextprotocol.io/v0/servers?limit=100&version=latest' ||
        coalesce('&updated_since=' || to_char(v_state.registry_since at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '') ||
        coalesce('&cursor=' || extensions.urlencode(v_cursor), '')
      );
      v_json := case when v_resp.status = 200 then v_resp.content::jsonb end;
    exception when others then
      v_json := null;
    end;
    exit when v_json is null;

    for s in select * from jsonb_array_elements(coalesce(v_json -> 'servers', '[]')) loop
      v_srv := s -> 'server';
      v_full := v_srv ->> 'name';
      continue when v_full is null;
      -- Deprecated or deleted in the registry: stop listing it.
      if coalesce(s -> '_meta' -> 'io.modelcontextprotocol.registry/official' ->> 'status', 'active') <> 'active' then
        update public.agent_tools set status = 'hidden' where key = 'mcp:' || v_full and source = 'registry';
        continue;
      end if;
      continue when jsonb_array_length(coalesce(v_srv -> 'packages', '[]')) = 0
                and jsonb_array_length(coalesce(v_srv -> 'remotes', '[]')) = 0;
      v_ns := split_part(v_full, '/', 1);
      v_name := lower(regexp_replace(regexp_replace(v_full, '^.*/', ''), '[^A-Za-z0-9_-]+', '-', 'g'));
      continue when v_name = '';
      v_repo := nullif(v_srv -> 'repository' ->> 'url', '');
      v_icon := (select e ->> 'src' from jsonb_array_elements(coalesce(v_srv -> 'icons', '[]')) e
                 where e ->> 'src' like 'https://%' limit 1);
      if v_icon is null and v_repo ~ '^https://github\.com/[^/]+' then
        v_icon := 'https://github.com/' || split_part(substr(v_repo, 20), '/', 1) || '.png';
      end if;

      insert into public.agent_tools as t (
        key, kind, source, name, title, description, publisher, icon_url, repo_url, homepage, version,
        packages, remotes, seen_at, updated_at
      ) values (
        'mcp:' || v_full, 'mcp', 'registry', v_name,
        left(coalesce(nullif(v_srv ->> 'title', ''), v_name), 80),
        left(coalesce(v_srv ->> 'description', ''), 2000),
        case when v_ns like 'io.github.%' then substr(v_ns, 11) else v_ns end,
        v_icon, v_repo, nullif(v_srv ->> 'websiteUrl', ''), v_srv ->> 'version',
        coalesce(v_srv -> 'packages', '[]'), coalesce(v_srv -> 'remotes', '[]'), now(), now()
      )
      on conflict (key) do update set
        name = excluded.name, title = excluded.title, description = excluded.description,
        publisher = excluded.publisher, icon_url = excluded.icon_url, repo_url = excluded.repo_url,
        homepage = excluded.homepage, version = excluded.version, packages = excluded.packages,
        remotes = excluded.remotes, status = 'published', seen_at = now(),
        updated_at = case when t.version is distinct from excluded.version then now() else t.updated_at end
      where t.source = 'registry';
      v_n := v_n + 1;
    end loop;

    v_cursor := v_json -> 'metadata' ->> 'nextCursor';
    exit when v_cursor is null;
  end loop;

  update arkstore_private.agent_sync_state set
    registry_cursor = v_cursor,
    registry_pass_started = case when v_cursor is null then null else v_started end,
    registry_since = case when v_cursor is null and v_json is not null then v_started else registry_since end,
    registry_synced_at = now();
  return v_n;
end;
$$;

-- Every plugin in every listed Claude Code marketplace.
create or replace function arkstore_private.sync_plugin_marketplaces()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  m record;
  v_resp extensions.http_response;
  v_json jsonb;
  p jsonb;
  v_market text;
  v_src jsonb;
  v_repo_url text;
  v_n integer := 0;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '30');
  for m in select * from arkstore_private.plugin_marketplaces loop
    begin
      v_resp := extensions.http_get(
        'https://raw.githubusercontent.com/' || m.repo || '/' || m.ref || '/.claude-plugin/marketplace.json'
      );
      v_json := case when v_resp.status = 200 then v_resp.content::jsonb end;
    exception when others then
      v_json := null;
    end;
    continue when v_json is null;
    v_market := v_json ->> 'name';
    continue when v_market is null;

    for p in select * from jsonb_array_elements(coalesce(v_json -> 'plugins', '[]')) loop
      continue when p ->> 'name' is null;
      v_src := p -> 'source';
      v_repo_url := case
        when jsonb_typeof(v_src) = 'string' then
          'https://github.com/' || m.repo || '/tree/' || m.ref || '/' || regexp_replace(v_src #>> '{}', '^\./', '')
        when v_src ->> 'repo' is not null then 'https://github.com/' || (v_src ->> 'repo')
        when v_src ->> 'url' is not null then regexp_replace(v_src ->> 'url', '\.git$', '')
        else 'https://github.com/' || m.repo
      end;

      insert into public.agent_tools as t (
        key, kind, source, name, title, description, publisher, category, icon_url, repo_url, homepage,
        version, marketplace, marketplace_repo, featured, seen_at, updated_at
      ) values (
        'plugin:' || v_market || '/' || (p ->> 'name'), 'plugin',
        case when m.repo = 'Ark-Devs/ArkStore' then 'arkstore' else 'marketplace' end,
        p ->> 'name',
        left(initcap(replace(replace(p ->> 'name', '-', ' '), '_', ' ')), 80),
        left(coalesce(p ->> 'description', ''), 2000),
        coalesce(p -> 'author' ->> 'name', v_json -> 'owner' ->> 'name'),
        p ->> 'category',
        case when v_repo_url ~ '^https://github\.com/[^/]+' then 'https://github.com/' || split_part(substr(v_repo_url, 20), '/', 1) || '.png' end,
        v_repo_url,
        nullif(p ->> 'homepage', ''),
        p ->> 'version',
        v_market, m.repo,
        m.repo = 'Ark-Devs/ArkStore',
        now(), now()
      )
      on conflict (key) do update set
        title = excluded.title, description = excluded.description, publisher = excluded.publisher,
        category = excluded.category, icon_url = excluded.icon_url, repo_url = excluded.repo_url,
        homepage = excluded.homepage, version = excluded.version, marketplace_repo = excluded.marketplace_repo,
        featured = excluded.featured or t.featured, seen_at = now(),
        updated_at = case when t.version is distinct from excluded.version then now() else t.updated_at end;
      v_n := v_n + 1;
    end loop;
  end loop;

  -- Plugins a marketplace dropped (not seen for 3 days of successful reads).
  if v_n > 0 then
    update public.agent_tools set status = 'hidden'
     where kind = 'plugin' and status = 'published' and seen_at < now() - interval '3 days';
  end if;
  update arkstore_private.agent_sync_state set marketplaces_synced_at = now();
  return v_n;
end;
$$;

create or replace function arkstore_private.sync_agent_tools()
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  perform arkstore_private.sync_mcp_registry(10);
  if (select coalesce(marketplaces_synced_at, 'epoch') < now() - interval '6 hours' from arkstore_private.agent_sync_state) then
    perform arkstore_private.sync_plugin_marketplaces();
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Searches
-- ---------------------------------------------------------------------------

-- Any of the words (ranked by how many match), so "pdf editor for linux" still finds PDF apps.
create or replace function arkstore_private.any_words(p_query text)
returns tsquery
language sql
immutable
set search_path to ''
as $$
  select nullif(replace(websearch_to_tsquery('english', coalesce(p_query, ''))::text, ' & ', ' | '), '')::tsquery;
$$;

create or replace function arkstore_private.app_doc(p_name text, p_subtitle text, p_description text, p_topics text[], p_repo text)
returns tsvector
language sql
immutable
set search_path to ''
as $$
  select to_tsvector('english',
    coalesce(p_name, '') || ' ' || coalesce(p_subtitle, '') || ' ' || coalesce(p_description, '') || ' ' ||
    array_to_string(coalesce(p_topics, '{}'), ' ') || ' ' || translate(coalesce(p_repo, ''), '/-_', '   '));
$$;

create or replace function public.search_apps(
  p_query text default null,
  p_platform text default null,
  p_category text default null,
  p_limit integer default 20
)
returns setof public.apps
language sql
stable
security definer
set search_path to ''
as $$
  select a.*
  from public.apps a,
       (select arkstore_private.any_words(p_query) as tq, '%' || btrim(coalesce(p_query, '')) || '%' as like_q) q
  where a.status = 'published'
    and (p_platform is null or a.platforms @> array[p_platform])
    and (p_category is null or a.category = p_category)
    and (q.tq is null
         or arkstore_private.app_doc(a.name, a.subtitle, a.description, a.topics, a.repo_full_name) @@ q.tq
         or a.name ilike q.like_q or a.repo_full_name ilike q.like_q)
  order by (q.tq is not null and arkstore_private.app_doc(a.name, a.subtitle, a.description, a.topics, a.repo_full_name)
             @@ websearch_to_tsquery('english', p_query)) desc,
           case when q.tq is null then 0
                else ts_rank(arkstore_private.app_doc(a.name, a.subtitle, a.description, a.topics, a.repo_full_name), q.tq) end desc,
           (a.name ilike q.like_q) desc,
           a.stars desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

create or replace function public.search_agent_tools(
  p_query text default null,
  p_kind text default null,
  p_limit integer default 20
)
returns setof public.agent_tools
language sql
stable
security definer
set search_path to ''
as $$
  select t.*
  from public.agent_tools t, (select arkstore_private.any_words(p_query) as tq, '%' || btrim(coalesce(p_query, '')) || '%' as like_q) q
  where t.status = 'published'
    and (p_kind is null or t.kind = p_kind)
    and (q.tq is null or t.search @@ q.tq or t.name ilike q.like_q or t.title ilike q.like_q)
  order by t.featured desc,
           (q.tq is not null and t.search @@ websearch_to_tsquery('english', p_query)) desc,
           -- Plugins from curated marketplaces before the open MCP registry.
           (t.source <> 'registry') desc,
           (lower(t.title) = lower(btrim(coalesce(p_query, ''))) or lower(t.name) = lower(btrim(coalesce(p_query, '')))) desc,
           case when q.tq is null then 0 else ts_rank(t.search, q.tq) end desc,
           (t.title ilike q.like_q) desc,
           t.updated_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

-- ---------------------------------------------------------------------------
-- Personal API tokens (for agents)
-- ---------------------------------------------------------------------------

create table if not exists public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  -- First characters, to tell tokens apart; the token itself is only stored hashed.
  prefix text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists api_tokens_user_idx on public.api_tokens (user_id);

alter table public.api_tokens enable row level security;
drop policy if exists "see your tokens" on public.api_tokens;
create policy "see your tokens" on public.api_tokens for select using (user_id = auth.uid());
drop policy if exists "revoke your tokens" on public.api_tokens;
create policy "revoke your tokens" on public.api_tokens for delete using (user_id = auth.uid());

create or replace function arkstore_private.hash_token(p_token text)
returns text
language sql
immutable
set search_path to ''
as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

-- Returns the new token once; only its hash is kept.
create or replace function public.create_api_token(p_name text)
returns table (id uuid, token text)
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
  v_token text;
begin
  if v_uid is null then
    raise exception 'sign_in_required';
  end if;
  if (select count(*) from public.api_tokens t where t.user_id = v_uid) >= 10 then
    raise exception 'too_many_tokens';
  end if;
  v_token := 'ark_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.api_tokens (user_id, name, prefix, token_hash)
  values (v_uid, left(coalesce(nullif(btrim(p_name), ''), 'AI agent'), 40), left(v_token, 10), arkstore_private.hash_token(v_token))
  returning api_tokens.id into id;
  token := v_token;
  return next;
end;
$$;

create or replace function arkstore_private.token_user(p_token text)
returns uuid
language sql
volatile
security definer
set search_path to ''
as $$
  update public.api_tokens set last_used_at = now()
   where p_token like 'ark\_%' and token_hash = arkstore_private.hash_token(p_token)
  returning user_id;
$$;

-- ---------------------------------------------------------------------------
-- Publishing for a given user (public.publish_app with the user passed in)
-- ---------------------------------------------------------------------------

do $$
declare
  d text := pg_get_functiondef('public.publish_app(jsonb,text)'::regprocedure);
begin
  d := replace(d, 'FUNCTION public.publish_app(p jsonb, p_github_token text DEFAULT NULL::text)',
                  'FUNCTION arkstore_private.publish_app_for(p_uid uuid, p jsonb, p_github_token text DEFAULT NULL::text)');
  d := replace(d, 'v_uid uuid := auth.uid();', 'v_uid uuid := p_uid;');
  if position('arkstore_private.publish_app_for' in d) = 0 or position('v_uid uuid := p_uid;' in d) = 0 then
    raise exception 'publish_app changed shape; update this migration';
  end if;
  execute d;
end;
$$;

-- ---------------------------------------------------------------------------
-- What the MCP server calls with a token
-- ---------------------------------------------------------------------------

create or replace function public.mcp_whoami(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_uid uuid := arkstore_private.token_user(p_token);
  v_ident record;
begin
  if v_uid is null then
    raise exception 'invalid_token';
  end if;
  select * into v_ident from arkstore_private.github_identity(v_uid);
  return jsonb_build_object('github_login', v_ident.login);
end;
$$;

create or replace function public.mcp_my_apps(p_token text)
returns setof public.apps
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_uid uuid := arkstore_private.token_user(p_token);
begin
  if v_uid is null then
    raise exception 'invalid_token';
  end if;
  return query select * from public.apps a where a.owner_id = v_uid order by a.created_at desc;
end;
$$;

-- Publish (or update, or claim) a listing. Name, subtitle, description and category default to
-- the repo's own name, description and a category guessed from it.
create or replace function public.mcp_publish(p_token text, p jsonb)
returns public.apps
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_uid uuid := arkstore_private.token_user(p_token);
  v_repo text := arkstore_private.normalize_repo(p ->> 'repo');
  v_meta record;
  v_given jsonb;
  v_defaults jsonb := '{}';
begin
  if v_uid is null then
    raise exception 'invalid_token';
  end if;
  if v_repo is null then
    raise exception 'invalid_repo';
  end if;
  -- Only non-empty values the agent gave override the defaults.
  select coalesce(jsonb_object_agg(k, v), '{}') into v_given
    from jsonb_each(p) as e(k, v)
   where jsonb_typeof(v) <> 'null' and coalesce(btrim(v #>> '{}'), '') <> '';

  if not (v_given ? 'name' and v_given ? 'category' and v_given ? 'subtitle') then
    select * into v_meta from arkstore_private.gh_get('/repos/' || v_repo);
    if v_meta.status = 200 and v_meta.body is not null then
      v_defaults := jsonb_build_object(
        'name', left(v_meta.body ->> 'name', 40),
        'subtitle', left(coalesce(v_meta.body ->> 'description', ''), 80),
        'description', left(coalesce(v_meta.body ->> 'description', ''), 4000),
        'category', arkstore_private.guess_category(
          coalesce(v_meta.body ->> 'full_name', '') || ' ' || coalesce(v_meta.body ->> 'description', '') || ' ' ||
          coalesce((select string_agg(t, ' ') from jsonb_array_elements_text(v_meta.body -> 'topics') t), ''))
      );
    end if;
  end if;

  return arkstore_private.publish_app_for(v_uid, v_defaults || v_given || jsonb_build_object('repo', v_repo), null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

revoke all on function arkstore_private.sync_mcp_registry(integer) from public, anon, authenticated;
revoke all on function arkstore_private.sync_plugin_marketplaces() from public, anon, authenticated;
revoke all on function arkstore_private.sync_agent_tools() from public, anon, authenticated;
revoke all on function arkstore_private.token_user(text) from public, anon, authenticated;
revoke all on function arkstore_private.publish_app_for(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.create_api_token(text) from public, anon;
grant execute on function public.create_api_token(text) to authenticated;
grant execute on function public.search_apps(text, text, text, integer) to anon, authenticated;
grant execute on function public.search_agent_tools(text, text, integer) to anon, authenticated;
grant execute on function public.mcp_whoami(text) to anon, authenticated;
grant execute on function public.mcp_my_apps(text) to anon, authenticated;
grant execute on function public.mcp_publish(text, jsonb) to anon, authenticated;
grant select on public.agent_tools to anon, authenticated;
grant select, delete on public.api_tokens to authenticated;

-- ArkStore's own MCP server (supabase/functions/mcp), first in the catalog.
insert into public.agent_tools (key, kind, source, name, title, description, publisher, icon_url, repo_url, homepage, version, remotes, featured)
values (
  'mcp:arkstore', 'mcp', 'arkstore', 'arkstore', 'ArkStore',
  'Search ArkStore''s apps for Android, Windows, macOS and Linux, check whether an app already exists before you build it, find MCP servers and Claude Code plugins with install commands, and publish your own app from its GitHub repo.',
  'Ark-Devs', 'https://github.com/Ark-Devs.png', 'https://github.com/Ark-Devs/ArkStore', 'https://ark-devs.github.io/ArkStore/download/', '1.0.0',
  '[{"type": "streamable-http", "url": "https://wblaxicltignfcxxskjp.supabase.co/functions/v1/mcp", "headers": [{"name": "Authorization", "description": "Bearer <your ArkStore token>, only to publish apps (ArkStore → Account → Connect an AI agent)", "isSecret": true, "isRequired": false}]}]',
  true
)
on conflict (key) do update set
  description = excluded.description, remotes = excluded.remotes, version = excluded.version, featured = true, status = 'published';
