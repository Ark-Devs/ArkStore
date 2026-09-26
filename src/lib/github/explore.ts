// Explore a GitHub repo from inside ArkStore: its numbers, README and top-level files.
// Used by the agent store, where most entries are MCP servers and plugins published as repos.
import { useQuery } from '@tanstack/react-query';

import { getGitHubToken } from '../auth';
import { githubJson, type GitHubRepo } from './detect';
import { readmeSummary } from './markdown';
import { parseRepoInput } from './repo';

export type RepoEntry = { name: string; path: string; type: 'file' | 'dir' | 'symlink' | 'submodule'; size: number; html_url: string };

export type RepoOverview = {
  repo: GitHubRepo & { open_issues_count?: number; subscribers_count?: number };
  /** README as readable prose (badges, code and HTML stripped), or '' when there is none. */
  readme: string;
  readmeUrl: string | null;
  /** Top-level files and folders, folders first. */
  entries: RepoEntry[];
};

/** owner/repo when the URL points at a GitHub repo, else null. */
export function githubRepoOf(url: string | null | undefined): string | null {
  if (!url || !/github\.com[/:]/i.test(url)) return null;
  return parseRepoInput(url)?.fullName ?? null;
}

export async function fetchRepoOverview(fullName: string, token: string | null): Promise<RepoOverview> {
  const opts = { token };
  const repo = await githubJson<RepoOverview['repo']>(`/repos/${fullName}`, opts);
  const [readme, entries] = await Promise.all([
    githubJson<{ content?: string; encoding?: string; html_url?: string }>(`/repos/${repo.full_name}/readme`, opts).catch(() => null),
    githubJson<RepoEntry[]>(`/repos/${repo.full_name}/contents`, opts).catch(() => [] as RepoEntry[]),
  ]);
  return {
    repo,
    readme: readme?.content && readme.encoding === 'base64' ? readmeSummary(decodeBase64(readme.content), 2400) : '',
    readmeUrl: readme?.html_url ?? null,
    entries: (Array.isArray(entries) ? entries : [])
      .slice()
      .sort((a, b) => (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) || a.name.localeCompare(b.name)),
  };
}

/** UTF-8 safe base64 decode (atob alone mangles non-ASCII READMEs). */
function decodeBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Signed in with GitHub: 5,000 requests an hour instead of 60 per network. */
export function useRepoOverview(fullName: string | null) {
  return useQuery({
    queryKey: ['repo-overview', fullName?.toLowerCase() ?? ''],
    enabled: Boolean(fullName),
    staleTime: 30 * 60 * 1000,
    retry: false,
    queryFn: async () => fetchRepoOverview(fullName!, await getGitHubToken().catch(() => null)),
  });
}
