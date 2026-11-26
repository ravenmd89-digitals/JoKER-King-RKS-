// Turns a remote audio link (from the YouTube-download API etc.) into a VERIFIED, guaranteed-playable WhatsApp audio
// payload. Used by every command that sends audio from a 3rd-party link (.play, .song, .ytmp3, .spotify) so none of
// them can send WhatsApp a broken file.
//
// Root cause this exists to fix: those commands used to hand Baileys `{ audio: { url } }` directly - a raw remote
// link, trusted blindly, with no "seconds" (duration) set. WhatsApp then shows 0:00 and "Sorry, can't load this
// audio now" whenever that link is not actually a clean, directly-playable audio stream (wrong codec/container,
// a slow/interrupted download, or the 3rd-party API returning an error page under an audio-looking URL).
//
// Fix: download the bytes ourselves, confirm with ffprobe that they are real audio, re-encode to a plain MP3 (so the
// format Baileys/WhatsApp receives is always known-good regardless of what the source actually served), measure the
// REAL duration from the converted file, and only then hand Baileys real bytes + the real duration.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getBuffer, why } = require('./net');
const { withTmp, run: runFfmpeg } = require('./mediaTools');
const { UserError } = require('./plugins');

function ffprobeBin() {
    try {
        const ffmpegPath = require('ffmpeg-static');
        if (ffmpegPath) {
            const candidate = ffmpegPath.replace(/ffmpeg(\.exe)?$/i, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
            if (candidate !== ffmpegPath && fs.existsSync(candidate)) return candidate;
        }
    } catch (_) { /* fall back to a system ffprobe */ }
    return 'ffprobe';
}

/** ffprobe a local file -> { format: { duration }, streams: [{ codec_type, codec_name }, ...] } */
function probe(file, timeout = 20000) {
    return new Promise((resolve, reject) => {
        let child;
        try { child = spawn(ffprobeBin(), ['-v', 'error', '-show_entries', 'format=duration', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', file], { stdio: ['ignore', 'pipe', 'pipe'] }); }
        catch (e) { return reject(e); }
        let out = ''; let err = ''; let done = false;
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} if (!done) { done = true; reject(new Error('probe timed out')); } }, timeout);
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { err = (err + d).slice(-500); });
        child.on('error', (e) => { clearTimeout(timer); if (done) return; done = true; reject(new Error(e.code === 'ENOENT' ? 'ffprobe is not available on this server.' : e.message)); });
        child.on('close', (code) => {
            clearTimeout(timer); if (done) return; done = true;
            if (code !== 0) return reject(new Error('ffprobe failed: ' + (err.split('\n').filter(Boolean).pop() || `exit code ${code}`)));
            try { resolve(JSON.parse(out)); } catch (_) { reject(new Error('ffprobe returned unreadable output')); }
        });
    });
}

const MAX_SOURCE_BYTES = 40 * 1024 * 1024; // the source link is downloaded fully before anything is trusted

/**
 * Downloads `url`, verifies it is real decodable audio, re-encodes it to a plain MP3 and measures its real
 * duration. Returns { buffer, mimetype: 'audio/mpeg', seconds, ptt: false } - ready to hand straight to
 * sock.sendMessage(jid, { audio: buffer, mimetype, seconds, ptt, fileName }).
 * Throws a UserError with a specific, user-facing reason on any failure; never returns something unverified.
 */
async function prepareAudioMessage(url) {
    let dl;
    try {
        dl = await getBuffer(url, { maxBytes: MAX_SOURCE_BYTES, timeout: 60000, headers: { Accept: 'audio/*,*/*;q=0.8' } });
    } catch (e) {
        throw new UserError(`Could not download the audio (${why(e)}).`);
    }
    if (!dl.buffer || dl.buffer.length < 2048) throw new UserError('The audio service returned an empty or invalid file.');
    const head = dl.buffer.slice(0, 64).toString('utf8').trim();
    if (/^\s*[<{]/.test(head) || /^<!doctype html/i.test(head)) throw new UserError('The audio service returned an error page instead of an audio file.');

    return withTmp(async (dir) => {
        const inp = path.join(dir, 'in.bin');
        fs.writeFileSync(inp, dl.buffer);

        let srcInfo;
        try { srcInfo = await probe(inp); } catch (e) { throw new UserError(`That is not a valid audio file (${e.message}).`); }
        const hasAudio = ((srcInfo && srcInfo.streams) || []).some((s) => s.codec_type === 'audio');
        if (!hasAudio) throw new UserError('The downloaded file has no audio in it - the source link was not real audio.');

        const out = path.join(dir, 'out.mp3');
        try {
            // Re-encode regardless of the source codec/container: this is what guarantees a clean, universally
            // playable file reaches WhatsApp even when the source was mislabeled, partial, or an unusual codec.
            await runFfmpeg(['-i', inp, '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k', out], 120000);
        } catch (e) {
            throw new UserError(`Could not convert the audio (${e.message}).`);
        }
        if (!fs.existsSync(out)) throw new UserError('Audio conversion produced no output.');
        const buffer = fs.readFileSync(out);
        if (!buffer.length) throw new UserError('Audio conversion produced an empty file.');

        let outInfo;
        try { outInfo = await probe(out); } catch (e) { throw new UserError('Could not verify the converted audio.'); }
        const seconds = Math.round(parseFloat((outInfo.format && outInfo.format.duration) || 0));
        if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) throw new UserError('Could not determine the audio duration.');

        return { buffer, mimetype: 'audio/mpeg', seconds, ptt: false };
    });
}

module.exports = { prepareAudioMessage, probe, ffprobeBin, MAX_SOURCE_BYTES };
