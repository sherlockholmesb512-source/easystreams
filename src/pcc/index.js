const { formatStream } = require('../formatter.js');

const BASE_URL = 'https://www.partite.cc';
const TMDB_API_KEY = '7039c79558d9a2c4fa1a63219272dc84';
const MAPPING_URL = 'https://animemapping.realbestia.com';

const siteEpisodeCache = new Map();
const SITE_CACHE_TTL = 10 * 60 * 1000;

function imdb(value) {
  const match = String(value || '').match(/tt\d+/i);
  return match ? match[0] : null;
}

function parsePositiveInt(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function fetchAnimeMapping(provider, externalId, season, episode) {
  try {
    const query = new URLSearchParams({ ep: String(episode || 1), lang: 'it' });
    if (season != null && Number.parseInt(season, 10) > 0) query.set('s', String(season));
    const r = await fetch(`${MAPPING_URL}/${provider}/${externalId}?${query}`);
    if (!r.ok) return null;
    const payload = await r.json();
    const tmdbEp = payload?.mappings?.tmdb_episode || payload?.tmdb_episode;
    return {
      imdbId: imdb(payload?.mappings?.ids?.imdb),
      season: parsePositiveInt(tmdbEp?.season),
      episode: parsePositiveInt(tmdbEp?.episode),
      rawEpisodeNumber: parsePositiveInt(tmdbEp?.rawEpisodeNumber)
    };
  } catch (_) {
    return null;
  }
}

async function getSiteEpisodeList(imdbId) {
  const cached = siteEpisodeCache.get(imdbId);
  if (cached && Date.now() - cached.at < SITE_CACHE_TTL) return cached.list;
  try {
    const r = await fetch(`${BASE_URL}/serie-tv/${imdbId}`);
    if (!r.ok) return null;
    const html = await r.text();
    const list = [];
    const regex = /\/hls\/s(\d+)\/serial\/[^/]+\/(\d+)\/(\d+)\/playlist\.m3u8/g;
    let m;
    while ((m = regex.exec(html)) !== null) {
      list.push({ server: Number(m[1]), season: Number(m[2]), episode: Number(m[3]) });
    }
    siteEpisodeCache.set(imdbId, { at: Date.now(), list });
    return list.length ? list : null;
  } catch (_) {
    return null;
  }
}

async function resolveImdbId(id, type, season, episode) {
  const raw = String(id || '').trim();
  const direct = imdb(raw);
  const movie = String(type || '').toLowerCase() === 'movie';

  if (movie) {
    if (direct) return { imdbId: direct };
    const match = raw.match(/^tmdb:(\d+)$/i) || raw.match(/^(\d+)$/);
    if (!match) return null;
    try {
      const r = await fetch(`https://api.themoviedb.org/3/movie/${match[1]}/external_ids?api_key=${TMDB_API_KEY}`);
      return r.ok ? { imdbId: imdb((await r.json()).imdb_id) } : null;
    } catch (_) {
      return null;
    }
  }

  const anime = raw.match(/^(kitsu|mal|anilist|anidb):(\d+)(?::(\d+))?$/i);
  if (anime) {
    const ep = anime[3] || episode || 1;
    const mapped = await fetchAnimeMapping(anime[1].toLowerCase(), anime[2], null, ep);
    if (!mapped?.imdbId) return null;
    return { ...mapped, rawEpisodeNumber: mapped.rawEpisodeNumber || ep };
  }

  if (direct) {
    const mapped = await fetchAnimeMapping('imdb', direct, season, episode);
    if (mapped?.imdbId && mapped.rawEpisodeNumber) return mapped;
    return { imdbId: direct, season: parsePositiveInt(season), episode: parsePositiveInt(episode) };
  }

  const match = raw.match(/^tmdb:(\d+)$/i) || raw.match(/^(\d+)$/);
  if (!match) return null;
  try {
    const r = await fetch(`https://api.themoviedb.org/3/tv/${match[1]}/external_ids?api_key=${TMDB_API_KEY}`);
    const imdbId = r.ok ? imdb((await r.json()).imdb_id) : null;
    if (!imdbId) return null;
    const mapped = await fetchAnimeMapping('imdb', imdbId, season, episode);
    if (mapped?.imdbId && mapped.rawEpisodeNumber) return mapped;
    return { imdbId, season: parsePositiveInt(season), episode: parsePositiveInt(episode) };
  } catch (_) {
    return null;
  }
}

async function getStreams(id, type, season, episode) {
  const animeEpisode = String(id || '').match(/^(?:kitsu|mal|anilist|anidb):\d+:(\d+)$/i);
  let s = Number.parseInt(season, 10) || 1;
  let e = Number.parseInt(animeEpisode?.[1] || episode, 10) || 1;

  const resolved = await resolveImdbId(id, type, s, e);
  const info = typeof resolved === 'string' ? { imdbId: resolved } : resolved;
  if (!info?.imdbId) return [];

  const finalImdbId = info.imdbId;
  const movie = String(type || '').toLowerCase() === 'movie';

  let siteSeason = null;
  let siteEpisode = null;
  let preferredServer = null;

  const mappedSeason = parsePositiveInt(info.season);
  const mappedEpisode = parsePositiveInt(info.episode);

  if (!movie && info.rawEpisodeNumber && !(mappedSeason > 0 && mappedEpisode > 0)) {
    // Absolute-numbered series without explicit season info: index the flat
    // episode list by raw episode number.
    const list = await getSiteEpisodeList(finalImdbId);
    const target = list?.[info.rawEpisodeNumber - 1];
    if (target) {
      siteSeason = target.season;
      siteEpisode = target.episode;
      preferredServer = target.server;
    }
  }

  if (siteSeason == null) {
    siteSeason = mappedSeason ?? s;
    siteEpisode = mappedEpisode ?? e;
  }

  let mediaTitle = 'Server';
  try {
    const r = await fetch(`https://api.themoviedb.org/3/find/${finalImdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
    if (r.ok) {
      const data = await r.json();
      const item = (movie ? data.movie_results : data.tv_results)?.[0];
      mediaTitle = item?.title || item?.name || mediaTitle;
    }
  } catch (_) {}

  const servers = [];
  if (preferredServer) servers.push(preferredServer);
  for (const server of [1, 2, 3, 4, 5]) if (!servers.includes(server)) servers.push(server);

  const streams = [];
  for (const server of servers) {
    const path = movie ? `/hls/s${server}/movie/${finalImdbId}` : `/hls/s${server}/serial/${finalImdbId}/${siteSeason}/${siteEpisode}`;
    const url = `${BASE_URL}${path}/playlist.m3u8`;
    try {
      const r = await fetch(url, { headers: { Referer: `${BASE_URL}/` } });
      if (r.ok) {
        const text = await r.text();
        const heights = [...text.matchAll(/RESOLUTION=\d+x(\d+)/gi)].map(m => Number(m[1])).filter(Boolean);
        const height = Math.max(0, ...heights);
        const quality = height >= 2160 ? '4K' : height >= 1440 ? '1440p' : height >= 1080 ? '1080p' : height >= 720 ? '720p' : height ? `${height}p` : 'Unknown';
        const hasItalianAudio = /#EXT-X-MEDIA:[^\r\n]*TYPE=AUDIO[^\r\n]*(?:LANGUAGE="(?:it|ita)"|NAME="(?:Italian|Italiano))/i.test(text);
        const hasAudio = /#EXT-X-MEDIA:[^\r\n]*TYPE=AUDIO/i.test(text);
        if (hasAudio) streams.push(formatStream({ name: `Server ${server}`, title: movie ? mediaTitle : `${mediaTitle} ${siteSeason}x${siteEpisode}`, quality, language: hasItalianAudio ? 'Italian' : '', type: 'hls', url, behaviorHints: { notWebReady: true, proxyHeaders: { request: { Referer: `${BASE_URL}/` } } } }, 'Partite.cc'));
      }
    } catch (_) {}
  }
  return streams.filter(Boolean);
}

module.exports = { getStreams };
