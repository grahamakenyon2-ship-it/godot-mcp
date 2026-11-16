# yt-watch — Alex's setup (5 minutes, one time)

Your PC becomes Vibe's "eyes" for YouTube videos, the same proven pattern as the Godot bridge.

## What you get
Vibe sends a job with a YouTube URL → this daemon opens **your real Chrome** (your IP, your profile),
watches the video like a human, captures full-res frames + transcript, and streams them to this repo
while it goes. Vibe reads the frames as they land and tells you what it's learning in real time.

## One-time setup

1. **You already have the repo.** The watcher lives inside the Godot relay repo
   (`E:\godot-mcp-master` on your PC). Just `git pull` it:
   ```powershell
   cd E:\godot-mcp-master
   git pull
   ```
   The daemon is `yt-watch\yt-watchd.mjs`. Run it FROM THE REPO ROOT:
   ```powershell
   node yt-watch\yt-watchd.mjs
   ```

2. **No new token needed.** The daemon reuses your existing Godot relay token
   (`GODOT_MCP_RELAY_TOKEN`). If you prefer a separate one, set `YT_WATCH_TOKEN` instead —
   same recipe (fine-grained PAT, Contents RW, godot-mcp repo only). **Never paste tokens in chat.**

3. **Run it** (PowerShell, repo root):
   ```powershell
   $env:GODOT_MCP_RELAY_TOKEN = "github_pat_your_existing_relay_token"
   node yt-watch\yt-watchd.mjs
   ```
   You can run it alongside bridge.mjs — different jobs, same repo, no conflict.
   You should see: `[yt-watch] daemon up ... Waiting for jobs...`

4. **Node version note:** if you see the WebSocket error, your Node is older than 22.
   Fix: `npm i ws` in the folder, or update Node. Either works.

## How a watch actually goes
1. Vibe commits a job file to `yt-watch/relay-yt/queue/pending/` and tells you in chat.
2. The daemon picks it up within ~5s and **closes/relaunches Chrome with your real profile**
   (close your other Chrome windows first — Chrome only allows remote-debugging on a fresh start,
   and this is also what makes it "your" browser session, not an automation one).
3. Console shows live progress: `[14:32:05] watching "Neural Networks" frame 12/40 @ 04:35`
4. Frames, transcript, and status land in `yt-watch/relay-yt/results/<job-id>/` in batches.
5. Vibe downloads frames as they arrive, actually looks at them, and posts what it's learning.
6. When `status.json` says `"phase": "done"`, the watch is complete.

## Everyday use
- Keep a PowerShell window open with the daemon running.
- Just tell Vibe: "watch this: <URL>". That's it.

## Troubleshooting
| Symptom | Fix |
|---|---|
| `set YT_WATCH_TOKEN` error at start | You skipped step 2/3 — set the env var first. |
| Chrome opens but nothing happens | Chrome was already running. Close ALL Chrome windows, retry the job (ask Vibe to resend). |
| `ECONNREFUSED 127.0.0.1:9222` | Chrome didn't start with debugging. Close Chrome fully (check system tray), retry. |
| Pull/push errors | Token expired or wrong repo scope. Regenerate per step 2. |
| Video won't seek | Age-restricted/members-only content — watch those manually or logged-in (Chrome uses your profile, so being logged in to YouTube helps). |
| "transcript unavailable" | Video has no captions. Frames still work. |
