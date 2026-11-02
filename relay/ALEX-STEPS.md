# Alex's Setup Steps — godot-mcp GitHub Relay Bridge

One-time setup (~10 min). After this, the bridge runs on your PC and lets
Vibe drive your live Godot editor through the fork's repo — no ports exposed
to the internet, everything stays loopback + GitHub.

## 0. What you need
- Node 18+ (`node -v`)
- The Godot MCP editor plugin (step 3)
- A fine-grained GitHub PAT (step 1)

## 1. Create the PAT
1. GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate.
2. Repository access: **Only select repositories** → `grahamakenyon2-ship-it/godot-mcp`.
3. Permissions → Repository permissions → **Contents: Read and write**. Nothing else.
4. Copy the token (starts with `github_pat_`). Keep it private.

## 2. Clone the fork + install
```bash
git clone https://github.com/grahamakenyon2-ship-it/godot-mcp.git
cd godot-mcp/relay
npm install
```

## 3. Install the editor plugin into your game project
The plugin lives in this fork at `addons/godot_mcp/`.
- Copy `addons/godot_mcp/` into your ghost-company project as `addons/godot_mcp/`.
- In Godot: Project → Project Settings → Plugins → enable **Godot MCP**.
- Keep the editor OPEN with the ghost-company project loaded.

## 4. Start the bridge
```bash
# from the relay/ directory
GODOT_MCP_RELAY_TOKEN=github_pat_xxx npm start
```
You should see:
```
[relay] repo=... branch=main port=6505 (loopback only)
[relay] Godot editor connected on ws://127.0.0.1:6505
```
If you get "editor not connected": the plugin isn't enabled, or Godot isn't
open. IMPORTANT: do NOT run the upstream stdio server at the same time —
both use port 6505.

## 5. Tell Vibe you're up
Just say "bridge is up". Vibe will verify by queueing `get_project_info` +
`get_editor_screenshot` against ghost-company and confirm it can see your
editor.

## How it works (for reference)
- Vibe commits request files to `relay/queue/pending/*.json` in the fork.
- Your bridge polls (every 3s), relays each call over the loopback WebSocket
  to the Godot plugin, and commits the result to `relay/results/`.
- Screenshots come back as decoded `.png` files.
- `relay/status.json` shows live connection state.
- The WS server binds **127.0.0.1 only** — nothing is reachable from outside
  your machine. All GitHub traffic uses your single-repo PAT.

## Troubleshooting
- **403 from GitHub** → token repo scope or Contents RW missing.
- **EADDRINUSE 6505** → upstream stdio server running; kill it.
- **Requests sit in pending/** → check `relay/status.json`: if `connected: false`,
  the editor plugin isn't talking to the bridge (plugin disabled, or Godot closed).
- **No results at all** → bridge terminal will print every error it hits; read it.
