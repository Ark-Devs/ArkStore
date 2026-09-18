// README helpers: pull readable prose and screenshot-worthy images out of markdown.

const BADGE_HINTS = [
  'shields.io',
  'badgen.net',
  'badge',
  'travis-ci',
  'codecov',
  'circleci',
  'liberapay',
  'ko-fi',
  'buymeacoffee',
  'opencollective',
  'patreon',
  'paypal',
  'donate',
  'weblate',
  'crowdin',
  'discord',
  'telegram',
  'star-history',
  'contrib.rocks',
  'get-it-on',
  'google-play',
  'play.google.com',
  'f-droid.org/badge',
  'fdroid.gitlab.io/artwork',
  'izzysoft',
  'obtainium',
  'github-readme-stats',
  'visitor',
  'hits.',
  'wakatime',
];

function isBadge(url: string) {
  const u = url.toLowerCase();
  if (/\.svg(\?|#|$)/.test(u)) return true;
  return BADGE_HINTS.some((hint) => u.includes(hint));
}

/** Turn a README image reference into an absolute URL that can be loaded directly. */
export function resolveImageUrl(src: string, rawBase: string): string | null {
  let url = src.trim().replace(/^<|>$/g, '');
  if (!url || url.startsWith('data:') || url.startsWith('#')) return null;

  const blob = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/(?:blob|raw)\/(.+?)(\?raw=true)?$/i);
  if (blob) return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}`;

  if (/^https?:\/\//i.test(url)) return url.replace(/^http:\/\//i, 'https://');
  if (url.startsWith('//')) return `https:${url}`;

  url = url.replace(/^\.\//, '');
  if (url.startsWith('/')) {
    const repoRoot = rawBase.split('/').slice(0, 6).join('/');
    return `${repoRoot}${url}`;
  }
  return `${rawBase.replace(/\/$/, '')}/${url}`;
}

export function readmeImages(markdown: string, rawBase: string): string[] {
  const found: string[] = [];
  const md = markdown.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of md.matchAll(/!\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) found.push(m[1]);
  for (const m of md.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) found.push(m[1]);

  const out: string[] = [];
  for (const src of found) {
    const url = resolveImageUrl(src, rawBase);
    if (!url || isBadge(url) || out.includes(url)) continue;
    if (/(logo|icon|banner|header|feature[-_]?graphic)/i.test(url.split('/').pop() ?? '')) continue;
    out.push(url);
  }
  return out;
}

/** First few paragraphs of prose, without badges, headings, tables or code. */
export function readmeSummary(markdown: string, maxLength = 1200): string {
  let md = markdown
    .replace(/\r\n/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
    .replace(/<(details|table|picture)[\s\S]*?<\/\1>/gi, '')
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, '');

  md = md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)([\s\S]+?)\1/g, '$2')
    .replace(/(^|[^*\w])[*_]([^*_\n]+)[*_]/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

  const paragraphs: string[] = [];
  for (const block of md.split(/\n\s*\n/)) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !/^#{1,6}\s/.test(l) && !/^\|/.test(l) && !/^[-=*_]{3,}$/.test(l));
    if (lines.length === 0) continue;
    const isList = lines.every((l) => /^([-*+]|\d+\.)\s+/.test(l));
    const text = isList
      ? lines.map((l) => `• ${l.replace(/^([-*+]|\d+\.)\s+/, '')}`).join('\n')
      : lines.map((l) => l.replace(/^>\s?/, '')).join(' ');
    if (!isList && text.length < 40) continue;
    paragraphs.push(text);
    if (paragraphs.join('\n\n').length >= maxLength || paragraphs.length >= 4) break;
  }

  const joined = paragraphs.join('\n\n').trim();
  if (joined.length <= maxLength) return joined;
  const cut = joined.slice(0, maxLength);
  return `${cut.slice(0, Math.max(cut.lastIndexOf('. ') + 1, cut.lastIndexOf('\n'))).trim() || cut.trim()}`;
}
