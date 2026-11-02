# godot-mcp relay — how Vibe uses it

The bridge (bridge.mjs) runs on Alex's PC. It:
1. Hosts the loopback WebSocket server (ws://127.0.0.1:6505) the godot_mcp plugin connects to — identical protocol to upstream `server/src/godot-bridge.ts` (JSON-RPC 2.0, ping/pong every 10s). It REPLACES the stdio MCP server; do not run both (port conflict).
2. Polls `relay/queue/pending/` in this repo every 5s.
3. Executes each job's commands sequentially against the live editor, commits results + decoded screenshots, deletes the job.

## Vibe's side of the contract
- Queue a job: commit `relay/queue/pending/<id>.json`:
  ```json
  { "id": "job-001", "commands": [
      { "method": "get_project_info", "params": {} },
      { "method": "get_editor_screenshot", "params": {} }
  ] }
  ```
- Read `relay/status.json` first to confirm `connected: true` (and check `since` for freshness).
- Results appear in `relay/results/<id>.json` (with per-command `ok`, `result`, `error`, `ms`) and any base64 PNGs decoded to `<id>-shot<N>.png`.
- Job ids: use `YYYYMMDD-HHMMSS-seq` so ordering is lexical.
- Methods = the 173 tool names from the upstream manifest (get_editor_screenshot, add_node, play_scene, simulate_key, get_editor_errors, etc.). Params per upstream tool-manifest.ts.
- Commands run in order; one bad command doesn't stop the rest (each gets its own ok/error).
- Timeouts: 60s per command; editor-disconnected jobs come back with an explicit error — surface that to Alex, don't retry silently.

## Safety
- WebSocket binds 127.0.0.1 only. Never add a tunnel/ngrok/public bind to this — it's a full editor-control surface.
- Token: fine-grained PAT scoped to THIS repo, Contents read/write only.
