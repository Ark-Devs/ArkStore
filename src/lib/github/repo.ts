export type RepoRef = { owner: string; name: string; fullName: string };

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Accepts https URLs (any page inside the repo), SSH remotes and plain `owner/repo`.
 * Mirrors arkstore_private.normalize_repo() in the database.
 */
export function parseRepoInput(input: string): RepoRef | null {
  let v = input.trim();
  v = v.replace(/^(git\+)?(https?:\/\/)?(www\.)?github\.com[/:]/i, '');
  v = v.replace(/^git@github\.com:/i, '');
  v = v.replace(/\.git$/i, '');
  const [path] = v.split(/[?#]/);
  const [owner, name] = path.split('/');
  if (!owner || !name || !OWNER.test(owner) || !NAME.test(name) || name === '.' || name === '..') {
    return null;
  }
  return { owner, name, fullName: `${owner}/${name}` };
}

export const repoUrl = (fullName: string) => `https://github.com/${fullName}`;
export const profileUrl = (login: string) => `https://github.com/${login}`;
