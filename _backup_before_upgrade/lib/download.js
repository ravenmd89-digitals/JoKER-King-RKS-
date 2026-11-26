// Social/file downloaders. Each platform has a list of providers that are tried in order; the first one that
// returns a media link wins. Providers are public third-party services, so any of them can change or go down:
// when all of them fail the user gets a clear message instead of a fake result.
const cheerio = require('cheerio');
const { getJson, getText, headInfo, isHttpUrl, findUrl, why } = require('./net');
const { assertPublicUrl, firstUrl } = require('./safeUrl');
const { UserError } = require('./plugins');

const DC = 'https://apis.davidcyriltech.my.id'; // already used by the existing .song/.video commands
const enc = encodeURIComponent;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

const HOSTS = {
    tiktok: /(^|\.)(tiktok\.com)$/i,
    instagram: /(^|\.)(instagram\.com|instagr\.am)$/i,
    facebook: /(^|\.)(facebook\.com|fb\.watch|fb\.com)$/i,
    twitter: /(^|\.)(twitter\.com|x\.com)$/i,
    mediafire: /(^|\.)mediafire\.com$/i,
    youtube: /(^|\.)(youtube\.com|youtu\.be)$/i,
    pinterest: /(^|\.)(pinterest\.[a-z.]+|pin\.it)$/i,
    gdrive: /(^|\.)(drive\.google\.com|docs\.google\.com)$/i,
    github: /(^|\.)github\.com$/i,
};

/** Validate that the user's text contains a link for this platform; returns the link. */
async function linkFor(platform, text) {
    const link = firstUrl(text);
    if (!link) throw new UserError(`Please send a ${platform} link.`);
    const u = await assertPublicUrl(link);
    if (!HOSTS[platform].test(u.hostname)) throw new UserError(`That is not a ${platform} link.`);
    return u.href;
}

const EXT_KIND = { mp4: 'video', webm: 'video', mov: 'video', mkv: 'video', jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', mp3: 'audio', m4a: 'audio', ogg: 'audio', wav: 'audio', opus: 'audio' };
function kindOf(url, mime, fallback = 'video') {
    const ext = (String(url).split('?')[0].split('.').pop() || '').toLowerCase();
    if (EXT_KIND[ext]) return EXT_KIND[ext];
    if (mime) { if (mime.startsWith('video/')) return 'video'; if (mime.startsWith('image/')) return 'image'; if (mime.startsWith('audio/')) return 'audio'; }
    return fallback;
}

const viaDavid = (path) => async (url) => {
    const d = await getJson(`${DC}${path}?url=${enc(url)}`, { timeout: 30000 });
    const u = findUrl(d && (d.result || d.data || d));
    if (!u) throw new Error('no link in response');
    return { items: [{ url: u }], title: d && d.result && d.result.title };
};

const viaRuhend = (names) => async (url) => {
    const rs = require('ruhend-scraper');
    for (const n of names) {
        if (typeof rs[n] !== 'function') continue;
        const res = await withTimeout(rs[n](url), 30000);
        const u = findUrl(res);
        if (u) return { items: [{ url: u }] };
    }
    throw new Error('ruhend-scraper has no usable function');
};

const PROVIDERS = {
    tiktok: [
        async (url) => {
            const d = await getJson(`https://www.tikwm.com/api/?url=${enc(url)}&hd=1`, { timeout: 25000 });
            const x = d && d.data; if (!x || d.code !== 0) throw new Error('tikwm refused');
            if (Array.isArray(x.images) && x.images.length) return { items: x.images.slice(0, 5).map((u) => ({ url: u, kind: 'image' })), title: x.title };
            const u = x.hdplay || x.play; if (!u) throw new Error('no video');
            return { items: [{ url: /^https?:/.test(u) ? u : `https://www.tikwm.com${u}`, kind: 'video' }], title: x.title };
        },
        viaDavid('/download/tiktok'), viaRuhend(['ttdl', 'tiktok']),
    ],
    instagram: [viaDavid('/instagram'), viaRuhend(['igdl', 'instagram'])],
    facebook: [viaDavid('/facebook'), viaRuhend(['fbdown', 'fbdl', 'facebook'])],
    twitter: [
        async (url) => {
            const m = url.match(/(?:twitter|x)\.com\/([^/]+)\/status\/(\d+)/i); if (!m) throw new Error('not a tweet link');
            const d = await getJson(`https://api.vxtwitter.com/${m[1]}/status/${m[2]}`, { timeout: 20000 });
            const media = d && (d.media_extended || []); if (!media.length) throw new Error('no media');
            return { items: media.slice(0, 4).map((x) => ({ url: x.url, kind: x.type === 'image' ? 'image' : 'video' })), title: d.text };
        },
        viaDavid('/twitter'), viaRuhend(['twitter', 'twdl']),
    ],
    mediafire: [
        async (url) => {
            const $ = cheerio.load(await getText(url));
            const btn = $('#downloadButton');
            let link = btn.attr('href'); const scr = btn.attr('data-scrambled-url');
            if (scr) link = Buffer.from(scr, 'base64').toString('utf8');
            if (!isHttpUrl(link)) throw new Error('download button not found');
            const name = ($('.dl-btn-label').attr('title') || decodeURIComponent(link.split('/').pop().split('?')[0]) || 'file').trim();
            return { items: [{ url: link, kind: 'document', fileName: name }], title: name };
        },
        viaDavid('/mediafire'), viaRuhend(['mediafire']),
    ],
    pinterest: [
        async (url) => {
            const $ = cheerio.load(await getText(url));
            const vid = $('meta[property="og:video"]').attr('content') || $('meta[name="twitter:player:stream"]').attr('content');
            const img = $('meta[property="og:image"]').attr('content');
            const u = vid || img; if (!isHttpUrl(u)) throw new Error('no media in page');
            return { items: [{ url: u.replace('/236x/', '/736x/'), kind: vid ? 'video' : 'image' }], title: $('meta[property="og:title"]').attr('content') };
        },
    ],
};

/** Try the providers of a platform in order. */
async function resolve(platform, url) {
    const errors = [];
    for (const provider of PROVIDERS[platform] || []) {
        try {
            const r = await provider(url);
            if (r && r.items && r.items.length) return r;
        } catch (e) { errors.push(why(e)); }
    }
    throw new UserError(`Could not download that ${platform} link. The link may be private/removed, or the download services are busy (${errors.slice(0, 2).join('; ') || 'no provider'}).`);
}

const MAX_SEND = 100 * 1024 * 1024;

/** Send resolved items to the chat with the right WhatsApp message type. */
async function sendItems(ctx, result, caption = '') {
    let sent = 0;
    for (const item of result.items.slice(0, 5)) {
        const info = await headInfo(item.url);
        if (info.size && info.size > MAX_SEND) { await ctx.reply(`⚠️ That file is larger than 100 MB, so here is the direct link:\n${item.url}`); sent++; continue; }
        // unknown type: social CDNs usually serve video; a known non-media type (pdf, zip, ...) is sent as a document
        const kind = item.kind || kindOf(item.url, info.mime, info.mime ? 'document' : 'video');
        const cap = (sent === 0 ? caption : '').slice(0, 900);
        try {
            if (kind === 'video') await ctx.send({ video: { url: item.url }, mimetype: 'video/mp4', caption: cap });
            else if (kind === 'image') await ctx.send({ image: { url: item.url }, caption: cap });
            else if (kind === 'audio') await ctx.send({ audio: { url: item.url }, mimetype: info.mime && info.mime.startsWith('audio/') ? info.mime : 'audio/mpeg' });
            else await ctx.send({ document: { url: item.url }, mimetype: info.mime || 'application/octet-stream', fileName: item.fileName || decodeURIComponent(item.url.split('?')[0].split('/').pop() || 'file'), caption: cap });
        } catch (e) {
            await ctx.reply(`⚠️ I could not upload that file to WhatsApp (${why(e)}). Direct link:\n${item.url}`);
        }
        sent++;
    }
}

// ---- YouTube (same service the existing .song/.video commands use) ----
async function ytLink(kind, url) {
    let last;
    for (let i = 0; i < 3; i++) {
        try {
            const d = await getJson(`${DC}/download/${kind}?url=${enc(url)}`, { timeout: 30000 });
            const u = (d && d.result && (d.result.download_url || d.result.downloadUrl || d.result.url)) || (d && (d.url || d.link));
            if (u) return { url: u, title: d && d.result && d.result.title };
        } catch (e) { last = e; }
        await wait(2000);
    }
    throw new UserError(`YouTube download service failed${last ? ` (${why(last)})` : ''}. Try again later.`);
}

async function ytFind(query) {
    const yts = require('yt-search');
    const { videos } = await yts(query);
    if (!videos || !videos.length) throw new UserError('No YouTube results found.');
    return videos[0];
}

module.exports = { linkFor, resolve, sendItems, kindOf, ytLink, ytFind, HOSTS, DC };
