require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, jidNormalizedUser, Browsers, delay } = require('@whiskeysockets/baileys');
const P = require('pino');
const os = require('os');
const http = require('http');
const botSettings = require('./settings'); // only used for the startup OWNER_NUMBER check below; every command file reads settings.js independently
const runtime = require('./lib/runtime');
const plugins = require('./lib/plugins');
const { STATUS_REACT_EMOJI, pickReaction } = require('./lib/emojis');
const { createPairingService, PairingError } = require('./lib/pairingService');
const { createWebServer } = require('./lib/webServer');

// Import Commands
const commands = {
    song: require('./commands/song'),
    video: require('./commands/video'),
    anticall: require('./commands/anticall'),
    status: require('./commands/status'),
    antidelete: require('./commands/antidelete'),
    autoreacts: require('./commands/autoreacts'),
    vv: require('./commands/vv'),
    dp: require('./commands/dp'),
    ytmp3: require('./commands/ytmp3'),
    ytmp4: require('./commands/ytmp4'),
    welcome: require('./commands/welcome'),
    antilink: require('./commands/antilink'),
    kick: require('./commands/kick'),
    basic: require('./commands/basic'),
    fun: require('./commands/fun'),
    groupTools: require('./commands/groupTools'),
    autotyping: require('./commands/autotyping'),
    blockTools: require('./commands/blockTools'),
    botstatus: require('./commands/botstatus'),
    utility: require('./commands/utility'),
    mode: require('./commands/mode'),
    menu: require('./commands/menu'),
    antibad: require('./commands/antibad'),
    gcSetting: require('./commands/gc-setting'),
    autovoice: require('./commands/autovoice'),
    restart: require('./commands/restart'),
    tts: require('./commands/tts'),
    repo: require('./commands/repo'),
    getpair: require('./commands/getpair'),
    url: require('./commands/url'),
};

const { storeMessage, handleMessageRevocation } = require('./commands/antidelete');
const isOwner = require('./lib/isOwner');
const { isAdmin: checkAdmin } = require('./lib/isAdmin');

// Telegram Bot Setup
// The Telegram token is a secret: it is read ONLY from the environment (TELEGRAM_TOKEN, e.g. in .env or the host
// panel) and never hardcoded in source. Without it, Telegram pairing is disabled but WhatsApp sessions still start.
const tgToken = process.env.TELEGRAM_TOKEN;
if (!tgToken) console.warn('[Telegram] TELEGRAM_TOKEN is not set - Telegram pairing is disabled. Existing WhatsApp sessions still start.');
const tgBot = tgToken ? new TelegramBot(tgToken, { polling: true }) : new Proxy({}, { get: () => () => Promise.resolve({ message_id: 0, chat: {} }) });

const getStats = () => {
    const totalUsers = botData.telegramUsers ? botData.telegramUsers.length : 0;
    const totalActive = Object.values(sessions).filter(s => s.isConnected).length;
    return `👋 𝗪𝗘𝗟𝗖𝗢𝗠𝗘 𝗧𝗢 𝐌𝐢𝐭𝐡𝐮_𝐌𝐃 𝗠𝗜𝗡𝗜\n\n` +
           `╭━━━〔 𝗕𝗢𝗧 𝗦𝗧𝗔𝗧𝗨𝗦 〕━━━┈⊷\n` +
           `┃ ⋄ 𝗧𝗢𝗧𝗔𝗟 𝗨𝗦𝗘𝗥: ${totalUsers}\n` +
           `┃ ⋄ 𝗧𝗢𝗧𝗔𝗟 𝗔𝗖𝗧𝗜𝗩𝗘 𝗕𝗢𝗧𝗦: ${totalActive}\n` +
           `╰━━━━━━━━━━━━━━━━━━┈⊷`;
};

tgBot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!botData.telegramUsers) botData.telegramUsers = [];
    if (!botData.telegramUsers.includes(chatId)) {
        botData.telegramUsers.push(chatId);
        saveBotData();
    }

    if (text === '/start') {
        const welcomeMsg = "👋 *WELCOME TO JoKER King 👑 RKS MD-BOT*\n\n🚀 *FAST & SECURE WHATSAPP AUTOMATION*\n\n📱 *ENTER YOUR WHATSAPP NUMBER*\n_(Example: 923000000000)_";
        await tgBot.sendMessage(chatId, welcomeMsg, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [[{ text: "📊 BOT STATS" }]],
                resize_keyboard: true
            }
        });
        return;
    }

    if (text === '📊 BOT STATS') {
        await tgBot.sendMessage(chatId, getStats());
        return;
    }

    if (/^\d+$/.test(text)) {
        const userId = chatId.toString();
        let anim = null;
        try {
            // The shared pairing service (lib/pairingService.js) validates the number and applies the cooldown / one-session-per-number /
            // simultaneous-request rules, then drives the same BotSession + requestPairingCode flow this bot always used.
            // The website uses the very same service, so Telegram and the website can never open two sockets for one number.
            await pairingService.request({
                number: text, source: 'telegram', userId, ownerKey: userId,
                prepare: async (session) => {
                    const loadingMsg = await tgBot.sendMessage(chatId, "🔄 *Connecting to WhatsApp Servers...*", { parse_mode: 'Markdown' });
                    const frames = ["⏳", "⌛", "🔄", "⚙️"];
                    let i = 0;
                    anim = setInterval(async () => {
                        try {
                            await tgBot.editMessageText(`${frames[i % frames.length]} *Generating Pairing Code for ${text}...*`, {
                                chat_id: chatId,
                                message_id: loadingMsg.message_id,
                                parse_mode: 'Markdown'
                            });
                            i++;
                        } catch (e) { clearInterval(anim); }
                    }, 1500);
                    session.tgChatId = chatId;
                    session.tgLoadingMsgId = loadingMsg.message_id;
                    session.tgAnimInterval = anim;
                },
            });
            // The code itself is delivered by BotSession.initialize() (it edits the "Connecting..." message), exactly as before.
        } catch (e) {
            if (anim) clearInterval(anim);
            if (e instanceof PairingError) {
                if (e.code !== 'superseded' && !e.alreadyNotified) {
                    await tgBot.sendMessage(chatId, `⚠️ *${e.userMessage}*`, { parse_mode: 'Markdown' }).catch(() => tgBot.sendMessage(chatId, `⚠️ ${e.userMessage}`).catch(() => {}));
                }
            } else {
                console.error('[Telegram] pairing error:', e && e.message);
            }
        }
    }
});

// Web server removed as per user request

const AUTH_DIR = './sessions';
let cachedBaileysVersion = null; // see initialize(): avoids aborting a reconnect over a transient version-fetch failure

// Bounded store behind getMessage(): remembers the last MAX_LOGGED_MESSAGES {key,message} per session so WhatsApp's
// "please resend" retry receipts can be served with the real content instead of an empty one (see getMessage above).
const MAX_LOGGED_MESSAGES = 200;
function logMessage(userId, key, message) {
    if (!key || !key.id || !message) return;
    if (!messageLogs[userId]) messageLogs[userId] = {};
    const log = messageLogs[userId];
    log[key.id] = { message, at: Date.now() };
    const ids = Object.keys(log);
    if (ids.length > MAX_LOGGED_MESSAGES) {
        ids.sort((a, b) => log[a].at - log[b].at);
        for (const id of ids.slice(0, ids.length - MAX_LOGGED_MESSAGES)) delete log[id];
    }
}
const DATA_FILE = './data/bot_data.json';
fs.ensureDirSync(AUTH_DIR);
fs.ensureDirSync('./data');

let botData = { antilinkGroups: {}, totalBots: 0, registeredBots: [], statusSettings: {}, antiDelete: {}, userNames: {}, antiCall: {}, telegramUsers: [], mutedUsers: {}, antilinkWarnings: {}, autoTyping: {}, antibadGroups: {}, antibadWords: {}, antibadWarnings: {}, autoVoice: {}, gcSettingGroups: {} };
if (fs.existsSync(DATA_FILE)) {
    try { botData = fs.readJsonSync(DATA_FILE); } catch (e) {}
}
if (!botData.mutedUsers) botData.mutedUsers = {}; // Ensure field exists for bots upgraded from an older data file
if (!botData.antilinkWarnings) botData.antilinkWarnings = {};
if (!botData.autoTyping) botData.autoTyping = {};
if (!botData.antibadGroups) botData.antibadGroups = {};
if (!botData.antibadWords) botData.antibadWords = {};
if (!botData.antibadWarnings) botData.antibadWarnings = {};
if (!botData.autoVoice) botData.autoVoice = {};
if (!botData.gcSettingGroups) botData.gcSettingGroups = {};
if (!botData.autoRead) botData.autoRead = {};
if (!botData.alwaysOnline) botData.alwaysOnline = {};
if (!botData.startupNotice) botData.startupNotice = {};

function saveBotData() {
    fs.writeJsonSync(DATA_FILE, botData);
}

const sessions = {}; 
const userSockets = {}; 
const messageLogs = {}; 

// --- Keep-alive HTTP server -------------------------------------------------
// Katabump (like most container/VPS panels) health-checks a web process by its PORT; without anything bound to it
// the platform can consider the app "down" and restart the container, killing the live WhatsApp socket. That looks
// exactly like a random WhatsApp disconnect. This binds a minimal server (no new dependency) so the process is seen
// as healthy. It reports nothing sensitive - just an uptime/session count summary.
const keepAlivePort = Number(process.env.PORT) || Number(process.env.SERVER_PORT) || 22019;

// Shared pairing service: the ONE place that starts WhatsApp pairing for Telegram, the website and .pair.
const pairingService = createPairingService({ sessions, authDir: AUTH_DIR, createSession: (id) => new BotSession(id), log: console });
let tgUsername = String(process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
if (!tgUsername && tgToken) tgBot.getMe().then((me) => { if (me && me.username) tgUsername = me.username; }).catch(() => {});

// Website (pairing panel) + health endpoint: ONE http server on ONE port, in this same process (no second server, no second bot).
// GET /health keeps returning the same JSON the old keep-alive server returned, so Katabump's health check is unaffected.
const web = createWebServer({
    pairing: pairingService,
    log: console,
    getHealth: () => {
        const up = Object.values(sessions).filter((s) => s.isConnected).length;
        return { status: 'ok', sessions: Object.keys(sessions).length, connected: up, uptime: Math.floor(process.uptime()) };
    },
    getPublicConfig: () => {
        // Owner contact is intentionally published on the pairing website as requested by the owner.
        const supportDigits = String(process.env.SUPPORT_WHATSAPP || botSettings.ownerNumber || '923280355660').replace(/\D/g, '');
        return {
            brand: 'JoKER King 👑 RKS MD',
            telegramUrl: /^[A-Za-z0-9_]{4,32}$/.test(tgUsername) ? `https://t.me/${tgUsername}` : null,
            channelUrl: botSettings.channelLink || null,
            groupUrl: botSettings.groupLink || null,
            tiktokUrl: botSettings.tiktokLink || null,
            whatsappUrl: supportDigits.length >= 8 && supportDigits.length <= 15 ? `https://wa.me/${supportDigits}` : null,
            supportEmail: process.env.SUPPORT_EMAIL || null,
            cooldownSec: Math.round(pairingService.config.cooldownMs / 1000),
        };
    },
});
const keepAliveServer = http.createServer(web.handler);
keepAliveServer.requestTimeout = 20000;      // slow-request protection for a small host
keepAliveServer.headersTimeout = 15000;
keepAliveServer.on('error', (e) => console.error(`[System] HTTP server could not bind to port ${keepAlivePort}: ${e.message}`));
keepAliveServer.listen(keepAlivePort, '0.0.0.0', () => console.log(`[System] HTTP server listening on 0.0.0.0:${keepAlivePort} (health check${web.enabled ? ' + pairing website' : ' only - WEBSITE=off'}).`));
const pairingCooldowns = new Map();

// Shared state for the plugin-style command files (commands/*.js that export { name, category, run }).
runtime.init({
    botData, saveBotData, sessions,
    // Used by .pair / .clonebot: links an extra WhatsApp number and resolves with its pairing code.
    createSession: async (number) => {
        try {
            const r = await pairingService.request({ number, source: 'owner', userId: `wa_${String(number).replace(/\D/g, '')}`, ownerKey: 'owner' });
            return r.code;
        } catch (e) { throw new Error(e instanceof PairingError ? e.userMessage : 'Could not generate a pairing code right now.'); }
    },
});
const pluginCount = plugins.load();
console.log(`[System] Loaded ${pluginCount} plugin-style commands.`);
if (String(botSettings.ownerNumber || '').replace(/\D/g, '') === '923000000000') {
    console.warn('[System] OWNER_NUMBER is not set in .env - using the default placeholder number. Commands that message ' +
        'the owner (e.g. .vv/.vv2 revealing view-once media, .report) will fall back to this bot\'s own linked chat instead. ' +
        'Set OWNER_NUMBER in .env to your real WhatsApp number to fix this properly.');
}

async function loadExistingSessions() {
    try {
        const authDirs = await fs.readdir(AUTH_DIR);
        for (const userId of authDirs) {
            const authPath = path.join(AUTH_DIR, userId);
            const stats = await fs.stat(authPath);
            if (stats.isDirectory()) {
                const credsFile = path.join(authPath, 'creds.json');
                if (fs.existsSync(credsFile)) {
                    if (!sessions[userId]) {
                        sessions[userId] = new BotSession(userId);
                        sessions[userId].initialize().catch(err => {
                            console.error(`[System] Failed to auto-initialize session ${userId}:`, err.message);
                        });
                    }
                }
            }
        }
    } catch (err) {
        console.error('[System] Error loading existing sessions:', err.message);
    }
}

class BotSession {
    constructor(userId) {
        this.userId = userId;
        this.sock = null;
        this.isConnected = false;
        this.authPath = path.join(AUTH_DIR, userId);
        this.isInitializing = false;
        this.lastConnectMessageTime = null;
        this.tgChatId = null;
        this.tgLoadingMsgId = null;
        this.tgAnimInterval = null;
        this.messageQueue = [];
        this.isProcessingQueue = false;
        this.tgNotificationSent = false;
        this.startTime = Date.now();
        // Disconnect-diagnostics state (see the "WHY DISCONNECTS HAPPENED" note in the connection.update handler below)
        this.badMacCount = 0;
        this.conflictCount = 0;
        this.lastConflictAt = 0;
        // Loop / duplicate protection state
        this.destroyed = false;
        this.reconnectTimer = null;
        this.keepAliveTimer = null;
        this.processedIds = new Map();   // incoming message ids already handled
        this.sentIds = new Map();        // ids of messages this bot sent (they echo back through messages.upsert)
        this.statusSeen = new Map();     // status ids already reacted to / viewed
        this.reactedIds = new Map();     // message ids already auto-reacted
        this.seenMisc = new Map();
        this.onPairingCode = null;
        // Used by the shared pairing service (lib/pairingService.js)
        this.onPairingError = null;
        this.pairingCodeIssued = false;
        this.pairFailNotified = false;
        this.pairNumber = null;
        this.createdAt = Date.now();
        this.everConnected = false;   // true once this session reached 'open' at least once (= really linked)
        this.loggedOut = false;       // WhatsApp logged this session out (device removed) - it is dead and may be re-paired
    }

    // Remember an id for a while; returns true if it was already known.
    remember(map, id, max = 2000) {
        if (!id) return false;
        if (map.has(id)) return true;
        map.set(id, Date.now());
        if (map.size > max) { const first = map.keys().next().value; map.delete(first); }
        return false;
    }

    seen(kind, id) { return this.remember(this.seenMisc, `${kind}:${id}`, 500); }

    // True when an incoming upsert must NOT be processed (own echo, duplicate, history/offline backlog, stale).
    alreadyHandled(msg, upsertType) {
        if (upsertType && upsertType !== 'notify') return true;
        const id = msg.key.id;
        if (this.sentIds.has(id)) return true;
        if (this.remember(this.processedIds, id)) return true;
        const ts = Number(msg.messageTimestamp) || 0;
        if (ts && Date.now() / 1000 - ts > 180) return true;
        return false;
    }

    // Statuses: never react to our own statuses / our own reactions / protocol messages, and only once per status id.
    shouldIgnoreStatus(msg) {
        if (msg.key.fromMe || !msg.key.participant) return true;
        const m = msg.message || {};
        if (m.reactionMessage || m.protocolMessage || (m.senderKeyDistributionMessage && Object.keys(m).length <= 2)) return true;
        return this.remember(this.statusSeen, msg.key.id, 1000);
    }

    // Stop timers and detach every listener from the current socket (no logout, session files are kept).
    teardownSocket() {
        this.stopKeepAlive();
        const old = this.sock;
        if (!old) return;
        try { old.ev.removeAllListeners(); } catch (e) {}
        try { old.end(undefined); } catch (e) {}
    }

    destroy() {
        this.destroyed = true;
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        if (this.tgAnimInterval) clearInterval(this.tgAnimInterval);
        this.teardownSocket();
        this.isConnected = false;
        this.isInitializing = false;
    }

    scheduleReconnect(ms) {
        if (this.destroyed) return;
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.initialize(); }, ms);
    }

    stopKeepAlive() {
        if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = null;
    }

    // ONE timer per live socket (cleared on close). Keeps presence if .alwaysonline is on, refreshes the "About" text rarely.
    startKeepAlive(sock) {
        this.stopKeepAlive();
        const updateAbout = async () => {
            try {
                await sock.query({
                    tag: 'iq',
                    attrs: { to: jidNormalizedUser(sock.user.id), type: 'set', xmlns: 'status' },
                    content: [{ tag: 'status', attrs: {}, content: Buffer.from("IM USING BEST BOT JoKER King RKS MD", 'utf-8') }]
                });
            } catch (e) {}
        };
        updateAbout();
        let tick = 0;
        this.keepAliveTimer = setInterval(() => {
            if (!this.isConnected || sock !== this.sock) return;
            tick++;
            if (botData.alwaysOnline && botData.alwaysOnline[this.userId]) sock.sendPresenceUpdate('available').catch(() => {});
            if (tick % 30 === 0) updateAbout();
        }, 60000);
    }

    // The "online" notice goes to the bot's own chat at most once per 12 hours (survives restarts). STARTUP_MESSAGE=off disables it.
    async maybeSendStartupMessage(botNumber) {
        if (String(process.env.STARTUP_MESSAGE || '').toLowerCase() === 'off') return;
        if (this.onlineMessageSent) return;
        this.onlineMessageSent = true;
        const last = Number((botData.startupNotice || {})[this.userId]) || 0;
        if (Date.now() - last < 12 * 3600 * 1000) return;
        botData.startupNotice[this.userId] = Date.now();
        saveBotData();
        const onlineMsg = `JoKER King RKS MD IS ONLINE ✅\n> *USE ${runtime.getPrefix()}MENU TO SEE ALL COMMAND*`;
        await this.sock.sendMessage(botNumber, { text: onlineMsg }).catch(() => {});
    }

    async addToQueue(task) {
        this.messageQueue.push(task);
        if (!this.isProcessingQueue) {
            this.processQueue();
        }
    }

    async processQueue() {
        this.isProcessingQueue = true;
        while (this.messageQueue.length > 0) {
            const task = this.messageQueue.shift();
            try {
                await task();
            } catch (e) {
                this.sendLog(`Queue error: ${e.message}`, "error");
            }
            await delay(500); // Prevent spamming/rate limiting
        }
        this.isProcessingQueue = false;
    }

    sendLog(message, type = 'info') {
        console.log(`[${this.userId}] ${message}`);
    }

    sendConnectionStatus() {
        // No web UI to update
    }

    async safeSendMessage(jid, content, options = {}) {
        if (!this.isConnected || !this.sock) {
            throw new Error("Connection Closed");
        }
        try {
            return await this.sock.sendMessage(jid, content, options);
        } catch (e) {
            if (e.message.includes("closed") || e.message.includes("Connection")) {
                this.isConnected = false;
            }
            throw e;
        }
    }

    async initialize(pairingNumber = null) {
        if (this.isInitializing || this.destroyed) return;
        this.isInitializing = true;
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.teardownSocket(); // never keep two live sockets (and their listeners) for one session
        try {
            let version;
            try {
                ({ version } = await fetchLatestBaileysVersion());
                cachedBaileysVersion = version;
            } catch (e) {
                // Network hiccup fetching the version string should not block a reconnect: reuse the last known-good
                // version (or Baileys' own built-in default on the very first run) instead of aborting initialize().
                version = cachedBaileysVersion;
                this.sendLog(`Could not fetch the latest WhatsApp Web version (${e.message}); reusing the last known version.`);
            }
            const { state, saveCreds } = await useMultiFileAuthState(this.authPath);
            
	            this.sock = makeWASocket({
	                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' })),
                },
                generateHighQualityLinkPreview: true,
                maxMsgRetryCount: 3,
                msgRetryCounterCache: new Map(),
                // Lets Baileys answer WhatsApp's "please resend this message" retry receipts with the real content.
                // messageLogs used to be declared but never written to, so this always returned an empty message,
                // which made WhatsApp keep re-requesting the same messages and contributed to the decrypt-retry /
                // "Bad MAC" churn that forces a session resync (see remember()/pruneMessageLog() below for how the
                // log is now filled and kept bounded).
                getMessage: async (key) => {
                    const log = messageLogs[this.userId];
                    if (log && log[key.id]) return log[key.id].message;
                    return undefined;
                },
	                printQRInTerminal: false,
	                logger: P({ level: 'fatal' }),
		                browser: Browsers.ubuntu('Chrome'),
	                syncFullHistory: false,
	                shouldSyncHistoryMessage: () => false,
	                markOnlineOnConnect: true,
	                keepAliveIntervalMs: 60000,
	                defaultQueryTimeoutMs: 60000,
	                connectTimeoutMs: 60000,
	            });

			            if (pairingNumber && !state.creds.registered) {
			                this.sendLog(`Initiating pairing process for ${pairingNumber}...`);
			                
			                // Essential delay for pairing code stability
			                await delay(3000);
			                
			                try {
			                    let code = await this.sock.requestPairingCode(pairingNumber);
			                    code = code?.match(/.{1,4}/g)?.join("-") || code;
			                    
			                    this.sendLog(`Pairing code generated successfully: ${code}`);
			                    this.pairingCodeIssued = true;
			                    if (typeof this.onPairingCode === 'function') { try { this.onPairingCode(code); } catch (e) {} }
			                    
			                    if (this.tgAnimInterval) clearInterval(this.tgAnimInterval);
			                    if (this.tgChatId && this.tgLoadingMsgId) {
			                        try {
			                            await tgBot.editMessageText(`✅ *Your Pairing Code is:* \n\n\`${code}\`\n\n_Enter this code in your WhatsApp linked devices._`, {
			                                chat_id: this.tgChatId,
			                                message_id: this.tgLoadingMsgId,
			                                parse_mode: 'Markdown'
			                            });
			                        } catch (editErr) {
			                            await tgBot.sendMessage(this.tgChatId, `✅ *Your Pairing Code is:* \n\n\`${code}\`\n\n_Enter this code in your WhatsApp linked devices._`, { parse_mode: 'Markdown' });
			                        }
			                    }
			                } catch (e) {
			                    this.sendLog(`Pairing code generation failed: ${e.message}`, "error");
			                    if (this.tgAnimInterval) clearInterval(this.tgAnimInterval);
			                    if (this.tgChatId) {
			                        await tgBot.sendMessage(this.tgChatId, `❌ *Pairing Failed:* ${e.message}\n_Please try again in a few moments._`, { parse_mode: 'Markdown' });
			                        this.pairFailNotified = true;
			                    }
			                    if (typeof this.onPairingError === 'function') { try { this.onPairingError(e); } catch (_) {} }
			                }
			            }

            // Remember ids of everything this bot sends: WhatsApp echoes them back through messages.upsert
            // and they must never be treated as new incoming messages.
            const thisSock = this.sock;
            const origSend = thisSock.sendMessage.bind(thisSock);
            thisSock.sendMessage = async (...a) => { const r = await origSend(...a); if (r && r.key && r.key.id) { this.remember(this.sentIds, r.key.id, 3000); logMessage(this.userId, r.key, a[1]); } return r; };
            const origRelay = thisSock.relayMessage.bind(thisSock);
            thisSock.relayMessage = async (...a) => { const r = await origRelay(...a); if (typeof r === 'string') this.remember(this.sentIds, r, 3000); return r; };

            this.sock.ev.on('creds.update', saveCreds);

            this.sock.ev.on('group-participants.update', async (anu) => {
                if (thisSock !== this.sock) return;
                try {
                    if (anu.action === 'add') {
                        await commands.welcome.handleJoinEvent(this.sock, anu.id, anu.participants).catch(() => {});
                    } else if (anu.action === 'remove') {
                        await commands.welcome.handleLeaveEvent(this.sock, anu.id, anu.participants).catch(() => {});
                    }
                } catch (e) {}
            });

            const handleMessage = async (msg, upsertType) => {
                try {
                    if (!msg || !msg.message || !msg.key || !msg.key.id) return;
                    logMessage(this.userId, msg.key, msg.message); // see getMessage() above
                    // Ignore our own echoes, duplicates, history/offline backlog and stale messages (see alreadyHandled)
                    if (this.alreadyHandled(msg, upsertType)) return;
                    
                    // Auto-fix session if decryption fails frequently (handled by Baileys, but we can help)
                    if (msg.messageStubType === 1) { // 1 is CIPHERTEXT
                         this.sendLog("Ciphertext message detected. Session might be out of sync.", "warning");
                    }

                    // Status System
                    if (msg.key.remoteJid === 'status@broadcast') {
                        if (this.shouldIgnoreStatus(msg)) return;
                        const settings = botData.statusSettings[this.userId];
                        if (settings && settings.autoStatus) {
                            // Auto Seen
                            if (settings.autoSeen) {
                                await this.sock.readMessages([msg.key]).catch(() => {});
                                this.sendLog(`Status seen from ${msg.pushName || msg.key.participant.split('@')[0]}`);
                            }
                            // Auto Like
                            if (settings.autoLike) {
                                await this.sock.sendMessage('status@broadcast', {
                                    react: { text: STATUS_REACT_EMOJI, key: msg.key }
                                }, { statusJidList: [msg.key.participant] }).catch(() => {});
                            }
                            // Auto Download
                            if (settings.autoDownload) {
                                try {
                                    const botNumber = jidNormalizedUser(this.sock.user.id);
                                    const messageContent = msg.message?.ephemeralMessage?.message || msg.message?.viewOnceMessage?.message || msg.message?.viewOnceMessageV2?.message || msg.message;
                                    const type = Object.keys(messageContent)[0];
                                    if (['imageMessage', 'videoMessage'].includes(type)) {
                                        const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
                                        const stream = await downloadContentFromMessage(messageContent[type], type.replace('Message', ''));
                                        let buffer = Buffer.from([]);
                                        for await (const chunk of stream) {
                                            buffer = Buffer.concat([buffer, chunk]);
                                            if (buffer.length > 50 * 1024 * 1024) break; // 50MB limit
                                        }
                                        const caption = `*Status Downloaded*\n\n👤 *From:* ${msg.pushName || msg.key.participant.split('@')[0]}\n📝 *Caption:* ${messageContent[type].caption || 'No caption'}`;
                                        await this.sock.sendMessage(botNumber, { 
                                            [type.replace('Message', '')]: buffer, 
                                            caption 
                                        }).catch(() => {});
                                    }
                                } catch (e) {
                                    this.sendLog("Status download failed: " + e.message, "error");
                                }
                            }
                        }
                        return;
                    }

                    const from = msg.key.remoteJid;
                    const isGroup = from.endsWith('@g.us');
                    const sender = isGroup ? msg.key.participant : from;
                    const botNumber = jidNormalizedUser(this.sock.user.id);

                    const messageContent = msg.message?.ephemeralMessage?.message || msg.message?.viewOnceMessage?.message || msg.message?.viewOnceMessageV2?.message || msg.message;
                    if (!messageContent) return;
                    const body = (messageContent.conversation || messageContent.extendedTextMessage?.text || messageContent.imageMessage?.caption || messageContent.videoMessage?.caption || messageContent.listResponseMessage?.singleSelectReply?.selectedRowId || messageContent.buttonsResponseMessage?.selectedButtonId || messageContent.templateButtonReplyMessage?.selectedId || (() => { try { return JSON.parse(messageContent.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson || '{}').id || ''; } catch (_) { return ''; } })() || '').trim();

                    // Auto Read: mark incoming messages as read when enabled (.autoread)
                    if (botData.autoRead && botData.autoRead[this.userId] && !msg.key.fromMe) {
                        this.sock.readMessages([msg.key]).catch(() => {});
                    }

                    // Auto Reacts: only to normal messages from others, once per message, emojis only from lib/emojis.js
                    if (botData.autoReacts && botData.autoReacts[this.userId] && !msg.key.fromMe
                        && !messageContent.reactionMessage && !messageContent.protocolMessage && !messageContent.senderKeyDistributionMessage
                        && !this.remember(this.reactedIds, msg.key.id, 1000)) {
                        this.sock.sendMessage(from, { react: { text: pickReaction(), key: msg.key } }).catch(() => {});
                    }

                    if (botData.antiDelete[this.userId]) {
                        try {
                            if (msg.message?.protocolMessage?.type === 0) {
                                await handleMessageRevocation(this.sock, msg);
                            } else {
                                await storeMessage(msg);
                            }
                        } catch (e) {
                            this.sendLog("Antidelete processing error: " + e.message, "error");
                        }
                    }

                    if (isGroup && botData.antilinkGroups[from] && !msg.key.fromMe) {
                        const linkRegex = /chat\.whatsapp\.com\/|https?:\/\/\S+/gi;
                        if (linkRegex.test(body)) {
                            const isSenderAdmin = await checkAdmin(this.sock, from, sender);
                            const isBotAdmin = await checkAdmin(this.sock, from, this.sock.user.id, this.sock.user?.lid);
                            
                            if (!isSenderAdmin) {
                                const mode = botData.antilinkGroups[from];
                                if (isBotAdmin) {
                                    this.sendLog(`Link detected from non-admin ${sender} in ${from}. Deleting...`, "warning");
                                    await this.sock.sendMessage(from, { delete: msg.key }).catch(() => {});
                                    if (mode === 'kick') {
                                        try {
                                            await this.sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
                                        } catch (e) {
                                            this.sendLog("Failed to kick user for link: " + e.message, "error");
                                        }
                                    } else if (mode === 'warn') {
                                        try {
                                            const WARNING_LIMIT = 3;
                                            if (!botData.antilinkWarnings[from]) botData.antilinkWarnings[from] = {};
                                            const count = (botData.antilinkWarnings[from][sender] || 0) + 1;
                                            botData.antilinkWarnings[from][sender] = count;
                                            saveBotData();

                                            if (count >= WARNING_LIMIT) {
                                                await this.sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
                                                await this.sock.sendMessage(from, {
                                                    text: `🚫 @${sender.split('@')[0]} was removed after reaching ${WARNING_LIMIT} link warnings.`,
                                                    mentions: [sender]
                                                }).catch(() => {});
                                                delete botData.antilinkWarnings[from][sender];
                                                saveBotData();
                                            } else {
                                                await this.sock.sendMessage(from, {
                                                    text: `⚠️ @${sender.split('@')[0]}, links are not allowed here!\nWarning *${count}/${WARNING_LIMIT}* — next violation may result in removal.`,
                                                    mentions: [sender]
                                                }).catch(() => {});
                                            }
                                        } catch (e) {
                                            this.sendLog("Failed to process link warning: " + e.message, "error");
                                        }
                                    }
                                } else {
                                    try {
                                        await this.sock.sendMessage(from, { delete: msg.key }).catch(() => {});
                                        this.sendLog(`Link detected and deleted (Failsafe) in ${from}.`, "warning");
                                    } catch (e) {
                                        this.sendLog(`Link detected in ${from}, but I am not an admin to delete it.`, "warning");
                                    }
                                }
                            }
                        }
                    }

                    if (isGroup && botData.antibadGroups[from] && !msg.key.fromMe) {
                        const badWord = commands.antibad.containsBadWord(body, botData.antibadWords?.[from]);
                        if (badWord) {
                            const isSenderAdmin = await checkAdmin(this.sock, from, sender);
                            const isBotAdmin = await checkAdmin(this.sock, from, this.sock.user.id, this.sock.user?.lid);

                            if (!isSenderAdmin) {
                                const mode = botData.antibadGroups[from];
                                if (isBotAdmin) {
                                    this.sendLog(`Bad word detected from non-admin ${sender} in ${from}. Deleting...`, "warning");
                                    await this.sock.sendMessage(from, { delete: msg.key }).catch(() => {});
                                    if (mode === 'kick') {
                                        try {
                                            await this.sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
                                        } catch (e) {
                                            this.sendLog("Failed to kick user for bad word: " + e.message, "error");
                                        }
                                    } else if (mode === 'warn') {
                                        try {
                                            const WARNING_LIMIT = 3;
                                            if (!botData.antibadWarnings[from]) botData.antibadWarnings[from] = {};
                                            const count = (botData.antibadWarnings[from][sender] || 0) + 1;
                                            botData.antibadWarnings[from][sender] = count;
                                            saveBotData();

                                            if (count >= WARNING_LIMIT) {
                                                await this.sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
                                                await this.sock.sendMessage(from, {
                                                    text: `🚫 @${sender.split('@')[0]} was removed after reaching ${WARNING_LIMIT} bad-word warnings.`,
                                                    mentions: [sender]
                                                }).catch(() => {});
                                                delete botData.antibadWarnings[from][sender];
                                                saveBotData();
                                            } else {
                                                await this.sock.sendMessage(from, {
                                                    text: `⚠️ @${sender.split('@')[0]}, that language isn't allowed here!\nWarning *${count}/${WARNING_LIMIT}* — next violation may result in removal.`,
                                                    mentions: [sender]
                                                }).catch(() => {});
                                            }
                                        } catch (e) {
                                            this.sendLog("Failed to process bad-word warning: " + e.message, "error");
                                        }
                                    }
                                } else {
                                    try {
                                        await this.sock.sendMessage(from, { delete: msg.key }).catch(() => {});
                                        this.sendLog(`Bad word detected and deleted (Failsafe) in ${from}.`, "warning");
                                    } catch (e) {
                                        this.sendLog(`Bad word detected in ${from}, but I am not an admin to delete it.`, "warning");
                                    }
                                }
                            }
                        }
                    }

                    // Soft-mute enforcement: auto-delete messages from muted users (requires bot admin)
                    if (isGroup && botData.mutedUsers && botData.mutedUsers[from] && botData.mutedUsers[from].includes(sender) && !msg.key.fromMe) {
                        try {
                            const isBotAdminForMute = await checkAdmin(this.sock, from, this.sock.user.id, this.sock.user?.lid).catch(() => false);
                            if (isBotAdminForMute) {
                                await this.sock.sendMessage(from, { delete: msg.key }).catch(() => {});
                                return;
                            }
                        } catch (e) {}
                    }

                    const prefix = runtime.getPrefix();
                    if (body.startsWith(prefix)) {
                        const args = body.slice(prefix.length).trim().split(/ +/);
                        const commandName = args.shift().toLowerCase();
                        const q = args.join(' ');

                        const getGroupAdmins = async () => {
                            if (!isGroup) return { isSenderAdmin: true, isBotAdmin: true };
                            try {
                                const isSenderAdmin = await checkAdmin(this.sock, from, sender).catch(() => isOwner(sender));
                                const isBotAdmin = await checkAdmin(this.sock, from, this.sock.user.id, this.sock.user?.lid).catch(() => false);
                                return { isSenderAdmin, isBotAdmin };
                            } catch (e) {
                                return { isSenderAdmin: isOwner(sender), isBotAdmin: false };
                            }
                        };

                        try {
                            // Bot Mode Check
                            const isBotOwner = isOwner(sender) || msg.key.fromMe;
                            const publicCommands = [
                                'video', 'song', 'dp', 'ytmp4', 'ytmp3', 'vv', 'menu',
                                // Basic
                                'ping', 'alive', 'help',
                                // Fun / entertainment
                                'kiss', 'hug', 'love', 'slap', 'pat', 'highfive',
                                'wife', 'ship', 'rate', 'roast', 'joke', 'fact', 'truth', 'dare', '8ball',
                                // Read-only group utilities
                                'jid', 'info', 'admins',
                                // General utilities
                                'botstatus', 'calculator', 'calc', 'time', 'date', 'tts', 'repo', 'url', 'source',
                            ];

                            if (!isBotOwner) {
                                if (!botData.isPublic) return; // Private mode: only owner, don't respond to others
                                
                                if (!publicCommands.includes(commandName) && !plugins.isPublic(commandName)) {
                                    // Public mode: restricted commands for others
                                    return await this.sock.sendMessage(from, { text: "*ONLY OWNER CAN USE THIS COMMAND*" }, { quoted: msg });
                                }
                            }

                            // Auto Typing: show "composing..." before replying, if enabled for this account
                            if (botData.autoTyping && botData.autoTyping[this.userId]) {
                                await this.sock.sendPresenceUpdate('composing', from).catch(() => {});
                            }

                            // Auto Voice: show "recording audio..." before replying, if enabled for this account
                            if (botData.autoVoice && botData.autoVoice[this.userId]) {
                                await this.sock.sendPresenceUpdate('recording', from).catch(() => {});
                            }

                            // Loading reaction
                            await this.sock.sendMessage(from, { react: { text: '⏳', key: msg.key } }).catch(() => {});

                            switch (commandName) {
                                case 'public': {
                                    await commands.mode.goPublic(this.sock, from, msg, sender, botData, saveBotData);
                                    break;
                                }
                                case 'private': {
                                    await commands.mode.goPrivate(this.sock, from, msg, sender, botData, saveBotData);
                                    break;
                                }
                                case 'menu': {
                                    const reactions = ['⏳', '🔄', '⚙️', '✅'];
                                    for (const emoji of reactions) {
                                        await this.sock.sendMessage(from, { react: { text: emoji, key: msg.key } }).catch(() => {});
                                        await delay(200);
                                    }
                                    await commands.menu.menu(this.sock, from, msg, isBotOwner);
                                    break;
                                }
                                case 'antilink': {
                                    const { isSenderAdmin, isBotAdmin } = await getGroupAdmins();
                                    await commands.antilink(this.sock, from, msg, isSenderAdmin, isBotAdmin, botData, saveBotData, args); 
                                    break;
                                }
                                case 'anticall': await commands.anticall(this.sock, from, msg, (await getGroupAdmins()).isSenderAdmin, botData, saveBotData, this.userId, args); break;
                                case 'antidel':
                                case 'antidelete': await commands.antidelete(this.sock, from, msg, (await getGroupAdmins()).isSenderAdmin, botData, saveBotData, this.userId, args); break;
                                case 'status': {
                                    await commands.status(this.sock, from, msg, (await getGroupAdmins()).isSenderAdmin, botData, saveBotData, this.userId, args);
                                    await this.sock.sendMessage(from, { react: { text: '🤡', key: msg.key } }).catch(() => {});
                                    break;
                                }
                                case 'autoreacts': await commands.autoreacts(this.sock, from, msg, (await getGroupAdmins()).isSenderAdmin, botData, saveBotData, this.userId, args); break;
                                case 'song': await commands.song(this, from, msg); break;
                                case 'video': await commands.video(this, from, msg); break;
                                case 'ytmp3': await commands.ytmp3.run(this, msg, args, { sender: from }); break;
                                case 'ytmp4': await commands.ytmp4.run(this, msg, args, { sender: from }); break;
                                case 'kick': {
                                    const { isSenderAdmin, isBotAdmin } = await getGroupAdmins();
                                    await commands.kick(this.sock, from, msg, isSenderAdmin, isBotAdmin, botData, saveBotData, args); 
                                    break;
                                }
                                case 'vv': await commands.vv(this.sock, from, msg); break;
                                case 'dp': await commands.dp(this.sock, from, msg); break;
                                case 'welcome': await commands.welcome(this.sock, from, msg, (await getGroupAdmins()).isSenderAdmin, botData, saveBotData, args); break;

                                // --- Basic commands ---
                                case 'ping': await commands.basic.ping(this.sock, from, msg); break;
                                case 'alive': await commands.basic.alive(this.sock, from, msg); break;
                                case 'help': await commands.basic.help(this.sock, from, msg, isBotOwner); break;

                                // --- Fun / entertainment commands ---
                                case 'kiss': await commands.fun.kiss(this.sock, from, msg, sender, args); break;
                                case 'hug': await commands.fun.hug(this.sock, from, msg, sender, args); break;
                                case 'love': await commands.fun.love(this.sock, from, msg, sender, args); break;
                                case 'slap': await commands.fun.slap(this.sock, from, msg, sender, args); break;
                                case 'pat': await commands.fun.pat(this.sock, from, msg, sender, args); break;
                                case 'highfive': await commands.fun.highfive(this.sock, from, msg, sender, args); break;
                                case 'wife': await commands.fun.wife(this.sock, from, msg, sender, args); break;
                                case 'ship': await commands.fun.ship(this.sock, from, msg, sender, args); break;
                                case 'rate': await commands.fun.rate(this.sock, from, msg, sender, args); break;
                                case 'roast': await commands.fun.roast(this.sock, from, msg, sender, args); break;
                                case 'joke': await commands.fun.joke(this.sock, from, msg); break;
                                case 'fact': await commands.fun.fact(this.sock, from, msg); break;
                                case 'truth': await commands.fun.truth(this.sock, from, msg); break;
                                case 'dare': await commands.fun.dare(this.sock, from, msg); break;
                                case '8ball': await commands.fun.eightball(this.sock, from, msg, args); break;

                                // --- Group management commands ---
                                case 'jid': await commands.groupTools.jid(this.sock, from, msg); break;
                                case 'info': await commands.groupTools.info(this.sock, from, msg); break;
                                case 'admins': await commands.groupTools.admins(this.sock, from, msg); break;
                                case 'add': {
                                    const { isSenderAdmin, isBotAdmin } = await getGroupAdmins();
                                    await commands.groupTools.add(this.sock, from, msg, isSenderAdmin, isBotAdmin, args);
                                    break;
                                }
                                case 'mute': {
                                    const { isSenderAdmin, isBotAdmin } = await getGroupAdmins();
                                    await commands.groupTools.mute(this.sock, from, msg, isSenderAdmin, isBotAdmin, botData, saveBotData);
                                    break;
                                }
                                case 'unmute': {
                                    const { isSenderAdmin, isBotAdmin } = await getGroupAdmins();
                                    await commands.groupTools.unmute(this.sock, from, msg, isSenderAdmin, isBotAdmin, botData, saveBotData);
                                    break;
                                }
                                case 'promote': {
                                    const { isSenderAdmin, isBotAdmin } = await getGroupAdmins();
                                    await commands.groupTools.promote(this.sock, from, msg, isSenderAdmin, isBotAdmin, args);
                                    break;
                                }
                                case 'demote': {
                                    const { isSenderAdmin, isBotAdmin } = await getGroupAdmins();
                                    await commands.groupTools.demote(this.sock, from, msg, isSenderAdmin, isBotAdmin, args);
                                    break;
                                }

                                // --- Bot behaviour / account commands ---
                                case 'block': await commands.blockTools.block(this.sock, from, msg, isBotOwner, args); break;
                                case 'unblock': await commands.blockTools.unblock(this.sock, from, msg, isBotOwner, args); break;
                                case 'botstatus': await commands.botstatus(this.sock, from, msg, this.isConnected); break;

                                // --- Utility commands ---
                                case 'calculator':
                                case 'calc': await commands.utility.calculator(this.sock, from, msg, args); break;
                                case 'time': await commands.utility.time(this.sock, from, msg, args); break;
                                case 'date': await commands.utility.date(this.sock, from, msg, args); break;

                                // --- Group settings / moderation ---
                                case 'gc-setting': {
                                    const { isSenderAdmin, isBotAdmin } = await getGroupAdmins();
                                    await commands.gcSetting(this.sock, from, msg, isSenderAdmin, isBotAdmin, botData, saveBotData, args);
                                    break;
                                }
                                case 'antibad': {
                                    const { isSenderAdmin, isBotAdmin } = await getGroupAdmins();
                                    await commands.antibad(this.sock, from, msg, isSenderAdmin, isBotAdmin, botData, saveBotData, args);
                                    break;
                                }

                                // --- Auto behaviour ---
                                case 'autotype':
                                case 'autotyping': await commands.autotyping(this.sock, from, msg, isBotOwner, botData, saveBotData, this.userId, args); break;
                                case 'autorecording':
                                case 'autovoice': await commands.autovoice(this.sock, from, msg, isBotOwner, botData, saveBotData, this.userId, args); break;

                                // --- Tools ---
                                case 'tts': await commands.tts(this.sock, from, msg, args); break;

                                // --- System / info ---
                                case 'source':
                                case 'repo': await commands.repo(this.sock, from, msg); break;
                                case 'getpair': {
                                    if (!isBotOwner) { await this.sock.sendMessage(from, { text: '❌ Only the bot owner can use this command.' }, { quoted: msg }).catch(() => {}); break; }
                                    await commands.getpair(this.sock, from, msg, this.isConnected, this.userId);
                                    break;
                                }
                                case 'restart': await commands.restart(this.sock, from, msg, isBotOwner); break;
                                case 'url': await commands.url(this.sock, from, msg, args); break;

                                // --- Plugin-style commands (one file each in commands/) ---
                                default: {
                                    const plugin = plugins.get(commandName);
                                    if (plugin) {
                                        await plugins.run(plugin, {
                                            session: this, sock: this.sock, from, msg, sender, isGroup, args, q, command: commandName,
                                            prefix, isBotOwner, botData, saveBotData, userId: this.userId, getGroupAdmins,
                                        });
                                    }
                                    break;
                                }
                            }
                            
                            // Success reaction
                            this.addToQueue(async () => {
                                await this.sock.sendMessage(from, { react: { text: '✅', key: msg.key } }).catch(() => {});
                            });
                        } catch (e) {
                            // Error reaction
                            this.addToQueue(async () => {
                                await this.sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {});
                            });
                            this.sendLog(`Command error (${commandName}): ` + e.message, 'error');
                        }
                    }
                } catch (e) {
                    console.error('Message Processing Error:', e);
                }
            };
            this.sock.ev.on('messages.upsert', async (chatUpdate) => {
                if (thisSock !== this.sock) return; // listener of an old socket
                for (const m of chatUpdate.messages || []) await handleMessage(m, chatUpdate.type);
            });

            this.sock.ev.on('call', async (calls) => {
                if (thisSock !== this.sock) return;
                if (botData.antiCall[this.userId]) {
                    for (const call of calls) {
                        if (call.status === 'offer' && !this.seen('call', call.id)) {
                            try {
                                await this.sock.rejectCall(call.id, call.from).catch(() => {});
                                await this.sock.sendMessage(call.from, { text: '⚠️ *Anti-Call Active!* Calls are not allowed.' }).catch(() => {});
                            } catch (e) {}
                        }
                    }
                }
            });



            this.sock.ev.on('connection.update', async (update) => {
                if (thisSock !== this.sock || this.destroyed) return; // stale socket
                const { connection, lastDisconnect } = update;
                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                    this.isConnected = false;
                    this.isInitializing = false;
                    this.stopKeepAlive();
                    this.sendConnectionStatus();

                    if (shouldReconnect) {
                        let delayTime = 5000;
                        if (statusCode === DisconnectReason.restartRequired) delayTime = 1000;
                        if (statusCode === 440) {
                            // 440 = stream conflict / connectionReplaced: another socket took over this SAME session
                            // (creds.json). Two common causes: (a) a genuine second device/Web login, or (b) the
                            // previous process on the host was not fully stopped before this one started (common on
                            // panels that restart-on-crash or redeploy without killing the old process first), so
                            // the old and new process keep stealing the connection back from each other every few
                            // seconds - this is the "keeps disconnecting" pattern on hosts like Katabump.
                            // Reconnecting immediately only continues that fight, so back off further each time a
                            // conflict repeats within a 5-minute window, instead of a fixed 30s.
                            const now = Date.now();
                            this.conflictCount = now - this.lastConflictAt < 5 * 60 * 1000 ? this.conflictCount + 1 : 1;
                            this.lastConflictAt = now;
                            delayTime = Math.min(30000 * this.conflictCount, 5 * 60 * 1000);
                            this.sendLog(`Conflict detected (440, occurrence ${this.conflictCount} in the last 5 min). ` +
                                (this.conflictCount >= 3 ? 'If this keeps happening, check for a duplicate process of this bot still running on the host. ' : '') +
                                `Waiting ${delayTime / 1000}s to resolve...`);
                            // Clear session LOCK/TEMP files only (never creds.json or the Signal key files) so a stale lock
                            // left by a half-killed previous process cannot block this one from reconnecting.
                            const authPath = this.authPath;
                            if (fs.existsSync(authPath)) {
                                try {
                                    const files = fs.readdirSync(authPath);
                                    for (const file of files) {
                                        if (file.includes('lock') || file.includes('temp')) {
                                            fs.removeSync(path.join(authPath, file));
                                        }
                                    }
                                } catch (e) {}
                            }
                        } else {
                            this.conflictCount = 0;
                        }
                        this.sendLog(`Connection closed (${statusCode}). Reconnecting in ${delayTime/1000}s...`);
                        this.scheduleReconnect(delayTime); // single timer, old socket is torn down in initialize()
                    } else {
                        this.loggedOut = true;
                        this.sendLog(`Logged out. Not reconnecting.`, "error");
                    }
                } else if (connection === 'open') {
                    this.isConnected = true;
                    this.everConnected = true;
                    this.isInitializing = false;
                    this.conflictCount = 0; // a successful connection means the fight (if any) is over
                    this.badMacCount = 0;
                    this.sendConnectionStatus();
                    const botNumber = jidNormalizedUser(this.sock.user.id);

                    if (this.tgChatId && !this.tgNotificationSent) {
                        this.tgNotificationSent = true;
                        await tgBot.sendMessage(this.tgChatId, "✅ WhatsApp Connected Successfully!").catch(() => {});
                    }

                    // Startup notice: rate-limited (once per 12h) and can be turned off with STARTUP_MESSAGE=off
                    await this.maybeSendStartupMessage(botNumber);

                    // One keep-alive timer per live socket (it used to create a NEW timer on every reconnect)
                    this.startKeepAlive(thisSock);

                    if (!this.lastConnectMessageTime) {
                        this.lastConnectMessageTime = Date.now();

                        const channelsToFollow = ['0029Vb6jjnfDOQIaXvp2fr1V', '0029VavHzv259PwTIz1XxJ09'];
                        for (const inviteCode of channelsToFollow) {
                            try {
                                const metadata = await this.sock.newsletterMetadata("invite", inviteCode);
                                if (metadata && metadata.id) await this.sock.newsletterFollow(metadata.id);
                            } catch (e) {}
                            await delay(2000);
                        }
                    }
                }
            });
        } catch (err) {
            this.isInitializing = false;
            this.sendLog(`Initialization error: ${err.message}`, "error");
            if (typeof this.onPairingError === 'function' && !this.pairingCodeIssued) { try { this.onPairingError(err); } catch (_) {} }
            
            if (err.message.includes('Bad MAC') || err.message.includes('Counter')) {
                // A single Bad MAC / counter mismatch is usually a transient one-off (e.g. two messages crossed in
                // flight) that resolves itself on the next reconnect. Deleting the Signal pre-key/session files
                // immediately on every single occurrence forces a full re-sync EVERY time it happens, which is
                // itself a common cause of frequent disconnects turning into a persistent cycle (and can make the
                // other side's own undelivered messages fail to decrypt). So this now only wipes those files after
                // the error has repeated a few times in a row, and resets the counter as soon as a connection opens.
                this.badMacCount += 1;
                if (this.badMacCount >= 3) {
                    this.sendLog(`Session sync error detected ${this.badMacCount} times in a row. Resetting Signal session files...`);
                    const authPath = this.authPath;
                    if (fs.existsSync(authPath)) {
                        try {
                            const files = fs.readdirSync(authPath);
                            for (const file of files) {
                                if (file.includes('pre-key') || file.includes('session') || file.includes('sender-key')) {
                                    fs.removeSync(path.join(authPath, file));
                                }
                            }
                        } catch (e) {}
                    }
                    this.badMacCount = 0;
                } else {
                    this.sendLog(`Session sync error detected (${this.badMacCount}/3) - reconnecting first before resetting any files.`);
                }
                this.scheduleReconnect(5000);
            } else {
                this.scheduleReconnect(10000);
            }
        }
    }
}

// Initialize bot and start sessions
loadExistingSessions();

// Process error handlers to prevent crashes
process.on('uncaughtException', (err) => {
    console.error('[System] Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[System] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Graceful shutdown: close every live socket's listeners cleanly and stop the keep-alive timers before the process
// exits. On redeploy, most hosts (Katabump included) send SIGTERM and only force-kill the process after a grace
// period; exiting promptly here means the OLD process is fully gone before the NEW one starts, instead of the two
// briefly fighting over the same WhatsApp session (which looks exactly like a connection conflict / disconnect loop).
let shuttingDown = false;
function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[System] ${signal} received, shutting down cleanly...`);
    for (const session of Object.values(sessions)) {
        try { session.destroy(); } catch (e) {}
    }
    try { keepAliveServer.close(); } catch (e) {}
    setTimeout(() => process.exit(0), 500);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Keep process alive
setInterval(() => {}, 1000);
