export function compactNumber(n: number | null | undefined): string {
  const v = n ?? 0;
  if (v < 1000) return String(v);
  if (v < 10_000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  if (v < 1_000_000) return `${Math.round(v / 1000)}K`;
  return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

export function fileSize(bytes: number | null | undefined): string {
  if (!bytes) return '-';
  const mb = bytes / 1_048_576;
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** "8 sec", "1 min 20 sec", "12 min". */
export function duration(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `${s} sec`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 10 && rest >= 5) return `${m} min ${rest} sec`;
  return `${Math.round(s / 60)} min`;
}

/** How long a download of `bytes` should take at this phone's measured speed. */
export function downloadEstimate(bytes: number | null | undefined, bytesPerSecond: number | null | undefined) {
  if (!bytes || !bytesPerSecond || bytesPerSecond <= 0) return null;
  return `≈ ${duration(bytes / bytesPerSecond)}`;
}

export function relativeDate(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const diff = now - Date.parse(iso);
  const day = 86_400_000;
  if (diff < 60 * 60 * 1000) return 'Just now';
  if (diff < day) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 2 * day) return 'Yesterday';
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  if (diff < 30 * day) return `${Math.floor(diff / (7 * day))}w ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function longDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Tag names like "v1.2.3" read better as "1.2.3" in tight spots. */
export const shortVersion = (v: string | null | undefined) => (v ?? '').replace(/^v(?=\d)/i, '');

const ANDROID_VERSIONS: Record<number, string> = {
  21: '5.0', 22: '5.1', 23: '6.0', 24: '7.0', 25: '7.1', 26: '8.0', 27: '8.1', 28: '9',
  29: '10', 30: '11', 31: '12', 32: '12L', 33: '13', 34: '14', 35: '15', 36: '16', 37: '17',
};
export const androidVersion = (sdk: number | null | undefined) =>
  sdk ? `Android ${ANDROID_VERSIONS[sdk] ?? `API ${sdk}`}+` : null;

/** Release notes are markdown; show them as tidy plain text. */
export function plainNotes(md: string | null | undefined): string {
  if (!md) return '';
  return md
    .replace(/\r\n/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/(\*\*|__)([\s\S]+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const todayLabel = (d = new Date()) =>
  d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
