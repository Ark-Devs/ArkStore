-- Agent skills, and many more Claude Code plugins.
--
-- Skills: folders with a SKILL.md (the open Agent Skills format), which Claude Code, Codex and
-- most other agents load. arkstore_private.sync_skills() lists each source repo's files through
-- jsDelivr (no GitHub API quota), reads every SKILL.md from raw.githubusercontent.com, and lists
-- it in public.agent_tools with kind 'skill'. Installing uses the `skills` CLI
-- (npx skills add <repo> --skill <name>).
--
-- Plugins: more Claude Code marketplaces, and arkstore_private.discover_agent_sources(), which
-- finds new marketplaces and skill repos through GitHub topic search overnight.

alter table public.agent_tools drop constraint if exists agent_tools_kind_check;
alter table public.agent_tools add constraint agent_tools_kind_check check (kind in ('mcp', 'plugin', 'skill'));
alter table public.agent_tools drop constraint if exists agent_tools_source_check;
alter table public.agent_tools add constraint agent_tools_source_check check (source in ('registry', 'marketplace', 'arkstore', 'github'));
-- Skills: the folder inside the repo.
alter table public.agent_tools add column if not exists path text;

insert into arkstore_private.plugin_marketplaces (repo) values
  ('anthropics/claude-code'),
  ('anthropics/skills'),
  ('anthropics/knowledge-work-plugins'),
  ('anthropics/life-sciences'),
  ('wshobson/agents'),
  ('obra/superpowers-marketplace'),
  ('jeremylongshore/claude-code-plugins-plus-skills'),
  ('ananddtyagi/cc-marketplace'),
  ('EveryInc/every-marketplace'),
  ('Dev-GOM/claude-code-marketplace'),
  ('netresearch/claude-code-marketplace'),
  ('mhattingpete/claude-skills-marketplace'),
  ('huggingface/skills'),
  ('supabase/agent-skills'),
  ('trailofbits/skills')
on conflict do nothing;

create table if not exists arkstore_private.skill_sources (
  repo text primary key,
  ref text not null default 'main',
  stars integer,
  skills integer,
  added_at timestamptz not null default now(),
  last_scanned_at timestamptz
);

create table if not exists arkstore_private.skill_files (
  repo text not null,
  path text not null,
  ref text not null,
  fetched_at timestamptz,
  primary key (repo, path)
);

insert into arkstore_private.skill_sources (repo) values
  ('anthropics/skills'),
  ('anthropics/knowledge-work-plugins'),
  ('anthropics/life-sciences'),
  ('anthropics/claude-code'),
  ('vercel-labs/agent-skills'),
  ('openai/skills'),
  ('obra/superpowers'),
  ('huggingface/skills'),
  ('supabase/agent-skills'),
  ('trailofbits/skills'),
  ('K-Dense-AI/claude-scientific-skills'),
  ('ComposioHQ/awesome-claude-skills'),
  ('wshobson/agents'),
  ('mhattingpete/claude-skills-marketplace'),
  ('jeremylongshore/claude-code-plugins-plus-skills')
on conflict do nothing;

alter table arkstore_private.agent_sync_state add column if not exists sources_run bigint not null default 0;

-- One field from a SKILL.md's YAML front matter (plain, quoted, or a folded / literal block).
create or replace function arkstore_private.frontmatter_field(p_md text, p_field text)
returns text
language plpgsql
immutable
set search_path to ''
as $$
declare
  v_body text := replace(coalesce(p_md, ''), E'\r', '');
  v_fm text;
  v_end integer;
  m text[];
  v text;
begin
  if v_body !~ '^\s*---[ \t]*\n' then
    return null;
  end if;
  v_body := regexp_replace(v_body, '^\s*---[ \t]*\n', '');
  v_end := position(E'\n---' in E'\n' || v_body);
  if v_end = 0 then
    return null;
  end if;
  v_fm := E'\n' || left(v_body, greatest(v_end - 2, 0));
  m := regexp_match(v_fm, E'\\n' || p_field || E':[ \\t]*([^\\n]*)((\\n[ \\t]+[^\\n]*)*)');
  if m is null then
    return null;
  end if;
  v := btrim(m[1]);
  if v in ('', '>', '|', '>-', '|-', '>+', '|+') then
    v := btrim(regexp_replace(coalesce(m[2], ''), '\s+', ' ', 'g'));
  end if;
  if (v like '"%"' or v like '''%''') and length(v) >= 2 then
    v := substr(v, 2, length(v) - 2);
  end if;
  return nullif(btrim(v), '');
end;
$$;

-- List a few source repos' SKILL.md files, then read up to p_files of them into the catalog.
create or replace function arkstore_private.sync_skills(p_repos integer default 3, p_files integer default 150)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  src record;
  f record;
  v_resp extensions.http_response;
  v_json jsonb;
  v_ref text;
  v_md text;
  v_name text;
  v_desc text;
  v_dir text;
  v_n integer := 0;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '30');

  for src in
    select * from arkstore_private.skill_sources
     where last_scanned_at is null or last_scanned_at < now() - interval '3 days'
     order by last_scanned_at nulls first
     limit p_repos
  loop
    v_json := null;
    foreach v_ref in array array[src.ref, case when src.ref = 'main' then 'master' end] loop
      continue when v_ref is null;
      begin
        v_resp := extensions.http_get('https://data.jsdelivr.com/v1/packages/gh/' || src.repo || '@' || v_ref || '?structure=flat');
        v_json := case when v_resp.status = 200 then v_resp.content::jsonb end;
      exception when others then
        v_json := null;
      end;
      exit when v_json is not null;
    end loop;

    if v_json is not null then
      insert into arkstore_private.skill_files (repo, path, ref)
      select src.repo, ltrim(e ->> 'name', '/'), v_ref
        from jsonb_array_elements(coalesce(v_json -> 'files', '[]')) e
       where e ->> 'name' ~ '(^|/)SKILL\.md$'
         and e ->> 'name' !~* '(/|^)(templates?|examples?|tests?|fixtures?)/'
       limit 400
      on conflict (repo, path) do update set ref = excluded.ref;
      update arkstore_private.skill_sources set
        ref = v_ref,
        skills = (select count(*) from arkstore_private.skill_files s where s.repo = src.repo)
       where repo = src.repo;
    end if;
    update arkstore_private.skill_sources set last_scanned_at = now() where repo = src.repo;
  end loop;

  for f in
    select * from arkstore_private.skill_files
     where fetched_at is null or fetched_at < now() - interval '7 days'
     order by fetched_at nulls first
     limit p_files
  loop
    v_md := null;
    begin
      v_resp := extensions.http_get('https://raw.githubusercontent.com/' || f.repo || '/' || f.ref || '/' || f.path);
      if v_resp.status = 200 then
        v_md := v_resp.content;
      end if;
    exception when others then
      v_md := null;
    end;
    update arkstore_private.skill_files set fetched_at = now() where repo = f.repo and path = f.path;
    continue when v_md is null;

    v_dir := regexp_replace(f.path, '/?SKILL\.md$', '');
    v_name := left(coalesce(arkstore_private.frontmatter_field(v_md, 'name'), nullif(regexp_replace(v_dir, '^.*/', ''), ''), split_part(f.repo, '/', 2)), 80);
    v_desc := arkstore_private.frontmatter_field(v_md, 'description');
    continue when v_desc is null;

    insert into public.agent_tools as t (
      key, kind, source, name, title, description, publisher, icon_url, repo_url, marketplace_repo, path,
      featured, seen_at, updated_at
    ) values (
      'skill:' || f.repo || '/' || coalesce(nullif(v_dir, ''), v_name), 'skill', 'github', v_name,
      left(initcap(replace(replace(v_name, '-', ' '), '_', ' ')), 80),
      left(v_desc, 2000),
      split_part(f.repo, '/', 1),
      'https://github.com/' || split_part(f.repo, '/', 1) || '.png',
      'https://github.com/' || f.repo || '/tree/' || f.ref || coalesce('/' || nullif(v_dir, ''), ''),
      f.repo, nullif(v_dir, ''),
      false, now(), now()
    )
    on conflict (key) do update set
      name = excluded.name, title = excluded.title, description = excluded.description,
      repo_url = excluded.repo_url, path = excluded.path, status = 'published', seen_at = now(),
      updated_at = case when t.description is distinct from excluded.description then now() else t.updated_at end;
    v_n := v_n + 1;
  end loop;

  -- Skills whose SKILL.md is gone (not seen for two weeks of reads).
  update public.agent_tools set status = 'hidden'
   where kind = 'skill' and status = 'published' and seen_at < now() - interval '14 days';
  return v_n;
end;
$$;

-- New plugin marketplaces and skill repos from GitHub topic search (search quota only; raw
-- files for the marketplace check).
create or replace function arkstore_private.discover_agent_sources(p_searches integer default 2)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_queries text[] := array[
    'topic:claude-code-plugin stars:>=5',
    'topic:agent-skills stars:>=10',
    'topic:claude-code-marketplace',
    'topic:claude-skills stars:>=10',
    'topic:claude-code-plugins stars:>=5',
    'topic:claude-code-skills stars:>=5',
    'topic:claude-plugins stars:>=5',
    'topic:codex-skills stars:>=5',
    'topic:skills-sh stars:>=5',
    'topic:anthropic-skills stars:>=5'
  ];
  v_state record;
  v_q text;
  r record;
  item jsonb;
  v_resp extensions.http_response;
  v_market jsonb;
  v_n integer := 0;
  i integer;
begin
  select * into v_state from arkstore_private.agent_sync_state for update;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '20');

  for i in 0 .. p_searches - 1 loop
    v_q := v_queries[1 + ((v_state.sources_run * p_searches + i) % array_length(v_queries, 1))] || ' archived:false fork:false';
    select * into r from arkstore_private.gh_get(
      '/search/repositories?q=' || replace(extensions.urlencode(v_q), '+', '%20') || '&sort=stars&order=desc&per_page=40'
    );
    exit when r.status in (401, 403, 429);
    continue when r.status <> 200 or r.body is null;

    for item in select * from jsonb_array_elements(r.body -> 'items') loop
      continue when coalesce((item ->> 'fork')::boolean, false) or coalesce((item ->> 'archived')::boolean, false);
      insert into arkstore_private.skill_sources (repo, ref, stars)
      values (item ->> 'full_name', coalesce(item ->> 'default_branch', 'main'), (item ->> 'stargazers_count')::integer)
      on conflict (repo) do update set stars = excluded.stars;

      continue when exists (select 1 from arkstore_private.plugin_marketplaces m where lower(m.repo) = lower(item ->> 'full_name'));
      begin
        v_resp := extensions.http_get(
          'https://raw.githubusercontent.com/' || (item ->> 'full_name') || '/' || coalesce(item ->> 'default_branch', 'main') || '/.claude-plugin/marketplace.json'
        );
        v_market := case when v_resp.status = 200 then v_resp.content::jsonb end;
      exception when others then
        v_market := null;
      end;
      if v_market ? 'name' and jsonb_typeof(v_market -> 'plugins') = 'array' and jsonb_array_length(v_market -> 'plugins') > 0 then
        insert into arkstore_private.plugin_marketplaces (repo, ref)
        values (item ->> 'full_name', coalesce(item ->> 'default_branch', 'main'))
        on conflict do nothing;
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;

  update arkstore_private.agent_sync_state set sources_run = sources_run + 1;
  return v_n;
end;
$$;

-- How many of each kind the catalog lists (for the Agents tab).
create or replace function public.agent_tool_counts()
returns table (kind text, total bigint)
language sql
stable
security definer
set search_path to ''
as $$
  select t.kind, count(*) from public.agent_tools t where t.status = 'published' group by t.kind;
$$;

revoke all on function arkstore_private.sync_skills(integer, integer) from public, anon, authenticated;
revoke all on function arkstore_private.discover_agent_sources(integer) from public, anon, authenticated;
grant execute on function public.agent_tool_counts() to anon, authenticated;
