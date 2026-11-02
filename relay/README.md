# godot-mcp Relay Bridge (loopback-only)

Lets a cloud agent (Vibe) drive the Godot editor on Alex's PC without any
inbound network exposure.

## How it works
- The agent commits JSON-RPC request files to `relay/queue/pending/` in this repo.
- `bridge.mjs` on Alex's PC polls (3s), relays each call over a loopback
  WebSocket (127.0.0.1:6505) to the Godot MCP editor plugin, and commits the
  result to `relay/results/`.
- Screenshots arrive as decoded `.png` files; `relay/status.json` shows
  live connection state.
- Protocol is identical to upstream `server/src/godot-bridge.ts`
  (verified against mkdevkit commit 328e15f: JSON-RPC 2.0, ping/pong
  heartbeat, id-matched responses). Do NOT run the upstream stdio server at
  the same time — both use port 6505.

## Security
- WS server binds **127.0.0.1 only**. No LAN, no tunnels, nothing public.
- GitHub access uses a fine-grained PAT scoped to this single repo
  (Contents: Read and write). No other permissions.

## Run
See `ALEX-STEPS.md` for full setup. Short version:
```bash
cd relay
npm install
GODOT_MCP_RELAY_TOKEN=github_pat_xxx npm start
```

## Queue protocol
- `relay/queue/pending/<id>.json` — `{ "id", "method", "params" }` (agent-written)
- `relay/results/<id>.json` — `{ "id", "ok", "result" | "error", "png" }` (bridge-written)
- `relay/results/<id>.png` — decoded screenshot, when the result carried base64 PNG
- Pending files are deleted once a result is committed.
- `status.json` updates on editor connect/disconnect and every ~60s.

## Tool methods
Any method from upstream `server/src/tool-manifest.ts` (173 tools):
get_project_info, get_editor_screenshot, get_editor_errors, execute_editor_script,
scene/node/script editing, input simulation, runtime inspection, etc.
