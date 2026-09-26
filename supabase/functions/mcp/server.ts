// ArkStore's MCP server: lets Claude, Codex and other MCP clients search ArkStore's apps and its
// catalog of MCP servers and plugins, check whether an app already exists before building one,
// and publish a developer's app for them.
//
// Streamable HTTP, stateless: every POST carries JSON-RPC and gets a JSON reply (no sessions, no
// server-sent events). Reading needs nothing; publishing needs a personal ArkStore token
// (ArkStore → Account → Connect an AI agent) sent as `Authorization: Bearer ark_…`.
//
// Plain TypeScript with no runtime imports besides agent-install.ts, so it runs in Deno (index.ts)
// and in Node for tests (tests/mcp.test.ts).

import { installGuides, installSummary, type AgentToolLike, type InstallClient } from './agent-install.ts';

export type App = {
  id: string;
  repo_full_name: string;
  name: string;
  subtitle: string;
  description?: string;
  category: string;
  platforms: string[];
  stars: number;
  downloads: number;
  latest_version: string | null;
  latest_published_at?: string | null;
  latest_release_notes?: string | null;
  license?: string | null;
  homepage?: string | null;
  developer_login: string;
  owner_id?: string | null;
  status?: string;
  assets?: { name: string; url: string; size: number; os: string; arch: string | null }[];
};

export type Tool = AgentToolLike & {
  key: string;
  description: string;
  publisher: string | null;
  repo_url: string | null;
  homepage: string | null;
  version: string | null;
  category: string | null;
};

export type PublishInput = { repo: string; name?: string; subtitle?: string; description?: string; category?: string };

/** What the server needs from the database (index.ts implements it with supabase-js). */
export interface Store {
  searchApps(query: string | null, platform: string | null, category: string | null, limit: number): Promise<App[]>;
  getApp(ref: string): Promise<App | null>;
  categories(): Promise<{ slug: string; name: string }[]>;
  searchTools(query: string | null, kind: string | null, limit: number): Promise<Tool[]>;
  getTool(key: string): Promise<Tool | null>;
  whoami(token: string): Promise<{ github_login: string | null }>;
  myApps(token: string): Promise<App[]>;
  publish(token: string, input: PublishInput): Promise<App>;
}

export const SERVER_VERSION = '1.0.0';
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const PLATFORMS = ['android', 'windows', 'macos', 'linux'];
const TOKEN_HELP =
  'Publishing needs your ArkStore token. In ArkStore open Account → Connect an AI agent, create a token, and add it to this MCP server as the header "Authorization: Bearer ark_…".';

const INSTRUCTIONS = `ArkStore is an open-source app store for Android, Windows, macOS and Linux that installs apps straight from their GitHub releases. It also lists MCP servers and Claude Code plugins.

Use it to:
- Check whether an app already exists before building one: search_apps with a few words describing it (optionally a platform). If something fits, suggest it instead of building from scratch.
- Get an app's details and download links: get_app.
- Find MCP servers and Claude Code plugins, and how to install them in Claude Code, Codex or Claude Desktop: search_agent_tools, then get_install_instructions.
- Publish the user's own app: publish_app with their GitHub repo. It must have a GitHub release with an installable file (APK, EXE, MSI, DMG, AppImage, DEB...). This needs the user's ArkStore token.`;

type Json = Record<string, unknown>;
type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Json };

class ToolError extends Error {}

const trim = (s: string | null | undefined, n: number) => {
  const t = (s ?? '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const clampLimit = (v: unknown, def = 10) => Math.max(1, Math.min(25, Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : def));

function appSummary(a: App) {
  return {
    name: a.name,
    repo: a.repo_full_name,
    subtitle: a.subtitle,
    category: a.category,
    platforms: a.platforms,
    stars: a.stars,
    latest_version: a.latest_version,
    downloads_via_arkstore: a.downloads,
    github: `https://github.com/${a.repo_full_name}`,
    open_in_arkstore: `arkstore://app/${a.id}`,
  };
}

function appDetails(a: App) {
  return {
    ...appSummary(a),
    description: trim(a.description, 2000),
    developer: a.developer_login,
    license: a.license ?? null,
    homepage: a.homepage ?? null,
    released: a.latest_published_at ?? null,
    release_notes: trim(a.latest_release_notes, 1500),
    listed_by_developer: Boolean(a.owner_id),
    downloads: (a.assets ?? []).slice(0, 20).map((f) => ({ file: f.name, os: f.os, arch: f.arch, size_bytes: f.size, url: f.url })),
  };
}

function toolSummary(t: Tool) {
  return {
    key: t.key,
    kind: t.kind === 'plugin' ? 'Claude Code plugin' : 'MCP server',
    title: t.title,
    install_name: t.name,
    publisher: t.publisher,
    description: trim(t.description, 300),
    runs_as: installSummary(t),
    repository: t.repo_url,
  };
}

const TOOLS = [
  {
    name: 'search_apps',
    title: 'Search ArkStore apps',
    description:
      'Search the ArkStore catalog of open-source apps (installed from their GitHub releases). Use it to check whether an app for an idea already exists before building one. Matches name, description, topics and repo; results that match every word come first.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What the app does or its name, e.g. "markdown notes with sync" or "obsidian".' },
        platform: { type: 'string', enum: PLATFORMS, description: 'Only apps that install on this platform.' },
        category: { type: 'string', description: 'A category slug from list_categories.' },
        limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_app',
    title: 'Get an ArkStore app',
    description: "An app's full listing: description, platforms, latest version and release notes, and download links for every platform.",
    inputSchema: {
      type: 'object',
      properties: { repo: { type: 'string', description: 'GitHub repo as owner/name (or its URL), or the app id from search_apps.' } },
      required: ['repo'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'list_categories',
    title: 'List categories',
    description: 'The app categories ArkStore uses (slug and name).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'search_agent_tools',
    title: 'Search MCP servers and plugins',
    description:
      'Search ArkStore’s catalog of MCP servers (from the official MCP registry) and Claude Code plugins (from plugin marketplaces). Use get_install_instructions with a result’s key to install one.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What it should do, e.g. "postgres", "browser automation", "code review".' },
        kind: { type: 'string', enum: ['mcp', 'plugin'], description: 'Only MCP servers or only Claude Code plugins.' },
        limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_install_instructions',
    title: 'How to install an MCP server or plugin',
    description:
      'Exact commands or config to install an MCP server or Claude Code plugin from search_agent_tools in Claude Code, Codex or Claude Desktop. Placeholders like <API_KEY> must be filled in by the user.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The key from search_agent_tools, e.g. "mcp:io.github.github/github-mcp-server".' },
        client: { type: 'string', enum: ['claude-code', 'codex', 'claude-desktop'], description: 'Only this client (default: all).' },
      },
      required: ['key'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'whoami',
    title: 'Who am I on ArkStore',
    description: 'The GitHub account the ArkStore token belongs to. Needs the token.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'my_apps',
    title: 'My ArkStore apps',
    description: "The apps you've published on ArkStore, with their status. Needs the token.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'publish_app',
    title: 'Publish an app on ArkStore',
    description:
      "Publish the user's app on ArkStore from its public GitHub repo, update their listing, or claim a listing ArkStore added for their repo. The repo must belong to the user's GitHub account and have a release with an installable file (APK, EXE, MSI, DMG, AppImage, DEB...). Name, subtitle, description and category default to the repo's. Needs the token. Confirm with the user before publishing.",
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/name or the GitHub URL.' },
        name: { type: 'string', maxLength: 40, description: 'Store name (default: repo name).' },
        subtitle: { type: 'string', maxLength: 80, description: 'One line under the name (default: repo description).' },
        description: { type: 'string', maxLength: 4000 },
        category: { type: 'string', description: 'Category slug from list_categories (default: guessed).' },
      },
      required: ['repo'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
] as const;

const PUBLISH_ERRORS: Record<string, string> = {
  invalid_token: `That ArkStore token isn't valid (it may have been revoked). ${TOKEN_HELP}`,
  invalid_repo: 'Give the repo as owner/name or a GitHub URL.',
  repo_not_found: "GitHub can't find that repo. It has to be public.",
  repo_private: 'That repo is private. ArkStore lists public repos only.',
  not_repo_owner:
    "That repo doesn't belong to the GitHub account behind this token. Organization repos can be published from ArkStore → Studio, which asks GitHub for access.",
  no_apk_release:
    'The repo has no GitHub release with an installable file yet. Publish a release with an APK, EXE, MSI, DMG, AppImage or DEB attached, then try again.',
  already_listed: 'Another ArkStore developer already manages this listing.',
  github_rate_limited: 'GitHub is rate-limiting ArkStore right now. Try again in a few minutes.',
  github_unavailable: "ArkStore couldn't reach GitHub. Try again in a minute.",
  github_account_required: 'This ArkStore account has no GitHub sign-in linked. Sign in to ArkStore with GitHub first.',
  invalid_category: 'Unknown category. Use a slug from list_categories.',
  invalid_name: 'The name must be 1 to 40 characters.',
};

function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e);
  const code = Object.keys(PUBLISH_ERRORS).find((k) => msg.includes(k));
  return code ? PUBLISH_ERRORS[code] : `ArkStore couldn't do that: ${msg}`;
}

async function callTool(store: Store, name: string, args: Json, token: string | null): Promise<unknown> {
  const needToken = () => {
    if (!token) throw new ToolError(TOKEN_HELP);
    return token;
  };
  switch (name) {
    case 'search_apps': {
      const query = str(args.query);
      const platform = str(args.platform);
      if (platform && !PLATFORMS.includes(platform)) throw new ToolError(`platform must be one of ${PLATFORMS.join(', ')}.`);
      const apps = await store.searchApps(query, platform, str(args.category), clampLimit(args.limit));
      return {
        query,
        platform,
        count: apps.length,
        apps: apps.map(appSummary),
        note: apps.length
          ? 'Results are ranked by how well they match. Check a result with get_app before recommending it.'
          : "Nothing on ArkStore matches. It may not exist yet: if the user builds it, publish_app can list it once it has a GitHub release.",
      };
    }
    case 'get_app': {
      const ref = str(args.repo);
      if (!ref) throw new ToolError('Give the repo as owner/name.');
      const app = await store.getApp(ref);
      if (!app) throw new ToolError(`${ref} isn't on ArkStore. search_apps finds apps by what they do.`);
      return appDetails(app);
    }
    case 'list_categories':
      return { categories: await store.categories() };
    case 'search_agent_tools': {
      const kind = str(args.kind);
      if (kind && kind !== 'mcp' && kind !== 'plugin') throw new ToolError('kind must be "mcp" or "plugin".');
      const tools = await store.searchTools(str(args.query), kind, clampLimit(args.limit));
      return { count: tools.length, results: tools.map(toolSummary) };
    }
    case 'get_install_instructions': {
      const key = str(args.key);
      if (!key) throw new ToolError('Give the key from search_agent_tools.');
      const tool = await store.getTool(key);
      if (!tool) throw new ToolError(`No MCP server or plugin with key ${key}. Use search_agent_tools to find one.`);
      const client = str(args.client) as InstallClient | null;
      const guides = installGuides(tool).filter((g) => !client || g.client === client);
      return {
        ...toolSummary(tool),
        homepage: tool.homepage,
        version: tool.version,
        install: guides,
        note: 'Replace <PLACEHOLDERS> with real values. Never paste secrets into a shared chat.',
      };
    }
    case 'whoami':
      return await store.whoami(needToken());
    case 'my_apps': {
      const apps = await store.myApps(needToken());
      return { count: apps.length, apps: apps.map((a) => ({ ...appSummary(a), status: a.status })) };
    }
    case 'publish_app': {
      const t = needToken();
      const repo = str(args.repo);
      if (!repo) throw new ToolError('Give the repo as owner/name or a GitHub URL.');
      const app = await store.publish(t, {
        repo,
        name: str(args.name) ?? undefined,
        subtitle: str(args.subtitle) ?? undefined,
        description: str(args.description) ?? undefined,
        category: str(args.category) ?? undefined,
      });
      return { published: true, ...appDetails(app), note: 'Live on ArkStore now. New GitHub releases reach users automatically.' };
    }
    default:
      throw new RpcError(-32602, `Unknown tool: ${name}`);
  }
}

class RpcError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

async function handleMessage(store: Store, msg: RpcRequest, token: string | null): Promise<Json | null> {
  const isRequest = msg.id !== undefined && msg.id !== null;
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });

  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'Invalid request');
  // Notifications (initialized, cancelled...) need no answer.
  if (!isRequest) return null;

  try {
    switch (msg.method) {
      case 'initialize': {
        const asked = String(msg.params?.protocolVersion ?? '');
        return reply({
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'arkstore', title: 'ArkStore', version: SERVER_VERSION },
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: TOOLS });
      case 'tools/call': {
        const name = String(msg.params?.name ?? '');
        const args = (msg.params?.arguments ?? {}) as Json;
        try {
          const result = await callTool(store, name, args, token);
          return reply({
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            structuredContent: result,
          });
        } catch (e) {
          if (e instanceof RpcError) throw e;
          return reply({ content: [{ type: 'text', text: e instanceof ToolError ? e.message : friendly(e) }], isError: true });
        }
      }
      case 'resources/list':
        return reply({ resources: [] });
      case 'prompts/list':
        return reply({ prompts: [] });
      default:
        return fail(-32601, `Method not found: ${msg.method}`);
    }
  } catch (e) {
    if (e instanceof RpcError) return fail(e.code, e.message);
    return fail(-32603, e instanceof Error ? e.message : 'Internal error');
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Protocol-Version, Mcp-Session-Id, X-ArkStore-Token, apikey, x-client-info',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** ark_… from "Authorization: Bearer ark_…" or "X-ArkStore-Token". Anything else is ignored. */
export function tokenFrom(req: Request): string | null {
  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const t = (req.headers.get('x-arkstore-token') ?? bearer).trim();
  return t.startsWith('ark_') ? t : null;
}

export async function handle(req: Request, store: Store): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method === 'GET') {
    // No server-to-client stream: clients that ask for one fall back to plain POSTs.
    if ((req.headers.get('accept') ?? '').includes('text/event-stream')) {
      return new Response('This MCP server does not open event streams.', { status: 405, headers: { ...CORS, Allow: 'POST' } });
    }
    return json({
      name: 'ArkStore MCP server',
      version: SERVER_VERSION,
      transport: 'streamable-http (POST JSON-RPC to this URL)',
      tools: TOOLS.map((t) => t.name),
      connect: {
        'claude-code': 'claude mcp add --transport http arkstore <this URL>',
        codex: 'codex mcp add arkstore --url <this URL>',
      },
    });
  }
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: { ...CORS, Allow: 'GET, POST' } });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }
  const token = tokenFrom(req);
  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as RpcRequest[];
  if (messages.length === 0) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Empty batch' } }, 400);
  const replies = (await Promise.all(messages.map((m) => handleMessage(store, m ?? {}, token)))).filter(Boolean);
  if (replies.length === 0) return new Response(null, { status: 202, headers: CORS });
  return json(batch ? replies : replies[0]);
}
