var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// src/extractors/vidxgo.js
var require_vidxgo = __commonJS({
  "src/extractors/vidxgo.js"(exports2, module2) {
    var VIDXGO_HEADERS = {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-GPC": "1",
      "Alt-Used": "v.vidxgo.co",
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "iframe",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
      "DNT": "1",
      "Priority": "u=0, i"
    };
    function xorDecrypt(b64, key) {
      const decoded = Buffer.from(b64, "base64");
      const result = Buffer.alloc(decoded.length);
      for (let i = 0; i < decoded.length; i++) {
        result[i] = decoded[i] ^ key.charCodeAt(i % key.length);
      }
      return result.toString("utf-8");
    }
    var XOR_PATTERN = /var\s+\w+\s*=\s*'([\w]+)'\s*,?\s*d\s*=\s*atob\s*\(\s*'([A-Za-z0-9+/=]+)'\s*\)/g;
    var CURRENT_SRC_PATTERN = /\bcurrentSrc\s*=\s*["'](https?:[^"']+?\.m3u8[^"']*)["']/;
    var CORRUPT_PLAYER_PATTERN = /player-container[^>]*\bcorrupt\b/i;
    function extractVidxGo(url, referer = "https://v.vidxgo.co/") {
      return __async(this, null, function* () {
        try {
          if (url.startsWith("//")) url = "https:" + url;
          const headers = __spreadProps(__spreadValues({}, VIDXGO_HEADERS), { "Referer": referer });
          const resp = yield fetch(url, { headers, redirect: "follow" });
          if (!resp.ok) {
            console.warn("[VidxGo] HTTP", resp.status, "for", url);
            return null;
          }
          const html = yield resp.text();
          let match;
          XOR_PATTERN.lastIndex = 0;
          while ((match = XOR_PATTERN.exec(html)) !== null) {
            try {
              const decrypted = xorDecrypt(match[2], match[1]);
              const streamMatch = decrypted.match(CURRENT_SRC_PATTERN);
              if (streamMatch) {
                const streamUrl = streamMatch[1].replace(/\\/g, "");
                const vidxgoOrigin = new URL(url).origin;
                return {
                  url: streamUrl,
                  headers: {
                    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0",
                    "Referer": url,
                    "Origin": vidxgoOrigin,
                    "Accept": "*/*",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Sec-GPC": "1",
                    "Sec-Fetch-Dest": "empty",
                    "Sec-Fetch-Mode": "cors",
                    "Sec-Fetch-Site": "cross-site",
                    "DNT": "1",
                    "Priority": "u=0"
                  }
                };
              }
            } catch (e) {
              continue;
            }
          }
          if (CORRUPT_PLAYER_PATTERN.test(html)) {
            console.warn("[VidxGo] Source is marked corrupt or not available");
            return null;
          }
          console.warn("[VidxGo] No stream URL found in page");
          return null;
        } catch (e) {
          console.error("[VidxGo] Extraction error:", e);
          return null;
        }
      });
    }
    module2.exports = { extractVidxGo, VIDXGO_HEADERS, CORRUPT_PLAYER_PATTERN };
  }
});

// src/formatter.js
var require_formatter = __commonJS({
  "src/formatter.js"(exports2, module2) {
    function normalizePlaybackHeaders(headers) {
      if (!headers || typeof headers !== "object") return headers;
      const normalized = {};
      for (const [key, value] of Object.entries(headers)) {
        if (value == null) continue;
        const lowerKey = String(key).toLowerCase();
        if (lowerKey === "user-agent") normalized["User-Agent"] = value;
        else if (lowerKey === "referer" || lowerKey === "referrer") normalized["Referer"] = value;
        else if (lowerKey === "origin") normalized["Origin"] = value;
        else if (lowerKey === "accept") normalized["Accept"] = value;
        else if (lowerKey === "accept-language") normalized["Accept-Language"] = value;
        else normalized[key] = value;
      }
      return normalized;
    }
    function shouldForceNotWebReadyForPlugin(stream, providerName, headers, behaviorHints) {
      const text = [
        stream == null ? void 0 : stream.url,
        stream == null ? void 0 : stream.name,
        stream == null ? void 0 : stream.title,
        stream == null ? void 0 : stream.server,
        providerName
      ].filter(Boolean).join(" ").toLowerCase();
      if (text.includes("loadm") || text.includes("loadm.cam") || text.includes("mixdrop") || text.includes("mxcontent")) {
        return true;
      }
      return false;
    }
    function normalizeProviderId(providerName) {
      const normalized = String(providerName || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
      return normalized || void 0;
    }
    function normalizeEpisodeTemplate(value) {
      return String(value || "").replace(
        /\b(\d{1,3})[xX](\d{1,3})\b/g,
        (_, season, episode) => `S${season.padStart(2, "0")}E${episode.padStart(2, "0")}`
      ).replace(
        /\bS(\d{1,3})\s*E(\d{1,3})\b/gi,
        (_, season, episode) => `S${season.padStart(2, "0")}E${episode.padStart(2, "0")}`
      );
    }
    function formatStream(stream, providerName) {
      let quality = stream.quality || "";
      if (quality === "2160p") quality = "\u{1F525}4K UHD";
      else if (quality === "1440p") quality = "\u2728 QHD";
      else if (quality === "1080p") quality = "\u{1F680} FHD";
      else if (quality === "720p") quality = "\u{1F4BF} HD";
      else if (quality === "576p" || quality === "480p" || quality === "360p" || quality === "240p") quality = "\u{1F4A9} Low Quality";
      else if (!quality || ["auto", "unknown", "unknow"].includes(String(quality).toLowerCase())) quality = "\u{1F4BF} HD";
      const normalizedTitle = normalizeEpisodeTemplate(stream.title || "Stream");
      let title = `\u{1F4C1} ${normalizedTitle}`;
      let language = stream.language;
      if (language === "Italian") {
        language = "\u{1F1EE}\u{1F1F9}";
      } else if (stream.name && (stream.name.includes("SUB ITA") || stream.name.includes("SUB"))) {
        language = "\u{1F1EF}\u{1F1F5} \u{1F1EE}\u{1F1F9}";
      } else if (normalizedTitle.includes("SUB ITA") || normalizedTitle.includes("SUB")) {
        language = "\u{1F1EF}\u{1F1F5} \u{1F1EE}\u{1F1F9}";
      } else if (language === void 0 || language === null) {
        language = "";
      }
      let details = [];
      if (stream.size) details.push(`\u{1F4E6} ${stream.size}`);
      const desc = details.join(" | ");
      let pName = stream.name || stream.server || providerName;
      if (pName) {
        pName = pName.replace(/\s*\[?\(?\s*SUB\s*ITA\s*\)?\]?/i, "").replace(/\s*\[?\(?\s*ITA\s*\)?\]?/i, "").replace(/\s*\[?\(?\s*SUB\s*\)?\]?/i, "").replace(/\(\s*\)/g, "").replace(/\[\s*\]/g, "").trim();
      }
      if (pName === providerName) {
        pName = pName.charAt(0).toUpperCase() + pName.slice(1);
      }
      if (pName) {
        pName = `\u{1F4E1} ${pName}`;
      }
      const behaviorHints = stream.behaviorHints && typeof stream.behaviorHints === "object" ? __spreadValues({}, stream.behaviorHints) : {};
      let finalHeaders = stream.headers;
      if (behaviorHints.proxyHeaders && behaviorHints.proxyHeaders.request) {
        finalHeaders = behaviorHints.proxyHeaders.request;
      } else if (behaviorHints.headers) {
        finalHeaders = behaviorHints.headers;
      }
      finalHeaders = normalizePlaybackHeaders(finalHeaders);
      const isStreamingCommunityProvider = String(providerName || "").toLowerCase() === "streamingcommunity" || String((stream == null ? void 0 : stream.name) || "").toLowerCase().includes("streamingcommunity");
      if (isStreamingCommunityProvider && !finalHeaders) {
        delete behaviorHints.proxyHeaders;
        delete behaviorHints.headers;
        delete behaviorHints.notWebReady;
      }
      if (finalHeaders) {
        behaviorHints.proxyHeaders = behaviorHints.proxyHeaders || {};
        behaviorHints.proxyHeaders.request = finalHeaders;
        behaviorHints.headers = finalHeaders;
      }
      const providerExplicitNotWebReady = stream.behaviorHints && "notWebReady" in stream.behaviorHints;
      const shouldForceNotWebReady = shouldForceNotWebReadyForPlugin(stream, providerName, finalHeaders, behaviorHints);
      if (!isStreamingCommunityProvider && shouldForceNotWebReady) {
        behaviorHints.notWebReady = true;
      } else if (!providerExplicitNotWebReady) {
        delete behaviorHints.notWebReady;
      }
      const finalName = pName;
      let finalTitle = `\u{1F4C1} ${normalizedTitle}`;
      if (desc) finalTitle += ` | ${desc}`;
      if (language) finalTitle += ` | ${language}`;
      const playbackReferer = stream.referer || (finalHeaders == null ? void 0 : finalHeaders.Referer) || (finalHeaders == null ? void 0 : finalHeaders.referer);
      const playbackUserAgent = stream.userAgent || (finalHeaders == null ? void 0 : finalHeaders["User-Agent"]) || (finalHeaders == null ? void 0 : finalHeaders["user-agent"]);
      return __spreadProps(__spreadValues({}, stream), {
        // Keep original properties
        name: finalName,
        title: finalTitle,
        // Metadata for Stremio UI reconstruction (safer names for RN)
        providerName: pName,
        qualityTag: quality,
        description: desc,
        originalTitle: normalizedTitle,
        // Ensure language is set for Stremio/Nuvio sorting
        language,
        // Mark as formatted
        _nuvio_formatted: true,
        behaviorHints,
        provider: stream.provider || normalizeProviderId(providerName),
        referer: playbackReferer,
        userAgent: playbackUserAgent,
        // Explicitly ensure root headers are preserved for Nuvio
        headers: finalHeaders
      });
    }
    module2.exports = { formatStream };
  }
});

// src/mirrorvidxgo/shared.js
var require_shared = __commonJS({
  "src/mirrorvidxgo/shared.js"(exports2, module2) {
    var { extractVidxGo } = require_vidxgo();
    var { formatStream } = require_formatter();
    var TMDB_API_KEY = "7039c79558d9a2c4fa1a63219272dc84";
    var BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
    var SLUG_NOISE_WORDS = /* @__PURE__ */ new Set(["guarda", "streaming", "online", "ita", "italiano", "gratis", "hd", "cb01", "cb", "film", "serie", "tv", "the", "altadefinizione"]);
    function normalizeTitle(value) {
      return String(value || "").toLowerCase().replace(/&[a-z]+;|&#\d+;/g, " ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    }
    function slugTokens(slug) {
      const cleaned = String(slug || "").replace(/-\d+x\d+.*$/i, "").replace(/-(?:streaming|hd|cb01|ita|online)+(-|$)/gi, "$1");
      return normalizeTitle(cleaned).split(" ").filter((token) => token.length > 1 && !SLUG_NOISE_WORDS.has(token));
    }
    function scoreSlugMatch2(title, slug) {
      const titleNorm = normalizeTitle(title);
      if (!titleNorm) return 0;
      const tokens = slugTokens(slug);
      if (!tokens.length) return 0;
      const slugJoined = tokens.join(" ");
      if (slugJoined === titleNorm) return 100;
      const titleParts = titleNorm.split(" ");
      let hits = 0;
      for (const token of tokens) {
        if (titleParts.some((part) => part.length > 2 && (part === token || token.startsWith(part) || part.startsWith(token)))) {
          hits += 1;
        }
      }
      const ratio = hits / Math.max(tokens.length, titleParts.length);
      return Math.round(ratio * 90);
    }
    function fetchText2(_0) {
      return __async(this, arguments, function* (url, headers = {}, timeoutMs = 15e3) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = yield fetch(url, {
            headers: __spreadValues({ "User-Agent": BROWSER_UA, "Accept-Language": "it-IT,it;q=0.9,en;q=0.8" }, headers),
            signal: controller.signal,
            redirect: "follow"
          });
          if (!response.ok) return null;
          return yield response.text();
        } catch (_) {
          return null;
        } finally {
          clearTimeout(timer);
        }
      });
    }
    function resolveTmdbId2(id, type, providerContext = null) {
      return __async(this, null, function* () {
        var _a, _b, _c, _d, _e, _f;
        const contextTmdbId = providerContext && /^\d+$/.test(String(providerContext.tmdbId || "")) ? String(providerContext.tmdbId) : null;
        if (contextTmdbId) return contextTmdbId;
        const idStr = String(id || "").trim().replace(/^tmdb:/i, "");
        if (/^\d+$/.test(idStr)) return idStr;
        const contextImdbId = providerContext && /^tt\d+$/i.test(String(providerContext.imdbId || "")) ? String(providerContext.imdbId) : null;
        const imdbId = /^tt\d+$/i.test(idStr) ? idStr : contextImdbId;
        if (!imdbId) return null;
        const endpoint = String(type || "").toLowerCase() === "movie" ? "movie" : "tv";
        try {
          const response = yield fetch(`https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
          if (!response.ok) return null;
          const payload = yield response.json();
          if (endpoint === "movie" && ((_b = (_a = payload.movie_results) == null ? void 0 : _a[0]) == null ? void 0 : _b.id)) return String(payload.movie_results[0].id);
          if ((_d = (_c = payload.tv_results) == null ? void 0 : _c[0]) == null ? void 0 : _d.id) return String(payload.tv_results[0].id);
          if ((_f = (_e = payload.movie_results) == null ? void 0 : _e[0]) == null ? void 0 : _f.id) return String(payload.movie_results[0].id);
          return null;
        } catch (_) {
          return null;
        }
      });
    }
    function getTmdbTitle2(tmdbId, type) {
      return __async(this, null, function* () {
        const endpoint = String(type || "").toLowerCase() === "movie" ? "movie" : "tv";
        try {
          const response = yield fetch(`https://api.themoviedb.org/3/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&language=it-IT`);
          if (!response.ok) return null;
          const payload = yield response.json();
          return payload.title || payload.name || payload.original_title || payload.original_name || null;
        } catch (_) {
          return null;
        }
      });
    }
    function extractVidxgoIdFromPage2(pageUrl, referer) {
      return __async(this, null, function* () {
        const html = yield fetchText2(pageUrl, referer ? { Referer: referer } : {});
        if (!html) return null;
        const imdbVar = html.match(/var\s+imdb\s*=\s*['"]tt(\d+)['"]/i);
        if (imdbVar) return imdbVar[1];
        const iframeSrc = html.match(/v\.vidxgo\.co\/(\d{4,12})/i);
        if (iframeSrc) return iframeSrc[1];
        return null;
      });
    }
    function buildVidxgoMirrorStream2(streams, siteLabel, vidxgoNumericId, displayName, season, episode, refererPageUrl) {
      return __async(this, null, function* () {
        const normalizedTypeIsSeries = Number.isInteger(Number(season)) && Number(season) > 0 && Number(episode) > 0;
        const targetUrl = normalizedTypeIsSeries ? `https://v.vidxgo.co/${vidxgoNumericId}/${Number(season)}/${Number(episode)}` : `https://v.vidxgo.co/${vidxgoNumericId}`;
        const extracted = yield extractVidxGo(targetUrl, "https://v.vidxgo.co/");
        if (!extracted || !extracted.url) return false;
        const formatted = formatStream({
          name: siteLabel,
          title: displayName,
          url: extracted.url,
          easyProxySourceUrl: refererPageUrl || targetUrl,
          quality: "1080p",
          type: "direct",
          language: "Italian",
          headers: extracted.headers || null
        }, siteLabel);
        if (formatted) streams.push(formatted);
        return true;
      });
    }
    module2.exports = {
      TMDB_API_KEY,
      BROWSER_UA,
      fetchText: fetchText2,
      normalizeTitle,
      scoreSlugMatch: scoreSlugMatch2,
      resolveTmdbId: resolveTmdbId2,
      getTmdbTitle: getTmdbTitle2,
      extractVidxgoIdFromPage: extractVidxgoIdFromPage2,
      buildVidxgoMirrorStream: buildVidxgoMirrorStream2
    };
  }
});

// src/casacinema/index.js
var {
  fetchText,
  scoreSlugMatch,
  resolveTmdbId,
  getTmdbTitle,
  extractVidxgoIdFromPage,
  buildVidxgoMirrorStream
} = require_shared();
var SITE_BASE = "https://casa-cinema.surf";
var SITE_LABEL = "CasaCinema";
function searchCandidates(title) {
  return __async(this, null, function* () {
    const html = yield fetchText(`${SITE_BASE}/index.php?do=search&subaction=search&story=${encodeURIComponent(title)}`, {
      Referer: `${SITE_BASE}/`,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    });
    if (!html) return [];
    const results = [];
    const seen = /* @__PURE__ */ new Set();
    const regex = /href="https?:\/\/casa-cinema\.surf\/(?:gratis|serie-tv)\/(\d+)-([a-z0-9-]+?)\.html"/gi;
    let m;
    while ((m = regex.exec(html)) !== null) {
      const key = m[1];
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ id: m[1], slug: m[2], pageUrl: `${SITE_BASE}/gratis/${m[1]}-${m[2]}.html` });
      if (results.length >= 8) break;
    }
    return results;
  });
}
function getStreams(id, type, season, episode, providerContext = null) {
  return __async(this, null, function* () {
    const normalizedType = String(type || "").toLowerCase() === "movie" ? "movie" : "tv";
    const tmdbId = yield resolveTmdbId(id, normalizedType, providerContext);
    if (!tmdbId) return [];
    const title = yield getTmdbTitle(tmdbId, normalizedType);
    if (!title) return [];
    const candidates = yield searchCandidates(title);
    if (!candidates.length) return [];
    candidates.sort((a, b) => scoreSlugMatch(title, b.slug) - scoreSlugMatch(title, a.slug));
    const best = candidates.find((c) => scoreSlugMatch(title, c.slug) >= 50);
    if (!best) return [];
    const vidxgoId = yield extractVidxgoIdFromPage(best.pageUrl, `${SITE_BASE}/`);
    if (!vidxgoId) return [];
    const displayName = normalizedType === "movie" ? title : `${title} ${season || 1}x${episode || 1}`;
    const streams = [];
    yield buildVidxgoMirrorStream(streams, SITE_LABEL, vidxgoId, displayName, normalizedType === "movie" ? null : Number(season) || 1, Number(episode) || 1, best.pageUrl);
    return streams.filter(Boolean);
  });
}
module.exports = { getStreams };
