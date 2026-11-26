const settings = require('../settings');
const runtime = require('../lib/runtime');

// Menu image (sent as a real WhatsApp image with the menu text as its caption).
const MENU_IMAGE = 'https://i.ibb.co/dJgGZQ0g/1cf5deea068a.jpg';

// ---------------------------------------------------------------------------
// Command catalogue = the ONE place that lists what the menu shows. Names are stored WITHOUT a prefix; the current
// prefix (runtime.getPrefix(), changed with .setprefix) is added when the menu is rendered.
// scripts/check-commands.js (and tests/menu-categories) verify that every name here is a real registered command
// or alias, and that every real command is listed exactly once somewhere. Nothing here is invented.
// ---------------------------------------------------------------------------
const CATEGORIES = [
    { id: 'info', emoji: '📂', title: 'BOT INFORMATION', desc: 'About this bot & how to use it',
        names: ['menu', 'help', 'owner', 'repo', 'source', 'report'] },
    { id: 'download', emoji: '📥', title: 'DOWNLOAD MENU', desc: 'Social media, files, music & video',
        names: ['twitter', 'xdl', 'mediafire', 'mfire', 'apk', 'app', 'apkdl', 'gdrive', 'download', 'dl',
            'facebook', 'fb', 'img', 'image', 'instagram', 'ig', 'pinterest', 'pin', 'play', 'spotify', 'gitclone', 'git',
            'github', 'ssweb', 'tiktok', 'tt', 'video', 'ytv', 'youtube', 'ytdl', 'webtozip', 'song', 'ytmp3', 'ytmp4'] },
    { id: 'ai', emoji: '🤖', title: 'AI MENU', desc: 'Chat with AI & generate images',
        names: ['ai', 'gpt', 'claude', 'deepseek', 'deep', 'gemini', 'texttoimage', 'aiimg', 'blackbox', 'islamai', 'islam', 'imagine', 'draw', 'proxabdullah'] },
    { id: 'group', emoji: '👥', title: 'GROUP MANAGEMENT', desc: 'For group admins: members & info',
        names: ['tagall', 'requestlist', 'acceptall', 'rejectall', 'leave', 'gali', 'goodbye', 'jid', 'info', 'admins'] },
    { id: 'admin', emoji: '🛡️', title: 'ADMIN MENU', desc: 'Group moderation (owner-only for now)',
        names: ['kick', 'add', 'promote', 'demote', 'mute', 'unmute', 'antilink', 'antibad', 'gc-setting', 'welcome'],
        usage: ['antilink delete on', 'antilink warn on', 'antilink kick on', 'antilink off'] },
    { id: 'tools', emoji: '📱', title: 'WHATSAPP TOOLS', desc: 'Stickers, view-once, converters & more',
        names: ['sticker', 's', 'toimage', 'toimg', 'voice', 'remini', 'removebg', 'rmbg', 'qrcode', 'define', 'weather',
            'binary', 'dbinary', 'base64', 'unbase64', 'upload', 'vv', 'tts', 'url', 'dp', 'roll', 'coinflip', 'pick', 'timenow', 'date', 'calculator', 'calc', 'time'] },
    { id: 'fun', emoji: '🎭', title: 'FUN MENU', desc: 'Reactions, games, jokes & moods',
        names: ['advice', 'angry', 'animekick', 'bacha', 'bachi', 'bite', 'blowkiss', 'blush', 'clap', 'confused', 'cry', 'flirt',
            'gaali', 'garl', 'hack', 'happy', 'heart', 'heartbreak', 'hot', 'moon', 'neko', 'poetry', 'quote', 'sad', 'shayari', 'shocked',
            'shoot', 'shy', 'sleep', 'smile', 'waifu', 'wave', 'wink', 'kiss', 'hug', 'love', 'slap', 'pat', 'highfive',
            'wife', 'ship', 'rate', 'roast', 'joke', 'fact', 'truth', 'dare', '8ball'] },
    { id: 'status', emoji: '📊', title: 'STATUS MENU', desc: "Check the bot's health & speed",
        names: ['ping', 'pong', 'alive', 'uptime', 'botstatus'] },
    { id: 'ownermenu', emoji: '👑', title: 'OWNER MENU', desc: 'Privileged owner-only actions',
        names: ['msg', 'send', 'save', 'vv2', 'pair', 'clonebot', 'getpair', 'restart'] },
    { id: 'settings', emoji: '⚙️', title: 'SETTINGS MENU', desc: 'Bot configuration (owner-only)',
        names: ['public', 'private', 'mode', 'setprefix', 'prefix', 'autoread', 'autolikestatus', 'als', 'autoviewstatus', 'avs',
            'alwaysonline', 'anticall', 'antidelete', 'antidel', 'autoreacts', 'autotype', 'autotyping', 'autorecording', 'autovoice', 'block', 'unblock', 'status'] },
    { id: 'other', emoji: '🧰', title: 'OTHER UTILITIES', desc: 'Text effects, search, Quran & more',
        names: ['neon', 'comic', 'dragon', 'silver', 'blackpink', 'glitch', 'glass', 'typography', 'naruto', 'neonglitch',
            'bear', 'futuristic', 'clouds', 'pubg', 'country', 'google', 'hotanime', 'movie', 'praytime', 'quran', 'quranmenu', 'search',
            'tiktoksearch', 'tiks', 'cid', 'fancy', 'count'] },
];

const commandNames = () => [...new Set(CATEGORIES.flatMap((c) => c.names))];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');

/** Pakistan time (Asia/Karachi, UTC+5, no daylight saving). */
function pkNow() {
    const d = new Date(Date.now() + 5 * 3600 * 1000);
    const hour24 = d.getUTCHours();
    return { hour24, time: `${pad(hour24 % 12 || 12)}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${hour24 >= 12 ? 'PM' : 'AM'}`, date: `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}` };
}
function greeting(h) {
    if (h >= 5 && h < 12) return 'GOOD MORNING 🌄';
    if (h >= 12 && h < 17) return 'GOOD AFTERNOON 🌞';
    if (h >= 17 && h < 21) return 'GOOD EVENING 🌆';
    return 'GOOD NIGHT 🌙';
}
function longUptime(seconds) {
    seconds = Math.floor(seconds);
    const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.slice(0, 2).join(' ');
}

// ---------------------------------------------------------------------------
// Premium visual style - box-drawing characters already used elsewhere in this project (see the new-member welcome
// banner in commands/welcome.js), so they are known to render correctly on WhatsApp.
// ---------------------------------------------------------------------------
const BAR = '━'.repeat(20);
const boxTop = (title) => `╭━━━〔 ${title} 〕━━━╮`;
const boxBottom = () => `╰${BAR}╯`;
const plainTop = () => `╭${BAR}╮`;
const row = (text) => `┃ ${text}`;

function categoryText(cat) {
    const P = runtime.getPrefix();
    const lines = [boxTop(`${cat.emoji} ${cat.title}`)];
    for (let i = 0; i < cat.names.length; i += 3) lines.push(row(cat.names.slice(i, i + 3).map((n) => `${P}${n}`).join('  ')));
    if (cat.usage) { lines.push(row('')); for (const u of cat.usage) lines.push(row(`💡 ${P}${u}`)); }
    lines.push(boxBottom());
    lines.push('', `> Type \`${P}menu\` to return to the Main Menu`);
    return lines.join('\n');
}

function allText(botName) {
    const P = runtime.getPrefix();
    return `*${botName}* — 𝗙𝗨𝗟𝗟 𝗖𝗢𝗠𝗠𝗔𝗡𝗗 𝗟𝗜𝗦𝗧\n_Prefix: ${P}_  •  _${commandNames().length} commands_\n\n${CATEGORIES.map(categoryText).join('\n\n')}`;
}

/** The premium header block: identity + live stats. */
function headerBlock({ botName, ownerName, mode }) {
    const pk = pkNow(); const P = runtime.getPrefix();
    const version = require('../package.json').version || '1.0.0';
    return [
        boxTop(botName.toUpperCase().replace(/_/g, ' ').split('').join(' ').replace(/\s{2,}/g, '  ')),
        row('✨ PREMIUM WHATSAPP BOT'),
        row(`👤 Owner    : ${ownerName}`),
        row(`⚡ Version  : v${version}`),
        row(`🌐 Mode     : ${mode}`),
        row(`🔧 Prefix   : ${P}`),
        row(`📊 Commands : ${commandNames().length}`),
        row(`⏱️ Uptime   : ${longUptime(process.uptime())}`),
        row(`🕒 ${pk.time} • ${pk.date}`),
        boxBottom(),
    ].join('\n');
}

/** The "tap to open" category list shown as plain text, for classic style and as a fallback. */
function mainMenuBlock() {
    const lines = [boxTop('MAIN MENU')];
    for (const c of CATEGORIES) lines.push(row(`${c.emoji} ${c.title}`));
    lines.push(boxBottom());
    return lines.join('\n');
}

/** WhatsApp Channel / official group / owner contact, read only from configured settings - nothing invented. */
function connectBlock() {
    const lines = [boxTop('CONNECT WITH US')];
    lines.push(row(`📢 WhatsApp Channel: ${settings.channelLink || 'not configured yet'}`));
    lines.push(row(`👥 Official Group: ${settings.groupLink || 'not configured yet'}`));
    const ownerDigits = String(settings.ownerNumber || '').replace(/\D/g, '');
    lines.push(row(`👑 Bot Owner: ${settings.ownerName}${ownerDigits ? ` (https://wa.me/${ownerDigits})` : ''}`));
    lines.push(boxBottom());
    return lines.join('\n');
}

function footerBlock(botName) {
    return [plainTop(), row(`❤️ POWERED BY ${botName.toUpperCase()}`), boxBottom()].join('\n');
}

function dashboardText({ botName, ownerName, mode }) {
    return [headerBlock({ botName, ownerName, mode }), '', mainMenuBlock(), '', connectBlock(), '', footerBlock(botName)].join('\n');
}

/** Plain text of the message that triggered the command (typed text or a list selection). */
function incomingText(msg) {
    const m = msg?.message?.ephemeralMessage?.message || msg?.message?.viewOnceMessage?.message || msg?.message?.viewOnceMessageV2?.message || msg?.message || {};
    const direct = m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.listResponseMessage?.singleSelectReply?.selectedRowId
        || m.buttonsResponseMessage?.selectedButtonId || m.templateButtonReplyMessage?.selectedId;
    if (direct) return String(direct);
    try { return String(JSON.parse(m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson || '{}').id || ''); } catch (_) { return ''; }
}
/** ".menu group" -> "group"; ".menu" -> "" */
const requestedCategory = (msg) => (incomingText(msg).trim().split(/\s+/)[1] || '').toLowerCase();

// ---------------------------------------------------------------------------
// Image loading - downloads the real picture (never trusts a bare URL to WhatsApp), caches it for 30 minutes, and
// falls back to a locally drawn banner (lib/ephoto.js) when the remote host cannot be reached, so a picture is
// ALWAYS available even if the image host is down.
// ---------------------------------------------------------------------------
const reasonOf = (e) => (e && e.response ? `HTTP ${e.response.status}` : (e && e.message) || 'unknown error');
let imageCache = null;      // last good copy of the real picture { buffer, mime, at, source: 'remote' }
let fallbackCache = null;   // locally drawn banner, used only when the real picture cannot be downloaded
let lastImageError = '';
let failedAt = 0;

async function bannerFallback() {
    if (fallbackCache) return fallbackCache;
    const { render } = require('../lib/ephoto');
    fallbackCache = { buffer: await render('neon', settings.botName || 'Mithu_MD MINI'), mime: 'image/png', at: Date.now(), source: 'fallback' };
    return fallbackCache;
}

async function loadMenuImage(force = false) {
    const now = Date.now();
    if (!force && imageCache && now - imageCache.at < 30 * 60 * 1000) return imageCache;
    if (!force && failedAt && now - failedAt < 2 * 60 * 1000) return imageCache || bannerFallback();
    const { getBuffer } = require('../lib/net');
    try {
        const f = await getBuffer(MENU_IMAGE, { maxBytes: 8 * 1024 * 1024, timeout: 20000, headers: { Accept: 'image/jpeg,image/png,image/*;q=0.8' } });
        if (!f.mime.startsWith('image/')) throw new Error(`the link is not a direct image (it returned "${f.mime || 'unknown type'}")`);
        if (f.buffer.length < 500) throw new Error('the image is empty');
        let { buffer, mime } = f;
        try {
            buffer = await require('sharp')(buffer).rotate().resize({ width: 1280, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
            mime = 'image/jpeg';
        } catch (_) { /* keep the original bytes */ }
        imageCache = { buffer, mime, at: now, source: 'remote' };
        lastImageError = ''; failedAt = 0;
        return imageCache;
    } catch (e) {
        lastImageError = reasonOf(e); failedAt = now;
        console.error('[menu] could not download the menu image:', lastImageError);
        return imageCache || bannerFallback();
    }
}

/**
 * "Native flow" interactive message: body text + footer + category list + link buttons.
 * image (optional, { buffer }) is added as the header picture of the same bubble.
 */
async function sendInteractive(sock, from, text, footer, buttons, image = null) {
    const B = require('@whiskeysockets/baileys');
    let header = { title: '', subtitle: '', hasMediaAttachment: false };
    if (image) {
        const media = await B.prepareWAMessageMedia({ image: image.buffer }, { upload: sock.waUploadToServer });
        header = { title: '', subtitle: '', hasMediaAttachment: true, imageMessage: media.imageMessage };
    }
    const interactive = { header, body: { text }, footer: { text: footer }, nativeFlowMessage: { buttons, messageParamsJson: '' } };
    const IM = B.proto && B.proto.Message && B.proto.Message.InteractiveMessage;
    const content = { viewOnceMessage: { message: {
        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
        interactiveMessage: IM && typeof IM.create === 'function' ? IM.create(interactive) : interactive,
    } } };
    const additionalNodes = [{ tag: 'biz', attrs: {}, content: [{ tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }] }] }];
    if (!from.endsWith('@g.us')) additionalNodes.push({ tag: 'bot', attrs: { biz_bot: '1' } });
    let toRelay = content; const opts = { additionalNodes };
    if (typeof B.generateWAMessageFromContent === 'function') {
        const full = B.generateWAMessageFromContent(from, content, { userJid: sock.user && sock.user.id });
        toRelay = full.message; opts.messageId = full.key.id;
    }
    await sock.relayMessage(from, toRelay, opts);
}

/** The menu picture as a real WhatsApp image message with a caption. Returns false when no picture could be sent. */
async function sendImageCard(sock, from, msg, caption) {
    let img;
    try { img = await loadMenuImage(); } catch (e) { console.error('[menu] no picture available:', reasonOf(e)); return false; }
    try {
        await sock.sendMessage(from, { image: img.buffer, mimetype: img.mime, caption }, { quoted: msg });
        return true;
    } catch (e) {
        console.error('[menu] sending the picture failed:', reasonOf(e));
        try { await sock.sendMessage(from, { image: { url: MENU_IMAGE }, caption }, { quoted: msg }); return true; } catch (e2) { console.error('[menu] sending the picture by URL failed:', reasonOf(e2)); }
    }
    return false;
}

/** Category list + "Main Menu" row + connect-with-us link buttons. */
function buildButtons() {
    const P = runtime.getPrefix();
    const rows = [
        { header: '🏠', title: 'MAIN MENU', description: 'Back to the start', id: `${P}menu` },
        { header: '📜', title: 'ALL COMMANDS', description: `Everything (${commandNames().length} commands)`, id: `${P}menu all` },
        ...CATEGORIES.map((c) => ({ header: c.emoji, title: c.title, description: c.desc, id: `${P}menu ${c.id}` })),
    ];
    const buttons = [{ name: 'single_select', buttonParamsJson: JSON.stringify({ title: '🔖 TAP TO OPEN MENU 💻', sections: [{ title: 'SELECT A CATEGORY', rows }] }) }];
    const url = (label, link) => ({ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: label, url: link, merchant_url: link }) });
    if (settings.channelLink) buttons.push(url('📢 WHATSAPP CHANNEL', settings.channelLink));
    if (settings.groupLink) buttons.push(url('👥 OFFICIAL GROUP', settings.groupLink));
    const ownerDigits = String(settings.ownerNumber || '').replace(/\D/g, '');
    if (ownerDigits) buttons.push(url('👑 BOT OWNER', `https://wa.me/${ownerDigits}`));
    return buttons;
}

/** Plain image message: the menu picture with the dashboard text as caption. If the picture cannot be loaded, text is sent and the problem is reported. */
async function sendClassic(sock, from, msg, text, hint) {
    try {
        await sock.sendMessage(from, { image: { url: MENU_IMAGE }, caption: `${text}\n\n${hint}` }, { quoted: msg });
    } catch (e) {
        console.error('[menu] menu image could not be sent:', e && e.message);
        await sock.sendMessage(from, { text: `${text}\n\n${hint}\n\n⚠️ _The menu image could not be loaded right now._` }, { quoted: msg });
    }
}

// ---------------------------------------------------------------------------
// .menu            -> picture, then the premium menu card with the tap-to-open list and buttons (MENU_STYLE=split, default)
//   MENU_STYLE=single  -> one bubble: picture on top, list and buttons below (falls back to split if WhatsApp refuses it)
//   MENU_STYLE=classic -> only the picture with the menu text as caption (no buttons)
// .menu <category> -> that category; .menu all -> everything (also what the list rows send)
// ---------------------------------------------------------------------------
async function menu(sock, from, msg, isBotOwner) {
    const botName = settings.botName || 'Mithu_MD MINI';
    const ownerName = settings.ownerName || 'Owner';
    const botData = runtime.state.botData;
    const mode = botData && botData.isPublic === false ? 'PRIVATE' : 'PUBLIC';
    const P = runtime.getPrefix();
    try {
        const wanted = requestedCategory(msg);
        if (wanted === 'all') return void await sock.sendMessage(from, { text: allText(botName) }, { quoted: msg });
        const cat = CATEGORIES.find((c) => c.id === wanted);
        if (cat) return void await sock.sendMessage(from, { text: categoryText(cat) }, { quoted: msg });

        const dash = dashboardText({ botName, ownerName, mode });
        const hint = `📂 ${P}menu ${CATEGORIES.map((c) => c.id).join(' | ')} | all`;
        const style = (process.env.MENU_STYLE || 'split').toLowerCase();
        const noPicture = () => sock.sendMessage(from, { text: `⚠️ _The menu picture could not be loaded (${lastImageError || 'unknown reason'})._` });

        if (style === 'classic') {
            if (!(await sendImageCard(sock, from, msg, `${dash}\n\n${hint}`))) await sock.sendMessage(from, { text: `${dash}\n\n${hint}` }, { quoted: msg });
            return;
        }
        if (style === 'single') {
            try { await sendInteractive(sock, from, dash, `❤️ POWERED BY ${botName.toUpperCase()}`, buildButtons(), await loadMenuImage()); return; }
            catch (e) { console.error('[menu] single-bubble menu failed, using split:', reasonOf(e)); }
        }
        // split (default): picture first, then the card with the buttons
        const card = `${headerBlock({ botName, ownerName, mode })}\n\n${connectBlock()}`;
        const pictureOk = await sendImageCard(sock, from, msg, card);
        try {
            await sendInteractive(sock, from, dash, `❤️ POWERED BY ${botName.toUpperCase()}`, buildButtons(), null);
        } catch (e) {
            console.error('[menu] button menu failed, sending it as text:', reasonOf(e));
            await sock.sendMessage(from, { text: `${dash}\n\n${hint}` }, { quoted: msg });
        }
        if (!pictureOk) await noPicture();
    } catch (e) {
        try { await sock.sendMessage(from, { text: `❌ Could not load the menu right now. Try ${P}help instead.` }, { quoted: msg }); } catch (_) {}
    }
}

module.exports = { menu, MENU_IMAGE, CATEGORIES, commandNames, loadMenuImage, sendInteractive, sendImageCard, buildButtons, dashboardText, getLastImageError: () => lastImageError };
