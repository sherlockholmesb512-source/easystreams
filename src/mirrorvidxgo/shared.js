const { extractVidxGo } = require('../extractors/vidxgo');
const { formatStream } = require('../formatter.js');

const TMDB_API_KEY = '7039c79558d9a2c4fa1a63219272dc84';
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
const SLUG_NOISE_WORDS = new Set(['guarda', 'streaming', 'online', 'ita', 'italiano', 'gratis', 'hd', 'cb01', 'cb', 'film', 'serie', 'tv', 'the', 'altadefinizione']);

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&[a-z]+;|&#\d+;/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugTokens(slug) {
  const cleaned = String(slug || '')
    .replace(/-\d+x\d+.*$/i, '')
    .replace(/-(?:streaming|hd|cb01|ita|online)+(-|$)/gi, '$1');
  return normalizeTitle(cleaned)
    .split(' ')
    .filter((token) => token.length > 1 && !SLUG_NOISE_WORDS.has(token));
}

function scoreSlugMatch(title, slug) {
  const titleNorm = normalizeTitle(title);
  if (!titleNorm) return 0;
  const tokens = slugTokens(slug);
  if (!tokens.length) return 0;
  const slugJoined = tokens.join(' ');
  if (slugJoined === titleNorm) return 100;
  const titleParts = titleNorm.split(' ');
  let hits = 0;
  for (const token of tokens) {
    if (titleParts.some((part) => part.length > 2 && (part === token || token.startsWith(part) || part.startsWith(token)))) {
      hits += 1;
    }
  }
  const ratio = hits / Math.max(tokens.length, titleParts.length);
  return Math.round(ratio * 90);
}

async function fetchText(url, headers = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8', ...headers },
      signal: controller.signal,
      redirect: 'follow'
    });
    if (!response.ok) return null;
    return await response.text();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveTmdbId(id, type, providerContext = null) {
  const contextTmdbId = providerContext && /^\d+$/.test(String(providerContext.tmdbId || '')) ? String(providerContext.tmdbId) : null;
  if (contextTmdbId) return contextTmdbId;

  const idStr = String(id || '').trim().replace(/^tmdb:/i, '');
  if (/^\d+$/.test(idStr)) return idStr;

  const contextImdbId = providerContext && /^tt\d+$/i.test(String(providerContext.imdbId || '')) ? String(providerContext.imdbId) : null;
  const imdbId = /^tt\d+$/i.test(idStr) ? idStr : contextImdbId;
  if (!imdbId) return null;

  const endpoint = String(type || '').toLowerCase() === 'movie' ? 'movie' : 'tv';
  try {
    const response = await fetch(`https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
    if (!response.ok) return null;
    const payload = await response.json();
    if (endpoint === 'movie' && payload.movie_results?.[0]?.id) return String(payload.movie_results[0].id);
    if (payload.tv_results?.[0]?.id) return String(payload.tv_results[0].id);
    if (payload.movie_results?.[0]?.id) return String(payload.movie_results[0].id);
    return null;
  } catch (_) {
    return null;
  }
}

async function getTmdbTitle(tmdbId, type) {
  const endpoint = String(type || '').toLowerCase() === 'movie' ? 'movie' : 'tv';
  try {
    const response = await fetch(`https://api.themoviedb.org/3/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&language=it-IT`);
    if (!response.ok) return null;
    const payload = await response.json();
    return payload.title || payload.name || payload.original_title || payload.original_name || null;
  } catch (_) {
    return null;
  }
}

async function extractVidxgoIdFromPage(pageUrl, referer) {
  const html = await fetchText(pageUrl, referer ? { Referer: referer } : {});
  if (!html) return null;

  const imdbVar = html.match(/var\s+imdb\s*=\s*['"]tt(\d+)['"]/i);
  if (imdbVar) return imdbVar[1];

  const iframeSrc = html.match(/v\.vidxgo\.co\/(\d{4,12})/i);
  if (iframeSrc) return iframeSrc[1];

  return null;
}

async function buildVidxgoMirrorStream(streams, siteLabel, vidxgoNumericId, displayName, season, episode, refererPageUrl) {
  const normalizedTypeIsSeries = Number.isInteger(Number(season)) && Number(season) > 0 && Number(episode) > 0;
  const targetUrl = normalizedTypeIsSeries
    ? `https://v.vidxgo.co/${vidxgoNumericId}/${Number(season)}/${Number(episode)}`
    : `https://v.vidxgo.co/${vidxgoNumericId}`;

  const extracted = await extractVidxGo(targetUrl, 'https://v.vidxgo.co/');
  if (!extracted || !extracted.url) return false;

  const formatted = formatStream({
    name: siteLabel,
    title: displayName,
    url: extracted.url,
    easyProxySourceUrl: refererPageUrl || targetUrl,
    quality: '1080p',
    type: 'direct',
    language: 'Italian',
    headers: extracted.headers || null
  }, siteLabel);

  if (formatted) streams.push(formatted);
  return true;
}

module.exports = {
  TMDB_API_KEY,
  BROWSER_UA,
  fetchText,
  normalizeTitle,
  scoreSlugMatch,
  resolveTmdbId,
  getTmdbTitle,
  extractVidxgoIdFromPage,
  buildVidxgoMirrorStream
};
