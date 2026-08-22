const {
  fetchText,
  scoreSlugMatch,
  resolveTmdbId,
  getTmdbTitle,
  extractVidxgoIdFromPage,
  buildVidxgoMirrorStream
} = require('../mirrorvidxgo/shared.js');

const SITE_BASE = 'https://altadefinizionex.one';
const SITE_LABEL = 'AltadefinizioneX';

async function searchCandidates(title) {
  const html = await fetchText(`${SITE_BASE}/search?q=${encodeURIComponent(title)}`, {
    Referer: `${SITE_BASE}/`,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  });
  if (!html) return [];
  const results = [];
  const seen = new Set();
  const regex = /href="\/[a-z-]+\/(\d+)-([a-z0-9-]+?)-streaming\.html"/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const key = m[1];
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ id: m[1], slug: m[2], pageUrl: `${SITE_BASE}/${m[1]}-${m[2]}-streaming.html` });
    if (results.length >= 8) break;
  }
  return results;
}

async function getStreams(id, type, season, episode, providerContext = null) {
  const normalizedType = String(type || '').toLowerCase() === 'movie' ? 'movie' : 'tv';
  const tmdbId = await resolveTmdbId(id, normalizedType, providerContext);
  if (!tmdbId) return [];

  const title = await getTmdbTitle(tmdbId, normalizedType);
  if (!title) return [];

  const candidates = await searchCandidates(title);
  if (!candidates.length) return [];

  candidates.sort((a, b) => scoreSlugMatch(title, b.slug) - scoreSlugMatch(title, a.slug));
  const best = candidates.find((c) => scoreSlugMatch(title, c.slug) >= 50);
  if (!best) return [];

  const vidxgoId = await extractVidxgoIdFromPage(best.pageUrl, `${SITE_BASE}/`);
  if (!vidxgoId) return [];

  const displayName = normalizedType === 'movie' ? title : `${title} ${season || 1}x${episode || 1}`;
  const streams = [];
  await buildVidxgoMirrorStream(streams, SITE_LABEL, vidxgoId, displayName, normalizedType === 'movie' ? null : Number(season) || 1, Number(episode) || 1, best.pageUrl);
  return streams.filter(Boolean);
}

module.exports = { getStreams };
