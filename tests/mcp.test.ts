// ArkStore's MCP server (supabase/functions/mcp) over a fake database.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { handle, type App, type Store, type Tool } from '../supabase/functions/mcp/server';
import { installGuides } from '../supabase/functions/mcp/agent-install';

const notes: App = {
  id: '11111111-1111-4111-8111-111111111111',
  repo_full_name: 'alice/notes',
  name: 'Notes',
  subtitle: 'Plain text notes',
  description: 'Write things down.',
  category: 'productivity',
  platforms: ['android', 'linux'],
  stars: 1234,
  downloads: 10,
  latest_version: 'v1.4.0',
  developer_login: 'alice',
  owner_id: null,
  assets: [{ name: 'notes.apk', url: 'https://github.com/alice/notes/releases/download/v1.4.0/notes.apk', size: 5, os: 'android', arch: null }],
};

const pg: Tool = {
  key: 'mcp:io.github.acme/pg',
  kind: 'mcp',
  name: 'pg',
  title: 'Postgres',
  description: 'Query PostgreSQL',
  publisher: 'acme',
  repo_url: 'https://github.com/acme/pg',
  homepage: null,
  version: '1.2.0',
  category: null,
  packages: [
    {
      registryType: 'npm',
      identifier: '@acme/pg-mcp',
      version: '1.2.0',
      transport: { type: 'stdio' },
      environmentVariables: [
        { name: 'DATABASE_URL', isRequired: true, isSecret: true },
        { name: 'LOG_LEVEL', description: 'debug or info' },
      ],
    },
  ],
  remotes: [],
};

const hosted: Tool = {
  ...pg,
  key: 'mcp:com.example/search',
  name: 'search',
  title: 'Search',
  packages: [],
  remotes: [{ type: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: [{ name: 'Authorization', isRequired: true, value: 'Bearer {token}' }] }],
};

const plugin: Tool = {
  ...pg,
  key: 'plugin:claude-plugins-official/code-review',
  kind: 'plugin',
  name: 'code-review',
  title: 'Code Review',
  packages: [],
  marketplace: 'claude-plugins-official',
  marketplace_repo: 'anthropics/claude-plugins-official',
};

const TOKEN = `ark_${'a'.repeat(64)}`;
const published: { token: string; input: unknown }[] = [];

const store: Store = {
  searchApps: async (q) => (q && /note/i.test(q) ? [notes] : []),
  getApp: async (ref) => (ref.toLowerCase().includes('alice/notes') || ref === notes.id ? notes : null),
  categories: async () => [{ slug: 'productivity', name: 'Productivity' }],
  searchTools: async () => [pg, plugin],
  getTool: async (key) => [pg, hosted, plugin].find((t) => t.key === key) ?? null,
  whoami: async (token) => {
    if (token !== TOKEN) throw new Error('invalid_token');
    return { github_login: 'alice' };
  },
  myApps: async () => [notes],
  publish: async (token, input) => {
    if (token !== TOKEN) throw new Error('invalid_token');
    if (input.repo === 'bob/app') throw new Error('not_repo_owner');
    published.push({ token, input });
    return { ...notes, owner_id: 'alice-uuid' };
  },
};

async function rpc(body: unknown, headers: Record<string, string> = {}) {
  const res = await handle(
    new Request('https://example.supabase.co/functions/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify(body),
    }),
    store,
  );
  return { status: res.status, body: res.status === 202 ? null : ((await res.json()) as any) };
}

const call = async (name: string, args: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  (await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, headers)).body.result;

describe('ArkStore MCP server', () => {
  test('initialize negotiates the protocol and describes ArkStore', async () => {
    const { body } = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    assert.equal(body.result.protocolVersion, '2025-06-18');
    assert.equal(body.result.serverInfo.name, 'arkstore');
    assert.ok(body.result.capabilities.tools);
    assert.match(body.result.instructions, /search_apps/);

    const unknown = await rpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    assert.equal(unknown.body.result.protocolVersion, '2025-11-25', 'falls back to the newest it speaks');
  });

  test('notifications get 202 and no body; unknown methods an error', async () => {
    assert.equal((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
    const { body } = await rpc({ jsonrpc: '2.0', id: 3, method: 'nope' });
    assert.equal(body.error.code, -32601);
  });

  test('tools/list has every tool with a JSON schema', async () => {
    const { body } = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const names = body.result.tools.map((t: any) => t.name);
    assert.deepEqual(names, ['search_apps', 'get_app', 'list_categories', 'search_agent_tools', 'get_install_instructions', 'whoami', 'my_apps', 'publish_app']);
    for (const t of body.result.tools) assert.equal(t.inputSchema.type, 'object');
  });

  test('search_apps says when nothing exists yet', async () => {
    const found = await call('search_apps', { query: 'notes app', platform: 'android' });
    assert.equal(found.structuredContent.apps[0].repo, 'alice/notes');
    assert.equal(found.structuredContent.apps[0].open_in_arkstore, `arkstore://app/${notes.id}`);
    const none = await call('search_apps', { query: 'quantum toaster' });
    assert.equal(none.structuredContent.count, 0);
    assert.match(none.structuredContent.note, /publish_app/);
    const bad = await call('search_apps', { query: 'x', platform: 'amiga' });
    assert.equal(bad.isError, true);
  });

  test('get_app accepts a GitHub URL and lists downloads', async () => {
    const r = await call('get_app', { repo: 'https://github.com/alice/notes' });
    assert.equal(r.structuredContent.downloads[0].file, 'notes.apk');
    assert.equal((await call('get_app', { repo: 'nobody/nothing' })).isError, true);
  });

  test('publishing needs a token and explains GitHub errors', async () => {
    const anon = await call('publish_app', { repo: 'alice/notes' });
    assert.equal(anon.isError, true);
    assert.match(anon.content[0].text, /Connect an AI agent/);

    const auth = { authorization: `Bearer ${TOKEN}` };
    const refused = await call('publish_app', { repo: 'bob/app' }, auth);
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /doesn't belong/);

    const ok = await call('publish_app', { repo: 'alice/notes', name: 'Notes', subtitle: '  ' }, auth);
    assert.equal(ok.structuredContent.published, true);
    assert.deepEqual(published.at(-1)!.input, { repo: 'alice/notes', name: 'Notes', subtitle: undefined, description: undefined, category: undefined });

    const bad = await call('whoami', {}, { authorization: `Bearer ark_${'b'.repeat(64)}` });
    assert.match(bad.content[0].text, /isn't valid/);
    assert.equal((await call('whoami', {}, { 'x-arkstore-token': TOKEN })).structuredContent.github_login, 'alice');
    // A Supabase JWT or anything else in Authorization is not an ArkStore token.
    assert.equal((await call('whoami', {}, { authorization: 'Bearer eyJhbGciOi' })).isError, true);
  });

  test('install instructions for npm, hosted servers and plugins', async () => {
    const npm = (await call('get_install_instructions', { key: pg.key })).structuredContent.install;
    const claude = npm.find((g: any) => g.client === 'claude-code');
    assert.equal(claude.steps[0].code, "claude mcp add pg -e 'DATABASE_URL=<DATABASE_URL>' -- npx -y @acme/pg-mcp@1.2.0");
    assert.match(claude.steps[1].label, /LOG_LEVEL/, 'optional settings are mentioned, not required');
    const codex = npm.find((g: any) => g.client === 'codex');
    assert.equal(codex.steps[0].code, "codex mcp add pg --env 'DATABASE_URL=<DATABASE_URL>' -- npx -y @acme/pg-mcp@1.2.0");
    const desktop = JSON.parse(npm.find((g: any) => g.client === 'claude-desktop').steps[0].code);
    assert.deepEqual(desktop.mcpServers.pg, { command: 'npx', args: ['-y', '@acme/pg-mcp@1.2.0'], env: { DATABASE_URL: '<DATABASE_URL>' } });

    const remote = installGuides(hosted);
    assert.equal(remote[0].steps[0].code, "claude mcp add --transport http search https://mcp.example.com/mcp --header 'Authorization: Bearer {token}'");
    assert.equal(remote[1].steps[0].kind, 'config', 'Codex needs headers in config.toml');
    assert.match(remote[1].steps[0].code!, /http_headers = \{ "Authorization" = "Bearer \{token\}" \}/);

    const plug = (await call('get_install_instructions', { key: plugin.key, client: 'claude-code' })).structuredContent.install;
    assert.equal(plug.length, 1);
    assert.deepEqual(plug[0].steps.map((s: any) => s.code), ['/plugin marketplace add anthropics/claude-plugins-official', '/plugin install code-review@claude-plugins-official']);
  });

  test('batches, bad JSON and GET', async () => {
    const { body } = await rpc([
      { jsonrpc: '2.0', id: 'a', method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 'b', method: 'tools/call', params: { name: 'list_categories' } },
    ]);
    assert.deepEqual(body.map((r: any) => r.id), ['a', 'b']);

    const res = await handle(new Request('https://x/mcp', { method: 'POST', body: '{nope' }), store);
    assert.equal(res.status, 400);
    const sse = await handle(new Request('https://x/mcp', { headers: { accept: 'text/event-stream' } }), store);
    assert.equal(sse.status, 405);
    const info = await handle(new Request('https://x/mcp'), store);
    assert.equal(((await info.json()) as any).name, 'ArkStore MCP server');
  });
});
