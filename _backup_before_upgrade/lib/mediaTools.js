// ffmpeg / sharp helpers used by sticker, toimage, voice, gif commands. Everything works on Buffers and temp files
// that are always deleted. ffmpeg comes from the project's ffmpeg-static dependency, or the system "ffmpeg".
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

function ffmpegBin() {
    try { const p = require('ffmpeg-static'); if (p && fs.existsSync(p)) return p; } catch (_) { /* fall back */ }
    return 'ffmpeg';
}

function run(args, timeout = 90000) {
    return new Promise((resolve, reject) => {
        const child = spawn(ffmpegBin(), ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
        let err = ''; let done = false;
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} if (!done) { done = true; reject(new Error('Conversion timed out.')); } }, timeout);
        child.stderr.on('data', (d) => { err = (err + d).slice(-800); });
        child.on('error', (e) => { clearTimeout(timer); if (!done) { done = true; reject(new Error(e.code === 'ENOENT' ? 'ffmpeg is not available on this server.' : e.message)); } });
        child.on('close', (code) => { clearTimeout(timer); if (done) return; done = true; code === 0 ? resolve() : reject(new Error(/Invalid argument|does not contain any stream/.test(err) ? 'That file has no usable audio/video stream.' : 'Conversion failed: ' + err.split('\n').filter(Boolean).pop())); });
    });
}

/** Run fn(dir) inside a private temp dir that is removed afterwards. */
async function withTmp(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mithu-'));
    try { return await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const rid = () => crypto.randomBytes(5).toString('hex');

/** Convert an animated GIF (or any short clip) to an MP4 that WhatsApp plays as a GIF. */
function toMp4(buffer) {
    return withTmp(async (dir) => {
        const inp = path.join(dir, 'in.bin'); const out = path.join(dir, 'out.mp4');
        fs.writeFileSync(inp, buffer);
        await run(['-i', inp, '-movflags', 'faststart', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-an', out]);
        return fs.readFileSync(out);
    });
}

const STICKER_VF = 'scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0';

/** Short video/GIF -> animated WebP sticker (max 8s, shrinks quality until it fits WhatsApp's ~1 MB limit). */
function videoToWebp(buffer) {
    return withTmp(async (dir) => {
        const inp = path.join(dir, 'in.bin'); fs.writeFileSync(inp, buffer);
        for (const t of [{ q: 45, fps: 15 }, { q: 30, fps: 12 }, { q: 20, fps: 10 }]) {
            const out = path.join(dir, `o${t.q}.webp`);
            await run(['-t', '8', '-i', inp, '-vf', `fps=${t.fps},${STICKER_VF}`, '-c:v', 'libwebp', '-lossless', '0', '-quality', String(t.q),
                '-compression_level', '6', '-loop', '0', '-an', out]);
            const b = fs.readFileSync(out);
            if (b.length <= 950 * 1024) return b;
        }
        throw new Error('The sticker is too big even at the lowest quality. Use a shorter clip.');
    });
}

/** Any audio/video -> WhatsApp voice note (Opus in Ogg). */
function toVoiceNote(buffer) {
    return withTmp(async (dir) => {
        const inp = path.join(dir, 'in.bin'); const out = path.join(dir, 'out.ogg');
        fs.writeFileSync(inp, buffer);
        await run(['-i', inp, '-vn', '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', '-f', 'ogg', out], 120000);
        return fs.readFileSync(out);
    });
}

module.exports = { run, withTmp, rid, toMp4, videoToWebp, toVoiceNote };
