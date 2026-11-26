// .ping — live server monitor.
// All numbers are read from the running system (nothing is random or hard-coded).
// Metrics that the hosting platform does not expose are shown as "n/a".
//
// PING_STYLE (optional env):  text (default)  |  rich
//   text = formatted text card (works everywhere)
//   rich = WhatsApp rich "HTML dashboard" message. It uses an experimental payload that cannot be
//          verified without a live WhatsApp test, so it is opt-in. If sending it fails, the text card is sent.
const os = require('os');
const fs = require('fs');
const settings = require('../settings');

const GB = 1024 ** 3, MB = 1024 ** 2;
const pad = (n) => String(n).padStart(2, '0');
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (used, total) => (total > 0 ? Math.min(100, (used / total) * 100) : null);
const fmtPct = (p) => (p === null ? 'n/a' : `${p.toFixed(1)}%`);
const bar = (p, len = 10) => {
    if (p === null) return '▱'.repeat(len);
    const filled = Math.round((p / 100) * len);
    return '▰'.repeat(filled) + '▱'.repeat(len - filled);
};

function formatUptime(seconds) {
    seconds = Math.floor(seconds);
    const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
}

/** Pakistan time (Asia/Karachi = UTC+5, no daylight saving). */
function pkNow() {
    const d = new Date(Date.now() + 5 * 3600 * 1000);
    const hour24 = d.getUTCHours();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return {
        time: `${pad(hour24 % 12 || 12)}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${hour24 >= 12 ? 'PM' : 'AM'}`,
        date: `${days[d.getUTCDay()]}, ${d.getUTCDate()} ${mons[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
    };
}

function readNumber(file) {
    try {
        const raw = fs.readFileSync(file, 'utf8').trim();
        if (!raw || raw === 'max') return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
    } catch (_) { return null; }
}

/** Memory limit/usage of the container (cgroup v2 or v1), or null when not running in a limited container. */
function containerMemory() {
    const limit = readNumber('/sys/fs/cgroup/memory.max') ?? readNumber('/sys/fs/cgroup/memory/memory.limit_in_bytes');
    const used = readNumber('/sys/fs/cgroup/memory.current') ?? readNumber('/sys/fs/cgroup/memory/memory.usage_in_bytes');
    if (!limit || !used || limit > os.totalmem() * 4) return null; // "unlimited" shows up as a huge number
    return { used, total: limit };
}

/** Disk usage of the filesystem that holds "/" (uses fs.statfsSync, Node 18.15+). */
function diskUsage() {
    try {
        if (typeof fs.statfsSync !== 'function') return null;
        const s = fs.statfsSync('/');
        const total = s.blocks * s.bsize;
        if (!total) return null;
        return { used: total - s.bavail * s.bsize, total };
    } catch (_) { return null; }
}

function collectStats(latencyMs) {
    const cores = (os.cpus() || []).length || 1;
    const load = os.loadavg(); // always [0,0,0] on Windows
    const hasLoad = os.platform() !== 'win32';
    const totalMem = os.totalmem(), usedMem = totalMem - os.freemem();
    const mem = process.memoryUsage();
    return {
        latency: latencyMs,
        pk: pkNow(),
        os: `${os.platform()} ${os.release()}`,
        arch: os.arch(),
        cores,
        loadAvg: hasLoad ? load.map((n) => n.toFixed(2)) : null,
        cpuPct: hasLoad ? pct(load[0], cores) : null,
        ram: { used: usedMem, total: totalMem, pct: pct(usedMem, totalMem) },
        container: containerMemory(),
        disk: diskUsage(),
        node: process.version,
        heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, rss: mem.rss,
        botUptime: process.uptime(), sysUptime: os.uptime(),
    };
}

const gb = (n) => (n / GB).toFixed(2);
const mb = (n) => (n / MB).toFixed(1);

function textCard(s, botName) {
    const L = '─'.repeat(26);
    const row = (t) => `│ │ ♡≫ ${t}`;
    const rows = [
        `┌${L}◇`,
        `│ 📡 *${botName} — SERVER MONITOR*`,
        `│(ツ)${'─'.repeat(20)}(ツ)`,
        row(`⚡ Response: ${s.latency === null ? 'n/a' : `${s.latency} ms`}`),
        row(`🕒 Time (PKT): ${s.pk.time}`),
        row(`📅 Date: ${s.pk.date}`),
        row(`🐧 OS: ${s.os} (${s.arch})`),
        row(`🖥️ CPU: ${s.cores} core${s.cores === 1 ? '' : 's'} • load ${s.loadAvg ? s.loadAvg.join(' / ') : 'n/a'}`),
        row(`     ${bar(s.cpuPct)} ${fmtPct(s.cpuPct)}`),
        row(`🧠 RAM (host): ${gb(s.ram.used)} / ${gb(s.ram.total)} GB`),
        row(`     ${bar(s.ram.pct)} ${fmtPct(s.ram.pct)}`),
    ];
    if (s.container) {
        const p = pct(s.container.used, s.container.total);
        rows.push(row(`📦 Container: ${mb(s.container.used)} / ${mb(s.container.total)} MB`), row(`     ${bar(p)} ${fmtPct(p)}`));
    }
    if (s.disk) {
        const p = pct(s.disk.used, s.disk.total);
        rows.push(row(`💾 Disk (/): ${gb(s.disk.used)} / ${gb(s.disk.total)} GB`), row(`     ${bar(p)} ${fmtPct(p)}`));
    } else rows.push(row('💾 Disk (/): n/a'));
    rows.push(
        row(`🟢 Node.js: ${s.node}`),
        row(`📈 Heap: ${mb(s.heapUsed)} / ${mb(s.heapTotal)} MB • RSS ${mb(s.rss)} MB`),
        row(`⏱️ Bot uptime: ${formatUptime(s.botUptime)}`),
        row(`🖧 System uptime: ${formatUptime(s.sysUptime)}`),
        `└${L}○`,
        `> _${botName}_`,
    );
    return rows.join('\n');
}

// ---------------------------------------------------------------------------
// Optional rich HTML dashboard (local template, no remote download)
// ---------------------------------------------------------------------------
function htmlDashboard(s, botName) {
    const tile = (label, value) => `<div class="tile"><div class="lbl">${escapeHtml(label)}</div><div class="val">${escapeHtml(value)}</div></div>`;
    const meter = (label, detail, p) => `<div class="m"><div class="mh"><span>${escapeHtml(label)}</span><span>${escapeHtml(detail)}</span></div>` +
        `<div class="track"><div class="fill" style="width:${p === null ? 0 : p.toFixed(1)}%"></div></div></div>`;
    const diskP = s.disk ? pct(s.disk.used, s.disk.total) : null;
    const meters = [
        meter('CPU load', `${s.cores} core${s.cores === 1 ? '' : 's'} • ${fmtPct(s.cpuPct)}`, s.cpuPct),
        meter('RAM (host)', `${gb(s.ram.used)} / ${gb(s.ram.total)} GB • ${fmtPct(s.ram.pct)}`, s.ram.pct),
    ];
    if (s.container) { const p = pct(s.container.used, s.container.total); meters.push(meter('Container', `${mb(s.container.used)} / ${mb(s.container.total)} MB • ${fmtPct(p)}`, p)); }
    meters.push(meter('Disk (/)', s.disk ? `${gb(s.disk.used)} / ${gb(s.disk.total)} GB • ${fmtPct(diskP)}` : 'n/a', diskP));
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;background:#0b1220;color:#e6edf7;padding:14px}
.card{background:linear-gradient(160deg,#111b30,#0b1220);border:1px solid #22304d;border-radius:16px;padding:16px}
h1{font-size:17px}h2{font-size:12px;color:#7f93b5;font-weight:500;margin-top:2px}
.lat{margin:14px 0;font-size:30px;font-weight:700;color:#4ade80}.lat small{font-size:13px;color:#7f93b5;font-weight:500}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}
.tile{background:#101a2e;border:1px solid #1d2a45;border-radius:10px;padding:8px 10px}.lbl{font-size:10px;letter-spacing:.08em;color:#7f93b5;text-transform:uppercase}.val{font-size:13px;margin-top:2px;word-break:break-word}
.m{margin:10px 0}.mh{display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px}.track{height:8px;background:#1a2540;border-radius:99px;overflow:hidden}.fill{height:100%;background:linear-gradient(90deg,#22d3ee,#4ade80);border-radius:99px}
.ft{margin-top:12px;font-size:10px;color:#5d7094;text-align:center}
</style></head><body><div class="card">
<h1>📡 ${escapeHtml(botName)} · Server Monitor</h1><h2>${escapeHtml(s.pk.date)} • ${escapeHtml(s.pk.time)} (PKT)</h2>
<div class="lat">${s.latency === null ? 'n/a' : escapeHtml(s.latency)} <small>ms response</small></div>
${meters.join('')}
<div class="grid">${[
        tile('OS', `${s.os}`), tile('Arch', s.arch), tile('Node.js', s.node), tile('Load avg', s.loadAvg ? s.loadAvg.join(' / ') : 'n/a'),
        tile('Heap', `${mb(s.heapUsed)} / ${mb(s.heapTotal)} MB`), tile('RSS', `${mb(s.rss)} MB`),
        tile('Bot uptime', formatUptime(s.botUptime)), tile('System uptime', formatUptime(s.sysUptime)),
    ].join('')}</div>
<div class="ft">${escapeHtml(botName)}</div></div></body></html>`;
}

/** True only if the installed Baileys protobuf knows the fields the rich payload needs. */
function richSupported() {
    try {
        const { proto } = require('@whiskeysockets/baileys');
        return !!(proto && proto.Message && 'botForwardedMessage' in proto.Message.prototype);
    } catch (_) { return false; }
}

async function sendRich(sock, from, html, botName) {
    const crypto = require('crypto');
    const responseId = crypto.randomUUID();
    const data = Buffer.from(JSON.stringify({
        response_id: responseId,
        sections: [{ view_model: { primitive: { __typename: 'GenAIaeacdsnwHtmlPrimitive', payload: html, trusted_sources: [] }, __typename: 'GenAISingleLayoutViewModel' } }],
    })).toString('base64');
    await sock.relayMessage(from, {
        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2, botMetadata: { messageDisclaimerText: '', botResponseId: responseId } },
        botForwardedMessage: {
            message: {
                richResponseMessage: {
                    messageType: 1,
                    submessages: [{ messageType: 2, messageText: `${botName} · Server Monitor` }],
                    unifiedResponse: { data },
                    contextInfo: { forwardingScore: 1, isForwarded: true, forwardedAiBotMessageInfo: { botJid: '867051314767696@bot' }, forwardOrigin: 4 },
                },
            },
        },
    }, { messageId: responseId });
}

// ---------------------------------------------------------------------------
// .ping
// ---------------------------------------------------------------------------
async function run(sock, from, msg) {
    const botName = settings.botName || 'Mithu_MD MINI';
    // Real round-trip: how long WhatsApp takes to accept a message from this bot.
    const t0 = Date.now();
    const sent = await sock.sendMessage(from, { text: '🏓 Pinging...' }, { quoted: msg }).catch(() => null);
    const latency = sent ? Date.now() - t0 : null;

    const stats = collectStats(latency);
    // One visible message: the "Pinging..." placeholder is EDITED into the result (a new message is only sent if editing fails).
    const show = async (text) => {
        if (sent && sent.key) {
            try { await sock.sendMessage(from, { text, edit: sent.key }); return; } catch (_) { /* fall through */ }
        }
        await sock.sendMessage(from, { text }, { quoted: msg });
    };
    if ((process.env.PING_STYLE || '').toLowerCase() === 'rich' && richSupported()) {
        try {
            await sendRich(sock, from, htmlDashboard(stats, botName), botName);
            if (sent && sent.key) await sock.sendMessage(from, { text: '📡 Server monitor ↓', edit: sent.key }).catch(() => {});
            return;
        } catch (_) { /* fall through to the text card */ }
    }
    await show(textCard(stats, botName));
}

module.exports = { run, collectStats, textCard, htmlDashboard, formatUptime, pkNow, richSupported };
