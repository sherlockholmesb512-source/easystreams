const { USER_AGENT } = require('./common');
const { checkQualityFromPlaylist } = require('../quality_helper.js');

const VIXSRC_CONFIG_URL = 'https://raw.githubusercontent.com/realbestia1/domains/refs/heads/main/domains.json';
const VIXSRC_DEFAULT_BASE_URL = 'https://dancingmonkeyvideolover.xyz';
const VIXSRC_BASE_URL_OVERRIDE = String(
    (typeof process !== 'undefined' && process.env && process.env.VIXSRC_BASE_URL) || ''
).trim();

function normalizeVixsrcBaseUrl(value) {
    try {
        const parsed = new URL(String(value || '').trim());
        if (!/^https?:$/i.test(parsed.protocol) || !parsed.hostname) return null;
        return parsed.toString().replace(/\/+$/, '');
    } catch (_) {
        return null;
    }
}

let vixsrcBaseUrl = normalizeVixsrcBaseUrl(VIXSRC_BASE_URL_OVERRIDE) || VIXSRC_DEFAULT_BASE_URL;
let vixsrcMediaHost = new URL(vixsrcBaseUrl).hostname;
let vixsrcConfigLoaded = Boolean(VIXSRC_BASE_URL_OVERRIDE);
let vixsrcConfigPromise = null;

async function loadVixsrcConfig() {
    if (vixsrcConfigLoaded) return vixsrcBaseUrl;
    if (vixsrcConfigPromise) return await vixsrcConfigPromise;

    vixsrcConfigPromise = (async () => {
        let timeoutId = null;
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        try {
            if (controller) timeoutId = setTimeout(() => controller.abort(), 5000);
            const response = await fetch(VIXSRC_CONFIG_URL, {
                headers: { Accept: 'application/json' },
                ...(controller ? { signal: controller.signal } : {})
            });
            if (!response.ok) throw new Error(`Config HTTP ${response.status}`);
            const config = await response.json();
            const nextBaseUrl = normalizeVixsrcBaseUrl(config?.vixsrc);
            if (nextBaseUrl) {
                vixsrcBaseUrl = nextBaseUrl;
                vixsrcMediaHost = new URL(nextBaseUrl).hostname;
            }
        } catch (error) {
            console.warn(`[VixCloud] Vixsrc config unavailable, using fallback: ${error.message}`);
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
            vixsrcConfigLoaded = true;
            vixsrcConfigPromise = null;
        }
        return vixsrcBaseUrl;
    })();

    return await vixsrcConfigPromise;
}

function rewriteVixsrcHost(value) {
    return String(value || '')
        .replace(/vixcloud\.co/gi, vixsrcMediaHost)
        .replace(/vixsrc\.to/gi, vixsrcMediaHost);
}

async function extractVixCloud(url) {
    try {
        await loadVixsrcConfig();
        const fixedUrl = rewriteVixsrcHost(url);
        const vixsrcReferer = rewriteVixsrcHost('https://vixcloud.co/');
        const response = await fetch(fixedUrl, {
            headers: {
                "User-Agent": USER_AGENT,
                "Referer": vixsrcReferer
            }
        });

        if (!response.ok) return null;
        const html = await response.text();

        const streams = [];


        const tokenRegex = /'token':\s*'(\w+)'/;
        const expiresRegex = /'expires':\s*'(\d+)'/;
        const urlRegex = /url:\s*'([^']+)'/;
        const fhdRegex = /window\.canPlayFHD\s*=\s*true/;

        const tokenMatch = tokenRegex.exec(html);
        const expiresMatch = expiresRegex.exec(html);
        const urlMatch = urlRegex.exec(html);
        const fhdMatch = fhdRegex.test(html);

        if (tokenMatch && expiresMatch && urlMatch) {
            const token = tokenMatch[1];
            const expires = expiresMatch[1];
            let serverUrl = urlMatch[1];

            let finalUrl = "";
            if (serverUrl.includes("?b=1")) {
                finalUrl = `${serverUrl}&token=${token}&expires=${expires}`;
            } else {
                finalUrl = `${serverUrl}?token=${token}&expires=${expires}`;
            }

            if (fhdMatch) {
                finalUrl += "&h=1";
            }

            const parts = finalUrl.split('?');
            finalUrl = parts[0] + '.m3u8';
            if (parts.length > 1) {
                finalUrl += '?' + parts.slice(1).join('?');
            }

            let quality = "1080p";
            const streamUrl = rewriteVixsrcHost(finalUrl);
            const detectedQuality = await checkQualityFromPlaylist(streamUrl, {
                "User-Agent": USER_AGENT,
                "Referer": vixsrcReferer
            });
            if (detectedQuality) quality = detectedQuality;

            streams.push({
                url: streamUrl,
                quality: quality,
                type: "m3u8",
                headers: {
                    "User-Agent": USER_AGENT,
                    "Referer": vixsrcReferer
                }
            });
        }

        return streams;

    } catch (e) {
        console.error("[VixCloud] Extraction error:", e);
        return [];
    }
}

module.exports = { extractVixCloud, rewriteVixsrcHost };
