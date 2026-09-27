-- Trigram indexes so name / title substring matches in public.search_agent_tools use an index
-- instead of scanning every MCP registry entry. (Kept apart: the test database has no pg_trgm.)
create extension if not exists pg_trgm with schema extensions;
create index if not exists agent_tools_title_trgm on public.agent_tools using gin (title extensions.gin_trgm_ops);
create index if not exists agent_tools_name_trgm on public.agent_tools using gin (name extensions.gin_trgm_ops);
