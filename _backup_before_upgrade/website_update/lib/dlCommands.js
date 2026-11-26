// Shared command builders/helpers for the DOWNLOAD category.
const dl = require('./download');
const { assertPublicUrl } = require('./safeUrl');
const { UserError } = require('./plugins');

const input = (ctx) => (ctx.text || ctx.quotedText || '').trim();

function platformCommand({ name, platform, desc }) {
    return {
        name, category: 'DOWNLOAD', desc, usage: `${name} <${platform} link>`, cooldown: 10,
        async run(ctx) {
            const text = input(ctx);
            if (!text) return ctx.reply(`Usage: ${ctx.prefix}${name} <${platform} link>`);
            const link = await dl.linkFor(platform, text);
            await ctx.react('⏳');
            const r = await dl.resolve(platform, link);
            await dl.sendItems(ctx, r, r.title ? String(r.title).slice(0, 300) : '');
        },
    };
}

const isUrl = (s) => /^https?:\/\//i.test(s);
async function youtubeTarget(text) {
    if (isUrl(text.split(/\s+/)[0])) {
        const u = await assertPublicUrl(text.split(/\s+/)[0]);
        if (!dl.HOSTS.youtube.test(u.hostname)) throw new UserError('That is not a YouTube link.');
        return { url: u.href, title: null, thumb: null, duration: null };
    }
    if (text.length > 120) throw new UserError('That search text is too long (max 120 characters).');
    const v = await dl.ytFind(text);
    return { url: v.url, title: v.title, thumb: v.thumbnail, duration: v.timestamp };
}

async function sendYoutube(ctx, kind, text, withCard) {
    const t = await youtubeTarget(text);
    await ctx.react('⏳');
    if (withCard && t.title) await ctx.send({ image: { url: t.thumb }, caption: `🎵 *${t.title}*\n⏱️ ${t.duration || ''}\n\n_Downloading…_` }).catch(() => {});
    const r = await dl.ytLink(kind, t.url);
    const title = r.title || t.title || 'YouTube';
    if (kind === 'ytmp3') {
        // Download, verify and re-encode the audio ourselves (see lib/audioTools.js) instead of handing WhatsApp a
        // raw remote URL - that used to produce the "0:00 duration / can't load this audio" error.
        const { prepareAudioMessage } = require('./audioTools');
        const audio = await prepareAudioMessage(r.url);
        await ctx.send({ audio: audio.buffer, mimetype: audio.mimetype, seconds: audio.seconds, ptt: audio.ptt, fileName: `${title}.mp3` });
    } else {
        await ctx.send({ video: { url: r.url }, mimetype: 'video/mp4', caption: `🎬 ${title}`.slice(0, 300) });
    }
}

module.exports = { platformCommand, youtubeTarget, sendYoutube, input, isUrl };
