// Pure helpers for iPhone signature expiry (no native imports, so tests can load them).

export const REMINDERS = [
  { id: 'arkstore-expiry-3d', daysBefore: 3, title: 'Your iPhone apps expire in 3 days' },
  { id: 'arkstore-expiry-1d', daysBefore: 1, title: 'Your iPhone apps expire tomorrow' },
];
const DAY = 24 * 60 * 60 * 1000;

/** ExpirationDate from an embedded.mobileprovision (a signed file with an XML plist inside). */
export function provisionExpiry(profile: string): Date | null {
  const m = profile.match(/<key>ExpirationDate<\/key>\s*<date>([^<]+)<\/date>/);
  const date = m ? new Date(m[1].trim()) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

/** When each reminder should fire for a signature that runs out at `expiry` (only future ones). */
export function reminderTimes(expiry: Date, now = new Date()) {
  return REMINDERS.map((r) => ({ ...r, at: new Date(expiry.getTime() - r.daysBefore * DAY) })).filter((r) => r.at > now);
}
