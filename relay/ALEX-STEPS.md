# godot-mcp Relay Bridge — Setup Guide

## The everyday flow (what you do every time — nothing)
1. Open ghost-company in Godot.
2. That's it. The plugin auto-starts the bridge in the background, the bridge
   reads your token from a local file, and Vibe can see your editor.
3. (Optional) Vibe can confirm by checking `relay/status.json` in the repo.

If you ever need to run it manually (debugging): open PowerShell in the
relay folder → `node bridge.mjs` → read `bridge.log` next to it.

## ONE-TIME SETUP (do this once, ~10 min)

### STEP 1 — Rotate your token (if the current one was ever pasted anywhere)
1. https://github.com/settings/personal-access-tokens
2. Delete the old `godot-relay` token if it was ever exposed in chat/screenshots.
3. Generate new token: name `godot-relay`, 90 days, resource owner
   `grahamakenyon2-ship-it`, **Only select repositories** →
   `grahamakenyon2-ship-it/godot-mcp`, Permissions → **Contents: Read and write**,
   everything else No access.
4. Copy it (starts with `github_pat_`). It goes ONLY in the file you create in
   Step 4 or Notepad — never in chat, email, commit messages.

### STEP 2 — Get the latest code
1. Delete your old `E:\godot-mcp-master` folder.
2. https://github.com/grahamakenyon2-ship-it/godot-mcp → green Code → Download ZIP.
3. Extract to `E:\` (same as before).

### STEP 3 — Install the one dependency
1. Open the extracted folder → `relay` folder.
2. Click the address bar, type `powershell`, press Enter.
3. `npm install` → wait ~30 seconds.

### STEP 4 — Save your token to the file the bridge reads
Still in that PowerShell window (the prompt should say `...\relay>`):
```powershell
"github_pat_PASTE_YOUR_TOKEN_HERE" | Out-File -Encoding ascii .elay-token.txt
```
(Quotes around the token, then close the file. This file is gitignored —
it can never be committed to the repo.)

### STEP 5 — Tell the plugin where the bridge lives (one config file)
Same PowerShell window:
```powershell
New-Item -ItemType Directory -Force $env:APPDATA\godot-relay | Out-Null
'{"bridge_dir": "E:/godot-mcp-master/relay"}' | Out-File -Encoding ascii $env:APPDATA\godot-relay\config.json
```
(If your extracted folder is named differently, adjust the path — use forward
slashes as shown.)

### STEP 6 — Update the plugin inside ghost-company (overwrite the old one)
1. Open the extracted folder → `addons` → copy the `godot_mcp` folder.
2. Paste it into `E:\ghost-company-main\addons\` → when Windows asks about
   replacing files, choose **Replace the files in the destination**.
3. (If Godot was open, close and reopen it after this.)

### STEP 7 — Test it
1. Open ghost-company in Godot.
2. In Godot's bottom Output panel you should see a line like:
   `[Godot MCP] relay bridge launched in background (pid 1234)`
   followed by `[Godot MCP] Connected to MCP server (ws://127.0.0.1:6505)`
3. Double-check on GitHub: open `relay/status.json` in the repo — it should
   say `"connected": true` within a minute or so.
4. Tell Vibe you've upgraded — it will verify with a live screenshot.

## How the automation works
- When Godot loads the project, the plugin checks: is something already
  listening on port 6505? If yes → nothing to do. If no → it quietly runs
  `node bridge.mjs` in the background (no window).
- The bridge reads your token from `relay-token.txt` next to itself.
- If you run the bridge manually in PowerShell AND open Godot, the plugin
  notices the port is busy and skips launching a second one.
- The background bridge keeps running after you close Godot (harmless —
  it just idles; the next Godot start reuses it).

## Troubleshooting
- **No "relay bridge launched" line in Godot's Output** → check
  `%APPDATA%\godot-relay\config.json` exists and has the right bridge_dir;
  check node is on PATH (`node -v` in a new PowerShell).
- **Bridge launched but not connected** → read `E:\godot-mcp-master\relay\bridge.log`.
- **403 from GitHub** → token file wrong or token expired; redo Steps 1+4.
- **EADDRINUSE 6505** → a bridge is already running; that's fine, not an error.
- **Requests sit in `relay/queue/pending/`** → check `relay/status.json` +
  `bridge.log`.

## Security recap
- WS server binds 127.0.0.1 only. Nothing is reachable from outside your PC.
- Token lives in `relay/relay-token.txt` (gitignored) or the env var.
- Token is scoped to one repo, Contents RW only.
