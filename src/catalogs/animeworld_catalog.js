const ANIMEWORLD_BASE_URL = 'https://www.animeworld.ac';
const TMDB_API_KEY = '7039c79558d9a2c4fa1a63219272dc84';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const PAGE_TTL_MS = 10 * 60 * 1000;
const TMDB_SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
const TMDB_FAILURE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15 * 1000;

const pageCaches = new Map();
const tmdbCache = new Map();
const tmdbPending = new Map();

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

async function fetchPage(url, cacheKey) {
  const cached = pageCaches.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.at < PAGE_TTL_MS) {
    return cached.html;
  }

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'it-IT,it;q=0.9',
      Referer: `${ANIMEWORLD_BASE_URL}/`
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  pageCaches.set(cacheKey, { at: now, html });
  return html;
}

async function fetchAnimeworldHome() {
  return fetchPage(`${ANIMEWORLD_BASE_URL}/`, 'home');
}

async function mapLimit(list, limit, worker) {
  const results = new Array(list.length);
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (index < list.length) {
      const current = index++;
      try {
        results[current] = await worker(list[current], current);
      } catch (error) {
        results[current] = null;
      }
    }
  });
  await Promise.all(runners);
  return results;
}

function detectFilterMaxPage(html) {
  const match = String(html || '').match(/paginationMaxPage\s*=\s*parseInt\("(\d+)"\)/);
  const parsed = match ? parseInt(match[1], 10) : 1;
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 60) : 1;
}

async function fetchAnimeworldFilter(kind) {
  const path = FILTER_URLS[kind];
  if (!path) return null;

  const cacheKey = `filter:${kind}`;
  const cached = pageCaches.get(cacheKey);
  if (cached && Date.now() - cached.at < PAGE_TTL_MS) {
    return cached.html;
  }

  const firstHtml = await fetchPage(`${ANIMEWORLD_BASE_URL}${path}`, `${cacheKey}:p1`);
  const maxPage = detectFilterMaxPage(firstHtml);

  const pageRequests = [];
  for (let p = 2; p <= maxPage; p++) {
    pageRequests.push({ url: `${ANIMEWORLD_BASE_URL}${path}&page=${p}`, key: `${cacheKey}:p${p}` });
  }

  const restHtmls = await mapLimit(pageRequests, 4, ({ url, key }) => fetchPage(url, key));
  const okPages = [firstHtml, ...restHtmls.filter(Boolean)];

  pageCaches.set(cacheKey, { at: Date.now(), html: okPages });
  return okPages;
}

async function fetchAnimeworldSchedule() {
  return fetchPage(`${ANIMEWORLD_BASE_URL}/schedule`, 'schedule');
}

const FILTER_URLS = {
  'aw-anime-ita': '/filter?status=1&language=it&sort=0',
  'aw-film-ita': '/filter?type=4&status=1&language=it&sort=0'
};

function parseFilterItems(html) {
  const pages = Array.isArray(html) ? html : [html];
  const items = [];
  const seen = new Set();

  for (const pageHtml of pages) {
    if (!pageHtml || typeof pageHtml !== 'string') continue;
    const chunkStart = pageHtml.indexOf('<div class="item">');
    if (chunkStart === -1) continue;

    let chunk = pageHtml.slice(chunkStart);
    const endMarker = chunk.indexOf('paging-container');
    if (endMarker !== -1) chunk = chunk.slice(0, endMarker);

    for (const block of chunk.split('<div class="item">').slice(1)) {
      const hrefMatch = block.match(/href="(\/play\/[^"]+|\/anime\/[^"]+)"/);
      const imgMatch = block.match(/<img[^>]*src="([^"]+)"/);
      let title = null;
      const nameMatch = block.match(/class="name"[^>]*>([^<]+)<\/a>/);
      if (nameMatch) {
        title = decodeHtmlEntities(nameMatch[1]);
      } else {
        const altMatch = block.match(/alt="([^"]+)"/);
        if (altMatch) title = decodeHtmlEntities(altMatch[1]);
      }
      if (!title || !hrefMatch) continue;

      const key = normalizeText(title);
      if (!key || seen.has(key)) continue;
      seen.add(key);

      items.push({
        title,
        url: hrefMatch[1].startsWith('http') ? hrefMatch[1] : `${ANIMEWORLD_BASE_URL}${hrefMatch[1]}`,
        poster: imgMatch ? imgMatch[1] : null
      });
    }
  }

  return items;
}

function getCurrentRomeWeekday() {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome',
    weekday: 'short'
  });
  const short = formatter.format(new Date()).toUpperCase();
  const map = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
  return Number.isInteger(map[short]) ? map[short] : new Date().getDay();
}

function parseLatestEpisodes(html) {
  const marker = html.indexOf('>Ultimi Episodi<');
  if (marker === -1) return [];

  let chunk = html.slice(marker);
  const nextSection = chunk.indexOf('<h2 class="title"', 20);
  if (nextSection !== -1) chunk = chunk.slice(0, nextSection);

  const items = [];
  const seen = new Set();
  for (const block of chunk.split('<div class="item">').slice(1)) {
    const hrefMatch = block.match(/href="([^"]+)"/);
    const epMatch = block.match(/class="ep">\s*Ep\.?\s*(\d+)\s*</i);
    const imgMatch = block.match(/<img[^>]*src="([^"]+)"/);
    if (!hrefMatch || !epMatch) continue;

    let title = null;
    const nameMatch = block.match(/class="name"[^>]*>([^<]+)<\/a>/);
    if (nameMatch) {
      title = decodeHtmlEntities(nameMatch[1]);
    } else {
      const titleAttr = block.match(/title="([^"]+)"/);
      if (titleAttr) {
        title = decodeHtmlEntities(titleAttr[1]).replace(/\s*Ep\.?\s*\d+\s*$/i, '').trim();
      }
    }
    if (!title) continue;

    const episode = Number.parseInt(epMatch[1], 10);
    if (!Number.isInteger(episode)) continue;

    const key = normalizeText(title);
    const existingIndex = items.findIndex((item) => item._key === key);
    if (existingIndex !== -1) {
      if (episode > items[existingIndex].episode) {
        items[existingIndex].episode = episode;
      }
      continue;
    }

    items.push({
      _key: key,
      title,
      episode,
      url: hrefMatch[1].startsWith('http') ? hrefMatch[1] : `${ANIMEWORLD_BASE_URL}${hrefMatch[1]}`,
      poster: imgMatch ? imgMatch[1] : null
    });
  }

  return items.map(({ _key, ...rest }) => rest);
}

function parseTodaySchedule(html) {
  const dayNames = ['DOMENICA', 'LUNEDI', 'MARTEDI', 'MERCOLEDI', 'GIOVEDI', 'VENERDI', 'SABATO'];
  const todayName = dayNames[getCurrentRomeWeekday()];
  const segments = html.split(/<span class="day-header">/).slice(1);

  let todaySegment = null;
  for (const segment of segments) {
    const endIndex = segment.indexOf('</span>');
    const rawDay = segment.slice(0, endIndex === -1 ? 40 : endIndex);
    if (normalizeText(rawDay).toUpperCase() === todayName) {
      todaySegment = segment;
      break;
    }
  }
  if (!todaySegment) return [];

  const items = [];
  for (const block of todaySegment.split('<div class="widget boxcalendario').slice(1)) {
    const linkMatch = block.match(/<a\s+href="(\/play\/[^"]+)"\s+title="([^"]+)"/);
    const epMatch = block.match(/episodio-calendario[^"]*">\s*(?:Episodio|Ep\.?)\s*(\d+)/i);
    if (!linkMatch || !epMatch) continue;

    const posterMatch = block.match(/background:\s*url\(([^)]+)\)/);
    const hourMatch = block.match(/class="hour">\s*([^<]*)</);
    const timeMatch = hourMatch ? hourMatch[1].match(/(\d{1,2}:\d{2})/) : null;

    const episode = Number.parseInt(epMatch[1], 10);
    if (!Number.isInteger(episode)) continue;

    items.push({
      title: decodeHtmlEntities(linkMatch[2]),
      episode,
      time: timeMatch ? timeMatch[1] : null,
      url: `${ANIMEWORLD_BASE_URL}${linkMatch[1]}`,
      poster: posterMatch ? posterMatch[1].replace(/['"]/g, '') : null
    });
  }

  return items;
}

function normalizeTitleForSearch(value) {
  return normalizeText(value)
    .replace(/\b(ita|sub\s*ita|dub\s*ita|sub|dub)\b/g, '')
    .replace(/\bseason\b|\bstagione\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchVariants(title) {
  const variants = new Set();
  const base = String(title || '').trim();
  if (!base) return [];
  const candidates = new Set([base]);
  const strippedParenthesis = base.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  if (strippedParenthesis) candidates.add(strippedParenthesis);
  const strippedSuffix = base.replace(/\s*[-–—]\s*(?:Sub|Dub)?\s*ITA\s*$/i, '').trim();
  if (strippedSuffix) candidates.add(strippedSuffix);
  for (const candidate of Array.from(candidates)) {
    const withoutNumber = candidate.replace(/\s+\d{1,2}$/, '').trim();
    if (withoutNumber && withoutNumber !== candidate) candidates.add(withoutNumber);
  }
  for (const candidate of candidates) variants.add(candidate);
  return Array.from(variants);
}

async function fetchJson(url, timeoutMs = 8000) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function pickBestTvResult(results, normalizedTitle) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const exact = results.find(
    (r) => r && typeof r.id === 'number' && normalizeText(r.name) === normalizedTitle
  );
  return (exact || results.find((r) => r && typeof r.id === 'number')) || null;
}

function computeTotalEpisodes(details) {
  if (!details || !Array.isArray(details.seasons)) return null;
  const numbered = details.seasons
    .filter((s) => Number.isInteger(s.season_number) && s.season_number > 0)
    .sort((a, b) => b.season_number - a.season_number);
  if (numbered.length === 0) return null;
  const todayIso = new Date().toISOString().slice(0, 10);
  const aired = numbered.find((s) => !s.air_date || s.air_date <= todayIso);
  const target = aired || numbered[0];
  if (Number.isInteger(target.episode_count) && target.episode_count > 0) {
    return target.episode_count;
  }
  const total = numbered.reduce((sum, s) => sum + (Number.isInteger(s.episode_count) ? s.episode_count : 0), 0);
  return total > 0 ? total : null;
}

async function resolveTmdbForTitle(title, tmdbType = 'tv') {
  const normalizedTitle = normalizeTitleForSearch(title);
  if (!normalizedTitle) return null;

  const cacheKey = `${tmdbType}:${normalizedTitle}`;
  const cached = tmdbCache.get(cacheKey);
  const now = Date.now();
  if (cached) {
    const ttl = cached.tmdbId ? TMDB_SUCCESS_TTL_MS : TMDB_FAILURE_TTL_MS;
    if (now - cached.at < ttl) {
      return cached.tmdbId ? cached.entry : null;
    }
  }

  if (tmdbPending.has(cacheKey)) {
    return tmdbPending.get(cacheKey);
  }

  const promise = (async () => {
    try {
      const searchEndpoint = tmdbType === 'movie' ? 'search/movie' : 'search/tv';
      const detailsEndpoint = tmdbType === 'movie' ? 'movie' : 'tv';
      let best = null;
      for (const variant of buildSearchVariants(title)) {
        const normalizedVariant = normalizeTitleForSearch(variant);
        if (!normalizedVariant) continue;
        const search = await fetchJson(
          `https://api.themoviedb.org/3/${searchEndpoint}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(variant)}&language=it-IT&include_adult=false`
        );
        best = pickBestTvResult(search.results, normalizedVariant);
        if (best) break;
      }
      if (!best) throw new Error('no-result');

      const details = await fetchJson(
        `https://api.themoviedb.org/3/${detailsEndpoint}/${best.id}?api_key=${TMDB_API_KEY}&language=it-IT`
      );
      const entry = {
        tmdbId: best.id,
        totalEpisodes: tmdbType === 'movie' ? null : computeTotalEpisodes(details)
      };
      tmdbCache.set(cacheKey, { at: Date.now(), tmdbId: entry.tmdbId, entry });
      return entry;
    } catch {
      tmdbCache.set(cacheKey, { at: Date.now(), tmdbId: null, entry: null });
      return null;
    } finally {
      tmdbPending.delete(cacheKey);
    }
  })();

  tmdbPending.set(cacheKey, promise);
  return promise;
}

const PAGE_KINDS = {
  home: { fetcher: fetchAnimeworldHome, tmdbType: 'tv' },
  schedule: { fetcher: fetchAnimeworldSchedule, tmdbType: 'tv' },
  'aw-anime-ita': { fetcher: () => fetchAnimeworldFilter('aw-anime-ita'), tmdbType: 'tv' },
  'aw-film-ita': { fetcher: () => fetchAnimeworldFilter('aw-film-ita'), tmdbType: 'movie' }
};

async function getCachedItems(kind, parser) {
  const cached = pageCaches.get(kind);
  const now = Date.now();
  if (cached && cached.items && now - cached.at < PAGE_TTL_MS) {
    return cached.items;
  }

  const kindConfig = PAGE_KINDS[kind];
  if (!kindConfig) return [];
  const html = await kindConfig.fetcher();
  const items = parser(html);

  const previous = pageCaches.get(`${kind}:items`);
  const enriched = await mapLimit(items, 10, async (item) => ({
    ...item,
    tmdb: await resolveTmdbForTitle(item.title, kindConfig.tmdbType)
  }));

  pageCaches.set(`${kind}:items`, { at: now, items: enriched.length ? enriched : (previous && previous.items) || [] });
  pageCaches.set(`${kind}:items:stale`, { at: now, items: enriched.length ? enriched : (previous && previous.items) || [] });
  return enriched.length ? enriched : (previous && previous.items) || [];
}

async function getLatestEpisodes() {
  return getCachedItems('home', parseLatestEpisodes);
}

async function getTodaySchedule() {
  return getCachedItems('schedule', parseTodaySchedule);
}

async function getAnimeItaliani() {
  return getCachedItems('aw-anime-ita', parseFilterItems);
}

async function getFilmAnimeItaliani() {
  return getCachedItems('aw-film-ita', parseFilterItems);
}

// ── TMDB Seasonal Top Anime ──────────────────────────────────────────────────
const TMDB_SEASON_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
async function getTopAnimeStagionali() {
  const cacheKey = 'tmdb:seasonal-top';
  const cached = pageCaches.get(cacheKey);
  if (cached && cached.items && Date.now() - cached.at < TMDB_SEASON_CACHE_TTL_MS) {
    return cached.items;
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  let season;
  if (month <= 3) season = 'winter';
  else if (month <= 6) season = 'spring';
  else if (month <= 9) season = 'summer';
  else season = 'fall';

  try {
    const url = `https://api.themoviedb.org/3/discover/tv?api_key=${TMDB_API_KEY}&with_genres=16&sort_by=popularity.desc&first_air_date_year=${year}&language=it-IT&page=1`;
    const data = await fetchJson(url);
    const results = (data.results || []).slice(0, 20);

    const items = results.map((r) => ({
      tmdbId: r.id,
      title: r.name || r.original_name,
      poster: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null,
      backdrop: r.backdrop_path ? `https://image.tmdb.org/t/p/w780${r.backdrop_path}` : null,
      description: r.overview || '',
      rating: r.vote_average || 0,
      year: r.first_air_date ? r.first_air_date.slice(0, 4) : '',
      season
    }));

    pageCaches.set(cacheKey, { at: Date.now(), items });
    return items;
  } catch (e) {
    console.error('[Catalog] TMDB seasonal error:', e.message);
    return cached?.items || [];
  }
}

// ── AnimeWorld Genre Catalog ─────────────────────────────────────────────────
const GENRE_MAP = {
  'action': 1, 'avventura': 2, 'commedia': 4, 'drammatico': 7,
  'fantasy': 14, 'horror': 15, 'romantico': 22, 'sci-fi': 24, 'thriller': 27
};
const GENRE_CACHE_TTL_MS = 30 * 60 * 1000;

async function getAnimeByGenre(genreKey) {
  const genreId = GENRE_MAP[genreKey];
  if (!genreId) return [];

  const cacheKey = `aw-genre:${genreKey}`;
  const cached = pageCaches.get(cacheKey);
  if (cached && cached.items && Date.now() - cached.at < GENRE_CACHE_TTL_MS) {
    return cached.items;
  }

  try {
    const path = `/filter?genre=${genreId}&sort=0`;
    const html = await fetchPage(`${ANIMEWORLD_BASE_URL}${path}`, cacheKey);
    const items = parseFilterItems(html);

    const enriched = await mapLimit(items.slice(0, 50), 10, async (item) => ({
      ...item,
      tmdb: await resolveTmdbForTitle(item.title, 'tv')
    }));

    const filtered = enriched.filter(Boolean);
    pageCaches.set(cacheKey, { at: Date.now(), items: filtered.length ? filtered : (cached?.items || []) });
    return filtered.length ? filtered : (cached?.items || []);
  } catch (e) {
    console.error(`[Catalog] Genre ${genreKey} error:`, e.message);
    return cached?.items || [];
  }
}

// ── Weekly Schedule (full week) ──────────────────────────────────────────────
const WEEK_CACHE_TTL_MS = 30 * 60 * 1000;
async function getWeeklySchedule() {
  const cacheKey = 'aw:weekly-schedule';
  const cached = pageCaches.get(cacheKey);
  if (cached && cached.items && Date.now() - cached.at < WEEK_CACHE_TTL_MS) {
    return cached.items;
  }

  try {
    const html = await fetchAnimeworldSchedule();
    const dayNames = ['DOMENICA', 'LUNEDI', 'MARTEDI', 'MERCOLEDI', 'GIOVEDI', 'VENERDI', 'SABATO'];
    const segments = html.split(/<span class="day-header">/).slice(1);

    const allItems = [];
    const seen = new Set();

    for (let dayIdx = 0; dayIdx < dayNames.length; dayIdx++) {
      let segment = null;
      for (const seg of segments) {
        const endIdx = seg.indexOf('</span>');
        const rawDay = seg.slice(0, endIdx === -1 ? 40 : endIdx);
        if (normalizeText(rawDay).toUpperCase() === dayNames[dayIdx]) {
          segment = seg;
          break;
        }
      }
      if (!segment) continue;

      for (const block of segment.split('<div class="widget boxcalendario').slice(1)) {
        const linkMatch = block.match(/<a\s+href="(\/play\/[^"]+)"\s+title="([^"]+)"/);
        const epMatch = block.match(/episodio-calendario[^"]*">\s*(?:Episodio|Ep\.?)\s*(\d+)/i);
        if (!linkMatch || !epMatch) continue;

        const posterMatch = block.match(/background:\s*url\(([^)]+)\)/);
        const hourMatch = block.match(/class="hour">\s*([^<]*)</);
        const timeMatch = hourMatch ? hourMatch[1].match(/(\d{1,2}:\d{2})/) : null;
        const episode = Number.parseInt(epMatch[1], 10);
        if (!Number.isInteger(episode)) continue;

        const key = `${normalizeText(decodeHtmlEntities(linkMatch[2]))}:${dayIdx}`;
        if (seen.has(key)) continue;
        seen.add(key);

        allItems.push({
          title: decodeHtmlEntities(linkMatch[2]),
          episode,
          day: dayNames[dayIdx],
          dayIndex: dayIdx,
          time: timeMatch ? timeMatch[1] : null,
          url: `${ANIMEWORLD_BASE_URL}${linkMatch[1]}`,
          poster: posterMatch ? posterMatch[1].replace(/['"]/g, '') : null
        });
      }
    }

    pageCaches.set(cacheKey, { at: Date.now(), items: allItems });

    const enriched = await mapLimit(allItems, 10, async (item) => ({
      ...item,
      tmdb: await resolveTmdbForTitle(item.title, 'tv')
    }));

    const result = enriched.filter(Boolean);
    pageCaches.set(cacheKey, { at: Date.now(), items: result.length ? result : allItems });
    return result.length ? result : allItems;
  } catch (e) {
    console.error('[Catalog] Weekly schedule error:', e.message);
    return cached?.items || [];
  }
}

module.exports = {
  getLatestEpisodes,
  getTodaySchedule,
  getAnimeItaliani,
  getFilmAnimeItaliani,
  getTopAnimeStagionali,
  getAnimeByGenre,
  getWeeklySchedule,
  GENRE_MAP
};
