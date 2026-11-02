#!/usr/bin/env node
/**
 * godot-mcp GitHub Relay Bridge (loopback-only)
 *
 * A plain-Node WebSocket server that speaks the SAME JSON-RPC protocol as
 * upstream server/src/godot-bridge.ts (verified against mkdevkit/godot-mcp
 * commit 328e15f), but pulls requests from and pushes results to a GitHub
 * repo instead of stdio, so a cloud agent can drive the Godot editor on
 * your machine without any inbound network exposure.
 *
 * SECURITY (non-negotiable):
 *   - WS server binds 127.0.0.1 ONLY. No LAN, no tunnels. If you ever change
 *     the bind host, delete this file first.
 *   - GitHub access uses a fine-grained PAT scoped to ONE repo
 *     (GODOT_MCP_RELAY_REPO, default: your godot-mcp fork), Contents RW.
 *
 * Env vars:
 *   GODOT_MCP_RELAY_TOKEN  (required) fine-grained PAT, Contents: RW on the fork
 *   GODOT_MCP_RELAY_REPO   default "grahamakenyon2-ship-it/godot-mcp"
 *   GODOT_MCP_RELAY_BRANCH default "main"
 *   GODOT_MCP_PORT         default 6505 (do NOT run upstream stdio server at
 *                          the same time - port conflict)
 *
 * Queue protocol (in the fork repo):
 *   relay/queue/pending/<id>.json  ->  { "id": "...", "method": "...", "params": {...} }
 *   relay/results/<id>.json        ->  { "id": "...", "ok": true/false, "result": ...,
 *                                        "error": ...?, "png": "path if screenshot" }
 *   relay/results/<id>.png         ->  decoded screenshot (base64 stripped from json)
 *   relay/status.json              ->  { "connected": bool, "updated": iso, "pid": n }
 *   Pending files are DELETED once a result is committed.
 *
 * Run:  GODOT_MCP_RELAY_TOKEN=github_pat_xxx node relay/bridge.mjs
 */

import WebSocket from "ws";

const TOKEN = process.env.GODOT_MCP_RELAY_TOKEN;
if (!TOKEN) {
  console.error("[relay] FATAL: GODOT_MCP_RELAY_TOKEN not set.");
  process.exit(1);
}
const REPO = process.env.GODOT_MCP_RELAY_REPO || "grahamakenyon2-ship-it/godot-mcp";
const BRANCH = process.env.GODOT_MCP_RELAY_BRANCH || "main";
const PORT = Number(process.env.GODOT_MCP_PORT || 6505);
const HOST = "127.0.0.1"; // ONLY. Never change.
const POLL_MS = 3000;
const HEARTBEAT_MS = 10000;
const REQUEST_TIMEOUT_MS = 60000; // screenshots can be chunky
const API = "https://api.github.com/repos/" + REPO;
const GH = {
  "Authorization": "Bearer " + TOKEN,
  "Accept": "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "godot-mcp-relay-bridge",
};

// ---------------------------------------------------------------------------
// Minimal GitHub contents-API helpers (base64 in/out)
// ---------------------------------------------------------------------------
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s) => Buffer.from(s, "base64").toString("utf8");

async function ghGet(path) {
  const res = await fetch(API + "/" + path + "?ref=" + encodeURIComponent(BRANCH), { headers: GH });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("GET " + path + ": " + res.status + " " + (await res.text()));
  return res.json();
}

async function ghPut(path, content, message) {
  const existing = await ghGet("contents/" + path);
  const body = { message: message, content: b64(content), branch: BRANCH };
  if (existing && existing.sha) body.sha = existing.sha;
  const res = await fetch(API + "/contents/" + path, {
    method: "PUT",
    headers: Object.assign({}, GH, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 200 && res.status !== 201) {
    throw new Error("PUT " + path + ": " + res.status + " " + (await res.text()));
  }
  return res.json();
}

async function ghDelete(path, message) {
  const f = await ghGet("contents/" + path);
  if (!f) return;
  const res = await fetch(API + "/contents/" + path, {
    method: "DELETE",
    headers: Object.assign({}, GH, { "Content-Type": "application/json" }),
    body: JSON.stringify({ message: message, sha: f.sha, branch: BRANCH }),
  });
  if (!res.ok && res.status !== 200) {
    throw new Error("DELETE " + path + ": " + res.status + " " + (await res.text()));
  }
}

// ---------------------------------------------------------------------------
// Godot editor connection (loopback WS, JSON-RPC identical to upstream)
// ---------------------------------------------------------------------------
let client = null;
const pending = new Map(); // id -> {resolve, reject, timer}
let nextId = 1;

const wss = new WebSocket.Server({ port: PORT, host: HOST });
wss.on("connection", (ws) => {
  client = ws;
  console.error("[relay] Godot editor connected on ws://" + HOST + ":" + PORT);
  writeStatus(true);

  ws.on("message", (data) => onMessage(data.toString()));
  ws.on("close", () => {
    if (client === ws) {
      client = null;
      console.error("[relay] Godot editor disconnected");
      writeStatus(false);
    }
    rejectAll(new Error("Godot editor disconnected"));
  });
  ws.on("error", () => ws.close());
});

const heartbeat = setInterval(() => {
  if (client && client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify({ jsonrpc: "2.0", method: "ping", params: {} }));
  }
}, HEARTBEAT_MS);

function connected() {
  return !!(client && client.readyState === WebSocket.OPEN);
}

function call(method, params) {
  return new Promise((resolve, reject) => {
    if (!connected()) {
      return reject(new Error("Godot editor not connected"));
    }
    const id = nextId++;
    client.send(JSON.stringify({ jsonrpc: "2.0", id: id, method: method, params: params || {} }));
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Request timeout: " + method));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve: resolve, reject: reject, timer: timer });
  });
}

function onMessage(text) {
  let msg;
  try { msg = JSON.parse(text); } catch (e) { return; }
  if (msg.method === "pong") return;
  if (msg.id !== undefined && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) {
      p.reject(new Error((msg.error && msg.error.message) || "Unknown Godot error"));
    } else {
      p.resolve(msg.result === undefined ? {} : msg.result);
    }
  }
}

function rejectAll(err) {
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.reject(err);
    pending.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Screenshot decoding: find base64 PNG payloads anywhere in the result and
// write them out as .png files, replacing the field with the file path.
// ---------------------------------------------------------------------------
function extractPngs(result, id) {
  const pngs = [];
  function walk(obj) {
    if (obj === null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(walk);
    const out = {};
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (typeof v === "string" && v.length > 100 &&
          (v.indexOf("iVBOR") === 0 || v.indexOf("data:image/png;base64,") === 0)) {
        const raw = v.indexOf("data:") === 0 ? v.split(",")[1] : v;
        const pngPath = "relay/results/" + id + ".png";
        pngs.push({ ghPath: pngPath, raw: raw });
        out[key] = pngPath;
      } else {
        out[key] = walk(v);
      }
    }
    return out;
  }
  return { cleaned: walk(result), pngs: pngs };
}

// ---------------------------------------------------------------------------
// Status + poll loop
// ---------------------------------------------------------------------------
let lastStatus = null;
async function writeStatus(isConnected) {
  try {
    if (lastStatus === isConnected) {
      // only touch status.json on state CHANGE, but refresh timestamp occasionally
      const cur = await ghGet("contents/relay/status.json");
      if (cur) {
        const j = JSON.parse(unb64(cur.content));
        if (j.connected === isConnected &&
            Date.now() - Date.parse(j.updated) < 60000) return;
      }
    }
    lastStatus = isConnected;
    const status = { connected: isConnected, updated: new Date().toISOString(), pid: process.pid };
    await ghPut("relay/status.json", JSON.stringify(status, null, 2) + "\n",
      "relay: editor " + (isConnected ? "connected" : "disconnected") + " [bridge]");
  } catch (e) {
    console.error("[relay] status write failed: " + e.message);
  }
}

async function processPending() {
  if (!connected()) return;
  let listing;
  try {
    listing = await ghGet("contents/relay/queue/pending");
  } catch (e) {
    console.error("[relay] queue listing failed: " + e.message);
    return;
  }
  if (!Array.isArray(listing)) return; // empty dir -> 404 -> null

  for (const f of listing) {
    if (!f.name.endsWith(".json")) continue;
    let req;
    try {
      const blob = await ghGet("contents/" + f.path);
      req = JSON.parse(unb64(blob.content));
    } catch (e) {
      console.error("[relay] could not read " + f.path + ": " + e.message);
      continue;
    }
    const id = req.id || f.name.replace(/\.json$/, "");
    console.error("[relay] -> " + req.method + " (" + id + ")");
    try {
      let result = await call(req.method, req.params);
      let pngNote = null;
      const extracted = extractPngs(result, id);
      result = extracted.cleaned;
      for (const p of extracted.pngs) {
        await ghPut(p.ghPath, p.raw, "relay: screenshot for " + id + " [bridge]");
        if (!pngNote) pngNote = p.ghPath;
      }
      await ghPut("relay/results/" + id + ".json",
        JSON.stringify({ id: id, ok: true, result: result, png: pngNote }, null, 2) + "\n",
        "relay: result " + id + " [bridge]");
    } catch (e) {
      await ghPut("relay/results/" + id + ".json",
        JSON.stringify({ id: id, ok: false, error: e.message }, null, 2) + "\n",
        "relay: result " + id + " (error) [bridge]");
    }
    // remove from pending
    try {
      await ghDelete(f.path, "relay: consumed " + f.name + " [bridge]");
    } catch (e) {
      console.error("[relay] WARN could not delete " + f.path + ": " + e.message);
    }
  }
}

// ---------------------------------------------------------------------------
async function main() {
  console.error("[relay] repo=" + REPO + " branch=" + BRANCH + " port=" + PORT + " (loopback only)");
  await writeStatus(false);
  const loop = setInterval(async () => {
    if (loop.busy) return; // serialize polls
    loop.busy = true;
    try { await processPending(); }
    catch (e) { console.error("[relay] poll error: " + e.message); }
    finally { loop.busy = false; }
  }, POLL_MS);

  const shutdown = async () => {
    console.error("[relay] shutting down");
    clearInterval(loop);
    clearInterval(heartbeat);
    rejectAll(new Error("Server shutting down"));
    if (client) client.close();
    wss.close();
    await writeStatus(false);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("[relay] fatal: " + e.message);
  process.exit(1);
});
