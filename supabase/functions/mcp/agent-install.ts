// How to install an MCP server or a Claude Code plugin from ArkStore's agent catalog, per client.
// Shared by the ArkStore MCP server (this folder) and the app (src/lib/agent-install.ts), so an
// agent and a person see the same commands. No imports: it runs in Deno and React Native alike.

export type EnvVar = {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  default?: string;
  value?: string;
};

export type Argument = {
  type?: 'positional' | 'named';
  name?: string;
  value?: string;
  valueHint?: string;
  default?: string;
  isRequired?: boolean;
};

/** A package entry from the MCP registry (server.json "packages"). */
export type RegistryPackage = {
  registryType?: string;
  identifier?: string;
  version?: string;
  runtimeHint?: string;
  transport?: { type?: string; url?: string };
  environmentVariables?: EnvVar[];
  packageArguments?: Argument[];
  runtimeArguments?: Argument[];
};

/** A hosted server from the MCP registry (server.json "remotes"). */
export type RegistryRemote = {
  type?: string;
  url?: string;
  headers?: EnvVar[];
};

export type AgentToolLike = {
  kind: 'mcp' | 'plugin';
  name: string;
  title: string;
  packages?: RegistryPackage[] | null;
  remotes?: RegistryRemote[] | null;
  marketplace?: string | null;
  marketplace_repo?: string | null;
};

export type InstallClient = 'claude-code' | 'codex' | 'claude-desktop';

export const CLIENT_LABEL: Record<InstallClient, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'claude-desktop': 'Claude Desktop',
};

export type InstallStep = {
  /** What to do with `code`. */
  kind: 'command' | 'config' | 'note';
  label: string;
  code?: string;
  /** Where a config snippet goes. */
  file?: string;
};

export type InstallGuide = {
  client: InstallClient;
  supported: boolean;
  steps: InstallStep[];
};

type Launch =
  | { type: 'remote'; transport: 'http' | 'sse'; url: string; headers: EnvVar[] }
  | { type: 'stdio'; command: string; args: string[]; env: EnvVar[] };

const PACKAGE_PREFERENCE = ['npm', 'pypi', 'oci', 'nuget'];

const placeholder = (v: { name?: string; valueHint?: string; description?: string }) =>
  `<${(v.valueHint || v.name || 'value').replace(/^-+/, '').replace(/[<>]/g, '')}>`;

const quote = (s: string) => (/^[A-Za-z0-9_./:@=+,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

function argList(args: Argument[] | undefined): string[] {
  const out: string[] = [];
  for (const a of args ?? []) {
    const value = a.value ?? a.default;
    if (a.type === 'named') {
      if (!a.name) continue;
      if (value != null) out.push(a.name, value);
      else if (a.isRequired) out.push(a.name, placeholder(a));
    } else if (value != null) out.push(value);
    else if (a.isRequired) out.push(placeholder(a));
  }
  return out;
}

/** The best way to run a registry MCP server: hosted if it has a URL, else its package. */
export function launchFor(tool: AgentToolLike): Launch | null {
  const remote =
    (tool.remotes ?? []).find((r) => r.type === 'streamable-http' && r.url) ??
    (tool.remotes ?? []).find((r) => r.type === 'sse' && r.url);
  if (remote) {
    return { type: 'remote', transport: remote.type === 'sse' ? 'sse' : 'http', url: remote.url!, headers: remote.headers ?? [] };
  }
  const pkgs = (tool.packages ?? []).filter((p) => p.identifier && (p.transport?.type ?? 'stdio') === 'stdio');
  const pkg = [...pkgs].sort(
    (a, b) =>
      (PACKAGE_PREFERENCE.indexOf(a.registryType ?? '') + 1 || 99) - (PACKAGE_PREFERENCE.indexOf(b.registryType ?? '') + 1 || 99),
  )[0];
  if (!pkg) return null;
  const id = pkg.identifier!;
  const pinned = (sep: string) => (pkg.version && !id.includes(sep, 1) ? `${id}${sep}${pkg.version}` : id);
  const runtime = argList(pkg.runtimeArguments);
  const args = argList(pkg.packageArguments);
  const env = pkg.environmentVariables ?? [];
  switch (pkg.registryType) {
    case 'npm':
      return { type: 'stdio', command: 'npx', args: ['-y', ...runtime, pinned('@'), ...args], env };
    case 'pypi':
      return { type: 'stdio', command: 'uvx', args: [...runtime, pinned('@'), ...args], env };
    case 'oci':
      return {
        type: 'stdio',
        command: 'docker',
        args: ['run', '-i', '--rm', ...env.flatMap((e) => ['-e', e.name]), ...runtime, id, ...args],
        env,
      };
    case 'nuget':
      return { type: 'stdio', command: 'dnx', args: [...runtime, pinned('@'), '--yes', ...args], env };
    default:
      return null;
  }
}

const envValue = (e: EnvVar) => e.value ?? e.default ?? placeholder({ name: e.name });
const neededEnv = (env: EnvVar[]) => env.filter((e) => e.isRequired || e.value != null);
const optionalEnv = (env: EnvVar[]) => env.filter((e) => !e.isRequired && e.value == null);

function optionalNote(env: EnvVar[], what: string): InstallStep[] {
  const opt = optionalEnv(env);
  if (!opt.length) return [];
  return [
    {
      kind: 'note',
      label: `Optional ${what}: ${opt.map((e) => e.name + (e.description ? ` (${e.description})` : '')).join('; ')}`,
    },
  ];
}

function tomlString(s: string) {
  return JSON.stringify(s);
}

function mcpGuides(tool: AgentToolLike, launch: Launch): InstallGuide[] {
  const name = tool.name;
  if (launch.type === 'remote') {
    const headers = neededEnv(launch.headers);
    const headerFlags = headers.map((h) => ` --header ${quote(`${h.name}: ${envValue(h)}`)}`).join('');
    const tomlHeaders = headers.length
      ? `\nhttp_headers = { ${headers.map((h) => `${tomlString(h.name)} = ${tomlString(envValue(h))}`).join(', ')} }`
      : '';
    return [
      {
        client: 'claude-code',
        supported: true,
        steps: [
          { kind: 'command', label: 'Run in your terminal', code: `claude mcp add --transport ${launch.transport} ${name} ${quote(launch.url)}${headerFlags}` },
          ...optionalNote(launch.headers, 'headers'),
        ],
      },
      {
        client: 'codex',
        supported: launch.transport === 'http',
        steps:
          launch.transport === 'http'
            ? [
                headers.length
                  ? { kind: 'config', label: 'Add to your Codex config', file: '~/.codex/config.toml', code: `[mcp_servers.${name}]\nurl = ${tomlString(launch.url)}${tomlHeaders}` }
                  : { kind: 'command', label: 'Run in your terminal', code: `codex mcp add ${name} --url ${quote(launch.url)}` },
                ...optionalNote(launch.headers, 'headers'),
              ]
            : [{ kind: 'note', label: 'This server only speaks the older SSE transport, which Codex does not support.' }],
      },
      {
        client: 'claude-desktop',
        supported: true,
        steps: [
          { kind: 'note', label: 'In Claude (desktop or claude.ai): Settings → Connectors → Add custom connector, and paste this URL:' },
          { kind: 'command', label: 'Connector URL', code: launch.url },
          ...(headers.length ? [{ kind: 'note' as const, label: `It needs ${headers.map((h) => h.name).join(', ')}, which custom connectors can't send; use Claude Code instead.` }] : []),
        ],
      },
    ];
  }

  const env = neededEnv(launch.env);
  const claudeEnv = env.map((e) => ` -e ${quote(`${e.name}=${envValue(e)}`)}`).join('');
  const codexEnv = env.map((e) => ` --env ${quote(`${e.name}=${envValue(e)}`)}`).join('');
  const cmd = [launch.command, ...launch.args].map(quote).join(' ');
  const desktopJson = JSON.stringify(
    {
      mcpServers: {
        [name]: {
          command: launch.command,
          args: launch.args,
          ...(env.length ? { env: Object.fromEntries(env.map((e) => [e.name, envValue(e)])) } : {}),
        },
      },
    },
    null,
    2,
  );
  return [
    {
      client: 'claude-code',
      supported: true,
      steps: [
        { kind: 'command', label: 'Run in your terminal', code: `claude mcp add ${name}${claudeEnv} -- ${cmd}` },
        ...optionalNote(launch.env, 'settings'),
      ],
    },
    {
      client: 'codex',
      supported: true,
      steps: [
        { kind: 'command', label: 'Run in your terminal', code: `codex mcp add ${name}${codexEnv} -- ${cmd}` },
        ...optionalNote(launch.env, 'settings'),
      ],
    },
    {
      client: 'claude-desktop',
      supported: true,
      steps: [
        { kind: 'config', label: 'Add to claude_desktop_config.json (Settings → Developer → Edit Config), then restart Claude', file: 'claude_desktop_config.json', code: desktopJson },
        ...optionalNote(launch.env, 'settings'),
      ],
    },
  ];
}

/** Install instructions for every client. */
export function installGuides(tool: AgentToolLike): InstallGuide[] {
  if (tool.kind === 'plugin') {
    const market = tool.marketplace ?? '';
    return [
      {
        client: 'claude-code',
        supported: Boolean(tool.marketplace_repo),
        steps: [
          { kind: 'command', label: 'Add the marketplace (once), inside Claude Code', code: `/plugin marketplace add ${tool.marketplace_repo}` },
          { kind: 'command', label: 'Install the plugin', code: `/plugin install ${tool.name}@${market}` },
        ],
      },
      { client: 'codex', supported: false, steps: [{ kind: 'note', label: 'Claude Code plugins install in Claude Code.' }] },
      { client: 'claude-desktop', supported: false, steps: [{ kind: 'note', label: 'Claude Code plugins install in Claude Code.' }] },
    ];
  }
  const launch = launchFor(tool);
  if (!launch) {
    const note = 'This server has no package or URL ArkStore can turn into an install command; see its repository.';
    return (['claude-code', 'codex', 'claude-desktop'] as const).map((client) => ({
      client,
      supported: false,
      steps: [{ kind: 'note', label: note }],
    }));
  }
  return mcpGuides(tool, launch);
}

/** One line for listings: how it runs. */
export function installSummary(tool: AgentToolLike): string {
  if (tool.kind === 'plugin') return `Claude Code plugin · ${tool.marketplace ?? 'marketplace'}`;
  const launch = launchFor(tool);
  if (!launch) return 'MCP server';
  if (launch.type === 'remote') return 'Hosted MCP server';
  return `MCP server · ${launch.command === 'npx' ? 'npm' : launch.command === 'uvx' ? 'Python' : launch.command === 'docker' ? 'Docker' : '.NET'}`;
}
