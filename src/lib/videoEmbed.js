const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com', // same video ids; the standard embed plays them
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,}$/;

const youtubeEmbed = (id) => (id && YOUTUBE_ID.test(id) ? `https://www.youtube.com/embed/${id}` : null);

/**
 * Parse a YouTube/Vimeo url into an embeddable url. The host is validated, so a youtube url
 * hidden inside another site's query string is not accepted.
 */
export function getEmbedUrl(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  let raw = input.trim();
  // Admins may have saved links without a scheme (the field is not validated on save).
  if (raw.startsWith('//')) raw = `https:${raw}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be') return youtubeEmbed(segments[0]);

  if (YOUTUBE_HOSTS.has(host)) {
    if (segments[0] === 'watch') return youtubeEmbed(url.searchParams.get('v'));
    if (['embed', 'shorts', 'live', 'v'].includes(segments[0])) return youtubeEmbed(segments[1]);
    return null;
  }

  if (VIMEO_HOSTS.has(host)) {
    const at = segments.findIndex((seg) => /^\d+$/.test(seg));
    if (at === -1) return null;
    // Unlisted videos need the privacy hash: either /ID/HASH or ?h=HASH
    const hash = [segments[at + 1], url.searchParams.get('h')].find((h) => h && /^[A-Za-z0-9]+$/.test(h));
    return `https://player.vimeo.com/video/${segments[at]}${hash ? `?h=${hash}` : ''}`;
  }

  return null;
}
