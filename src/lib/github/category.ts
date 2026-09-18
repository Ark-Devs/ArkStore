// Guess a store category from a repo's topics and text. Slugs match public.categories.
const RULES: [slug: string, pattern: RegExp][] = [
  ['games', /\b(game|games|gaming|puzzle|chess|sudoku|emulator|arcade|roguelike)\b/],
  ['weather', /\b(weather|forecast)\b/],
  ['security', /\b(privacy|security|2fa|totp|otp|authenticator|password|passwords|vpn|firewall|encryption|encrypted|keepass|adblock|tracker|trackers)\b/],
  ['personalization', /\b(launcher|wallpaper|wallpapers|icon-pack|icons|theme|themes|widget|widgets|keyboard|home-screen|homescreen)\b/],
  ['music-audio', /\b(music|audio|podcast|podcasts|radio|mp3|sound|equalizer|spotify|soundcloud)\b/],
  ['video', /\b(video|videos|youtube|streaming|iptv|movies|movie|tv|anime)\b/],
  ['photography', /\b(photo|photos|gallery|camera|images|pictures)\b/],
  ['communication', /\b(chat|messenger|messaging|email|e-mail|mail|sms|xmpp|matrix|telegram|calls|dialer|contacts)\b/],
  ['social', /\b(social|mastodon|fediverse|reddit|twitter|lemmy|pixelfed|bluesky)\b/],
  ['reading', /\b(reader|ebook|ebooks|epub|book|books|manga|comics|comic|pdf)\b/],
  ['news', /\b(news|rss|atom|feed|feeds|hacker-news)\b/],
  ['maps', /\b(map|maps|navigation|gps|osm|openstreetmap|travel|transit)\b/],
  ['health', /\b(health|fitness|workout|exercise|sleep|meditation|habit|habits|period|medication)\b/],
  ['finance', /\b(finance|budget|money|expense|expenses|wallet|bank|banking|crypto|bitcoin|invest|investing)\b/],
  ['education', /\b(learn|learning|education|flashcard|flashcards|anki|quiz|study|dictionary)\b/],
  ['files', /\b(file-manager|files|file|storage|backup|sync|cloud|ftp|nextcloud|syncthing)\b/],
  ['developer', /\b(developer|developers|terminal|shell|git|ssh|adb|ide|api|crawler|scraper|database|sql|logcat|devtools)\b/],
  ['productivity', /\b(notes|note|todo|to-do|tasks|task|calendar|productivity|planner|office|documents|clipboard|reminders)\b/],
];

export function suggestCategory(input: {
  topics?: string[];
  name?: string;
  description?: string | null;
  extra?: string | null;
}): string {
  const topics = (input.topics ?? []).join(' ').toLowerCase();
  const text = [input.name, input.description, input.extra]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ');

  let best = 'tools';
  let bestScore = 0;
  for (const [slug, pattern] of RULES) {
    const global = new RegExp(pattern.source, 'g');
    const score = (topics.match(global)?.length ?? 0) * 3 + (text.match(global)?.length ?? 0);
    if (score > bestScore) {
      best = slug;
      bestScore = score;
    }
  }
  return best;
}
