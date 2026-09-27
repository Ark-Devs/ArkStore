-- search_agent_tools, fast on ~40k entries: match candidates through indexes first (full text via
-- agent_tools_search_idx, name / title substrings via the trigram indexes), then rank only those.
-- Browsing (no query) reads the newest entries of a kind straight from agent_tools_kind_idx.
create or replace function public.search_agent_tools(
  p_query text default null,
  p_kind text default null,
  p_limit integer default 20
)
returns setof public.agent_tools
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_any tsquery := arkstore_private.any_words(p_query);
  v_all tsquery := websearch_to_tsquery('english', coalesce(p_query, ''));
  v_q text := lower(btrim(coalesce(p_query, '')));
  v_like text := '%' || replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if v_any is null then
    return query
      select t.* from public.agent_tools t
       where t.status = 'published' and (p_kind is null or t.kind = p_kind)
       order by t.featured desc, (t.source <> 'registry') desc, t.updated_at desc
       limit v_limit;
    return;
  end if;

  return query
    with hits as (
      select t.id from public.agent_tools t where t.search @@ v_any
      union
      select t.id from public.agent_tools t where t.title ilike v_like or t.name ilike v_like
    )
    select t.* from public.agent_tools t
      join hits h on h.id = t.id
     where t.status = 'published' and (p_kind is null or t.kind = p_kind)
     order by t.featured desc,
              (t.search @@ v_all) desc,
              (t.source <> 'registry') desc,
              (lower(t.title) = v_q or lower(t.name) = v_q) desc,
              ts_rank(t.search, v_any) desc,
              (t.title ilike v_like) desc,
              t.updated_at desc
     limit v_limit;
end;
$$;

grant execute on function public.search_agent_tools(text, text, integer) to anon, authenticated;
