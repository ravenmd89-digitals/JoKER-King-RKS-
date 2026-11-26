# WhatsApp Automation Tool - JoKER King RKS MD

Professional WhatsApp Automation Tool with improved two-stage dashboard.

## Features

### Stage 1: Mobile Pairing (Initial Screen)
- Clean, minimal dashboard showing only:
  - Mobile number input field
  - "GENERATE PAIR CODE" button
  - Live console for logs

### Stage 2: Messaging (After Device Linking)
- Message type selector: Single or Multiple numbers
- **Single Number Mode**: Send to one number with custom speed
- **Multiple Numbers Mode**: Add multiple numbers and send bulk messages
- File upload for messages
- Live progress tracking
- Connection status display
- Logout option

## Installation

### Prerequisites
- Node.js 16+ 
- npm or yarn

### Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment**
   - Edit `.env` file if needed (default PORT: 22019)

3. **Start Server**
   ```bash
   npm start
   ```
   
   Or for development with auto-reload:
   ```bash
   npm run dev
   ```

4. **Access Application**
   - Open browser: `http://localhost:22019`

## Usage

### Step 1: Initial Screen - Mobile Pairing
1. You will see only the mobile number input field
2. Enter your WhatsApp mobile number (e.g., 923052062145)
3. Click "GENERATE PAIR CODE"
4. Copy the 8-digit code from the console
5. Open WhatsApp > Settings > Linked Devices > Link with phone number
6. Enter the pairing code

### Step 2: After Linking - New Dashboard
Once your device is successfully linked, the dashboard will automatically change to show:
- **SELECT MESSAGE TYPE** section with two options:
  - 📱 SINGLE NUMBER
  - 👥 MULTIPLE NUMBERS

#### Single Number Mode
- Enter victim number
- Set speed (minimum 5 seconds)
- Upload message file (.txt)
- Click "START NOW"

#### Multiple Numbers Mode
- Add multiple numbers one by one using the "+ ADD" button
- Set speed (minimum 5 seconds)
- Upload message file (.txt)
- Click "START NOW"

### Step 3: Monitor Progress
- Watch live console for real-time updates
- View statistics: Rounds, Sent, Failed
- Click "STOP SENDING" to halt the process

## File Format

### Message File (.txt)
Create a `.txt` file with your message content:
```
Hello! This is an automated message.
Please reply if you receive this.
```

## API Endpoints

- `POST /api/pair` - Request pairing code
- `POST /api/start-send` - Start sending messages
- `POST /api/stop-send` - Stop sending messages
- `POST /api/upload-numbers` - Upload numbers file
- `GET /api/status` - Get connection status
- `POST /api/logout` - Logout from WhatsApp

## Important Notes

- **Two-Stage Design**: Stage 1 shows only pairing; Stage 2 appears after successful linking
- **Minimum delay**: 5 seconds between messages (anti-ban protection)
- **Auto-cleaning**: Phone numbers are automatically formatted
- **Session credentials**: Saved locally in `auth_info/` directory
- **Continuous sending**: Messages continue until stopped
- **File uploads**: Temporary files are deleted after use

## Troubleshooting

### Connection Issues
- Check console for detailed error messages
- Re-pair if connection drops
- Ensure WhatsApp is properly linked

### Pairing Code Not Appearing
- Wait 5-10 seconds after clicking "GENERATE PAIR CODE"
- Check browser console for errors
- Try with a different number

### Messages Not Sending
- Verify WhatsApp is properly linked
- Check that numbers are valid
- Ensure message file is in `.txt` format
- Review console logs for specific errors

## Branding

Powered by **JoKER King RKS MD**

[Join WhatsApp Channel](https://whatsapp.com/channel/0029Vb68jsVDuMRjNEdEwa3b)

## License

For JoKER King RKS MD use only.


---

## Commands added in this update (v2 command pack)

Each new command is its own file in `commands/` (plugin style: `module.exports = { name, aliases, category, run }`).
`lib/plugins.js` loads them automatically at start-up, the old `switch` in `index.js` still serves the older commands,
and `commands/menu.js` is the single place that lists them in the menu. Run `node scripts/check-commands.js` after
`npm install` to verify that every menu entry is a registered command.

The command **prefix is configurable**: `.setprefix !` (owner), `.prefix` shows it. The menu uses it everywhere.

### What needs an API key / external service

| Commands | Needs | Environment variables |
|---|---|---|
| `.ai` | OpenAI-compatible provider (Groq, OpenRouter, OpenAI ...) | `OPENAI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` |
| `.gpt .deepseek .deep` | same provider; a default model is used on Groq/OpenRouter | optional `AI_GPT_MODEL`, `AI_DEEPSEEK_MODEL` |
| `.claude .gemini` | a provider that offers them (e.g. OpenRouter) | `AI_CLAUDE_MODEL`, `AI_CLAUDE_BASE_URL`, `AI_CLAUDE_API_KEY` (same pattern `AI_GEMINI_*`) |
| `.blackbox .islamai .islam .proxabdullah` | the default AI provider (`blackbox` = coding assistant, `islamai` = careful Islamic Q&A with a scholar disclaimer) | optional `AI_<NAME>_MODEL` |
| `.texttoimage .aiimg .imagine .draw` | free Pollinations service, no key | optional `IMAGE_API_URL` |
| `.removebg` | remove.bg key | `REMOVEBG_API_KEY` |
| `.movie` | OMDb key for films (without it only TV shows via TVMaze) | `OMDB_API_KEY` |
| `.google .search .img` | Google Custom Search (otherwise DuckDuckGo) | `GOOGLE_API_KEY`, `GOOGLE_CX` |
| `.github .gitclone` | none (token only raises the rate limit) | optional `GITHUB_TOKEN` |
| `.praytime` | none | optional `PRAYER_COUNTRY`, `PRAYER_METHOD` |
| `.pair .clonebot` | owner-only unless opened | optional `PAIR_PUBLIC=on`, `MAX_SESSIONS` |
| everything else | free public services, no key | - |

See `.env.example` for the full list. Never commit your real `.env`.

### Honest notes
- Downloaders (`.tiktok .instagram .facebook .twitter .mediafire .pinterest .play .youtube ...`) use public third-party
  services (tikwm, vxtwitter, the same davidcyriltech API the old `.song` uses, Aptoide, GitHub, thum.io ...).
  Such services change or disappear; when every provider fails the user gets a clear message, never a fake file.
- `.spotify` has no Spotify download API: it reads the track name from the link and sends the matching YouTube audio.
- `.remini` is a local non-AI enhancer (2x upscale + sharpen). `.ephoto` styles (`.neon .glitch ...`) are rendered locally;
  they are original styles, not the ephoto360.com templates (bundled font: `assets/fonts`).
- `.sim` (SIM-owner lookup) is intentionally **not** implemented: it exposes private personal data.
- ANIME `kick` clashes with the GROUP `kick` (remove member); the anime picture is `.animekick`.
- `.hotanime` shows currently trending anime (safe-for-work list), `.hack` is a labelled prank.
- `.vv`/`.vv2` only work while WhatsApp still serves the view-once media.

### The "constant message" bug (root causes found in `index.js`)
1. The bot's own sends echo back through `messages.upsert`. Statuses were handled with no `fromMe`/type check, so every
   status reaction came back as a "new status" and was reacted to again -> endless loop. Now: only live (`notify`)
   messages are processed, the bot remembers the ids it sent, every message/status id is handled once, and reactions,
   protocol messages and own statuses are ignored.
2. A new `setInterval` (profile "About" refresh) was created on **every** reconnect and never cleared. Now one
   keep-alive timer per live socket, cleared on close.
3. Reconnects created a new socket without removing the old one's listeners. Now the old socket is torn down first,
   there is one pending reconnect timer, and listeners of stale sockets ignore events.
4. The "IS ONLINE" start-up message is sent at most once per 12 hours (persisted) and can be turned off with `STARTUP_MESSAGE=off`.
5. Offline backlog (`append`) and messages older than 3 minutes are no longer re-run as commands after a reconnect.

Auto message reactions use only the emoji pool in `lib/emojis.js` (once per message); automatic status reactions use only 🤡
(once per status). The command progress reactions (⏳ / ✅ / ❌) are separate feedback and are unchanged.

## .vv / .vv2 (view-once reveal)

Both commands work the same way: reply to a view-once image, video or voice note.
- A short random cute message (see `lib/viewOnce.js` -> `CUTE_REPLIES`, edit that list to customise it) is sent back
  in the **same chat** the command was used in - never the media itself, so a group never sees what was inside it.
  Audio uses the original message's own mimetype where supported; WhatsApp's own apps do not let every client send
  a view-once voice note, but one that is received is handled the same way as an image or video.
- The actual revealed media is sent privately to the **bot owner's own chat** (`settings.ownerNumber`), never into
  the original chat or group. If no owner number is configured, only the cute reply is sent.
- `.vv` is public; `.vv2` is owner-only. Both use the same underlying code (`lib/viewOnce.js`).
- This only works on a view-once message already delivered to this bot account - the normal way any WhatsApp
  client decrypts media sent to it, not a bypass of WhatsApp's encryption or access controls. If the media has
  expired, was already removed, or fails to download, the command replies with a clear error instead of the media.

## Why the bot used to disconnect repeatedly

See the comments at these exact spots in `index.js` for the full explanation of each cause and its fix:
- `keepAliveServer` (near the top): no process was listening on `PORT`, and panels like Katabump health-check a web
  process by its port - without one, the platform can restart the container (and kill the live WhatsApp socket) on
  a schedule that looks exactly like "random disconnects". A minimal HTTP server is now bound to `PORT` (default 22019).
- `getMessage` callback in `initialize()`: `messageLogs` was declared but never written to, so WhatsApp's "please
  resend" retry receipts always got an empty message back, which contributes to decrypt-retry / "Bad MAC" churn.
  It is now actually filled (bounded to the last 200 messages per session) by `logMessage()`.
- the `fetchLatestBaileysVersion()` call at the start of `initialize()`: a single network hiccup fetching the
  version string used to abort the entire reconnect attempt. The last known-good version is now cached and reused.
- the `connection.update` "close" handler, `statusCode === 440` branch: a genuine stream conflict (e.g. a leftover
  process from a previous deploy still running) used to retry on a fixed 30s schedule, so two processes could keep
  fighting over the same session indefinitely. It now backs off further each time a conflict repeats within 5
  minutes, and logs a hint to check for a duplicate process.
- the "Bad MAC"/"Counter" branch in the outer `catch`: it used to wipe the Signal pre-key/session files on every
  single occurrence, which forces a full resync each time and can itself cause more decrypt failures. It now only
  does that after 3 occurrences in a row.
- `process.on('SIGTERM'/'SIGINT', ...)` near the bottom: there was no graceful shutdown, so on a redeploy the old
  process could still be holding the WhatsApp connection when the new one started (another path to the same
  conflict). It now tears down every session and exits promptly on either signal.


## JOKER KING EDITION upgrade notes

- `.menu` first sends `assets/menu/menu_intro.mp4` (the original 7-second video, unmodified) with `gifPlayback`, then the menu card.
- `.ping` sends a LIVE MONITOR image (`lib/pingCard.js`) with real WhatsApp round-trip, send-ack, server-processing time, RAM, uptime, status and Node version.
- `.play` tries three audio sources in order (see `lib/download.js` -> `ytAudio`) and no longer needs `ffprobe` (`lib/audioTools.js`).
- Originals of every changed file are in `_backup_before_upgrade/`.


---

# Website pairing panel (JoKER King 👑 RKS MD)

Users can now get a WhatsApp pairing code in **two ways**, and both use the **same pairing backend** (`lib/pairingService.js` → the
existing `BotSession` / Baileys `requestPairingCode` / `sessions/` folders):

| Method | How |
|---|---|
| Telegram pairing bot | unchanged: send the number to the bot, it replies with the code |
| Website | open the site → **Pair** → type the number → real code appears |

The owner's `.pair` / `.clonebot` commands use the same service too.

## What the shared service guarantees
- One WhatsApp number = one session. A number linked through Telegram cannot be grabbed from the website, and vice versa.
- One pairing at a time per number; double clicks collapse into one request, simultaneous requests from different visitors get a clear "in progress".
- 60 s cooldown per number (shared by Telegram and website), per-visitor rate limit, cap on simultaneous pairing sockets (RAM protection).
- A **linked** session is never wiped by a website request. Only dead (logged-out) or abandoned (never linked, code expired) sessions are reclaimed.
- Unused pairing sockets are closed and their half-created folder removed after `PAIR_TTL_SEC` (default 240 s).
- Visitors only see friendly messages; WhatsApp/Baileys error text and stack traces stay in the console log.

## Files added / changed
- Added: `lib/pairingService.js`, `lib/webServer.js`, `web/` (layout, 5 pages + 404, `assets/` with CSS, JS, logo, favicon, icons, social image)
- Changed: `index.js` (Telegram number handler and `.pair` now call the shared service; the old keep-alive server is replaced by the same server + website; a few state flags on `BotSession`), `commands/getpair.js` (text only), `.env.example`, this README
- **No new npm dependencies** (the website uses Node's built-in `http`). `package.json` keeps the existing dependency set; the project branding and menu/play modules have been updated. Start command is still `node index.js`.
- The website and Telegram bot run in the **same Node process**, on **one** HTTP server/port.

## Website pages
`/` Home · `/pair` Pairing · `/guide` How to Pair · `/about` About / Developer · `/contact` Support · `/health` JSON health check (what Katabump/uptime monitors can ping)

The pairing website displays the configured WhatsApp Channel, Group, Owner contact, and TikTok links. The owner contact is intentionally public at the owner's request.

## Deploy on Katabump (free plan)

1. **Upload**: Katabump dashboard → your server → **Files** → upload this ZIP and unzip it in the server root (`/home/container`), or use SFTP.
   Keep your existing `sessions/` and `data/` folders — they hold the WhatsApp logins. `package.json` and `index.js` must stay at the root.
2. **Startup tab**: *JS FILE* = `index.js` (unchanged). Katabump runs `npm install` for you.
3. **Environment**: keep your `.env` (see `.env.example`). Needed: `TELEGRAM_TOKEN`. Optional website settings are in `.env.example`.
4. **Port**: the site listens on `0.0.0.0:<PORT>` (`PORT`, else `SERVER_PORT`, else 22019). Set `PORT` to the port Katabump allocated to your server.
5. **Start** and watch the Console. You should see:
   `[System] HTTP server listening on 0.0.0.0:<port> (health check + pairing website).`
6. **Open the site**: `http://<your-server-address>:<port>/` — the address/port are shown in your Katabump server page.

### Making the website publicly reachable (read this)
Listening on a port does **not** by itself make the site public. What I could verify from Katabump's own pages:
- the free plan has 308 MB RAM, the start script is your `package.json` start command, and every account can claim a **free `.kdns.fr` domain** in the dashboard (Domains section) and *"point it to any server or application hosted on your account"*;
- Katabump's documentation does **not** describe how a web port is published for the free plan. This could not be tested here, so it must be checked on your server.

Do this to confirm:
1. Start the bot and open `http://<server-address>:<port>/health` from your phone's mobile data. If you see `{"status":"ok",...}` the port is public.
2. If it does not load, ask Katabump support (Discord, linked from docs.katabump.com) to *publish your server's port* or tell you which port is public, then put that number in `PORT`.
3. Claim a free domain: dashboard → **Domains** → register `yourname.kdns.fr` → point it to this server. Then set `PUBLIC_URL=https://yourname.kdns.fr` (or `http://` if no HTTPS is offered).
4. If Katabump cannot expose a web port on the free plan, the Telegram pairing bot keeps working exactly as before; set `WEBSITE=off` to run without the website.

### Memory on the free plan (308 MB)
Each WhatsApp session uses a lot of RAM. `MAX_PENDING_PAIRINGS=2` limits how many website pairings can run at once, `MAX_SESSIONS=10` limits linked numbers
(lower it if you see out-of-memory restarts). Optional: set the start script to `node --max-old-space-size=256 index.js`, as Katabump's Node.js guide suggests.

## Security notes
- No secrets are served: only the files in `web/` are public (whitelist, no path traversal); `.env`, `sessions/`, `data/`, `lib/` are unreachable.
- `.env` and `sessions/` are in `.gitignore`; do not upload them anywhere public. **This ZIP contains your `.env`** — treat the ZIP as private.
- Website API: JSON only, custom header + same-origin check, honeypot field, 2 KB body limit, per-IP limits, security headers (CSP, nosniff, frame deny).
- Pairing codes only let the bot join as a linked device; the owner of the number can remove it any time in WhatsApp → Linked devices.

## Troubleshooting
- *"already linked"*: remove the bot in WhatsApp → Linked devices (that logs the session out) and request a new code.
- *"busy"*: raise `MAX_PENDING_PAIRINGS` only if you have RAM to spare.
- Website down but bot fine: check the Console line above and the `PORT` value.
