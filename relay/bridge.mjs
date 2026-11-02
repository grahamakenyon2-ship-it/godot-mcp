#!/usr/bin/env node
/**
 * godot-mcp GitHub relay bridge
 * ---------------------------------------------------------
 * Replaces the stdio MCP server: hosts the same loopback WebSocket
 * server the Godot plugin connects to (127.0.0.1:6505), but takes its
 * commands from a GitHub repo queue and commits results back.
 *
 * Protocol (verified against server/src/godot-bridge.ts @ 328e15f):
 *   -> {"jsonrpc":"2.0","id":N,"method":"<tool>","params":{...}}
 *   <- {"id":N,"result":{...}} | {"id":N,"error":{"message":"..."}}
 *   heartbeat: server -> {"jsonrpc":"2.0","method":"ping"} / plugin -> {"method":"pong"}
 *
 * Queue convention (all paths in this repo):
 *   relay/queue/pending/<job-id>.json   — job = { "id": "...", "commands": [ {method, params}, ... ] }
 *   relay/results/<job-id>.json         — { "id": "...", "results": [ {ok, result|error, ms} ] }
 *   relay/results/<job-id>-shot<N>.png  — any base64 PNG found in results, decoded
 *   relay/status.json                   — { "connected": bool, "since": iso, "last_seen": iso }
 */
import { WebSocketServer } from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cfgPath = path.join(HERE, "relay-config.json");
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch { /* optional */ }

const TOKEN  = process.env.GITHUB_TOKEN || cfg.github_token || "";
const REPO   = cfg.repo   || "grahamakenyon2-ship-it/godot-mcp";
const BRANCH = cfg.branch || "main";
const POLL_MS = cfg.poll_ms || 5000;
const PORT   = cfg.port || 6505;
const CMD_TIMEOUT_MS = cfg.command_timeout_ms || 60000;

if (!TOKEN) {
  console.error("[relay] FATAL: no token. Put github_token in relay-config.json or set GITHUB_TOKEN.");
  process.exit(1);
}

const GH = "https://api.github.com";
const HDRS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "godot-mcp-relay",
};
const log = (...a) => console.log(`[relay ${new Date().toISOString()}]`, ...a);
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

async function gh(p, opts = {}) {
  const r = await fetch(GH + p, { ...opts, headers: { ...HDRS, ...(opts.headers || {}) } });
  const body = await r.text();
  if (!r.ok) throw new Error(`GitHub ${r.status} ${p}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}

// ---------- Godot WebSocket side (mirrors upstream godot-bridge.ts) ----------
let client = null;
const pending = new Map();
let nextId = 1;

const wss = new WebSocketServer({ port: PORT, host: "127.0.0.1" }); // loopback only, never exposed
wss.on("connection", (ws) => {
  client = ws;
  log("Godot editor CONNECTED");
  writeStatus(true);
  ws.on("message", (data) => {
    let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.method === "pong") return;
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(p.timer);
      p.resolve(msg);
    }
  });
  ws.on("close", () => { if (client === ws) { client = null; log("Godot editor DISCONNECTED"); writeStatus(false); } });
  ws.on("error", () => ws.close());
});

setInterval(() => {
  if (client?.readyState === 1) client.send(JSON.stringify({ jsonrpc: "2.0", method: "ping", params: {} }));
}, 10000);

function callGodot(method, params = {}) {
  return new Promise((resolve) => {
    if (!client || client.readyState !== 1) {
      return resolve({ ok: false, error: "Godot editor not connected. Open the project in Godot with the godot_mcp plugin enabled." });
    }
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: `timeout after ${CMD_TIMEOUT_MS}ms: ${method}` });
    }, CMD_TIMEOUT_MS);
    pending.set(id, {
      resolve: (msg) => resolve(msg.error ? { ok: false, error: msg.error.message ?? "unknown Godot error" }
                                          : { ok: true, result: msg.result ?? {} }),
      timer,
    });
    client.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
}

// ---------- GitHub side ----------
async function listPending() {
  try {
    const items = await gh(`/repos/${REPO}/contents/relay/queue/pending?ref=${BRANCH}`);
    return Array.isArray(items) ? items.filter((f) => f.type === "file") : [];
  } catch (e) {
    if (String(e).includes("404")) return []; // no queue yet — fine
    throw e;
  }
}

async function putFile(p, message, content, expectedSha = null) {
  let sha = expectedSha;
  if (sha === null) { // fetch current sha if file exists
    try { sha = (await gh(`/repos/${REPO}/contents/${p}?ref=${BRANCH}`)).sha; } catch (e) { if (!String(e).includes("404")) throw e; }
  }
  return gh(`/repos/${REPO}/contents/${p}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, content, branch: BRANCH, ...(sha ? { sha } : {}) }),
  });
}

async function deleteFile(p, sha, message) {
  return gh(`/repos/${REPO}/contents/${p}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sha, branch: BRANCH }),
  });
}

let statusState = null;
async function writeStatus(connected, force = false) {
  try {
    if (!force && statusState === connected) return;
    statusState = connected;
    await putFile("relay/status.json",
      `relay: editor ${connected ? "connected" : "disconnected"}`,
      b64(JSON.stringify({ connected, since: new Date().toISOString(), repo: REPO, branch: BRANCH }, null, 2)));
    log(`status.json -> connected=${connected}`);
  } catch (e) { log("status update failed:", String(e)); }
}

// keepalive so Vibe can see how fresh the bridge is
setInterval(() => writeStatus(!!(client?.readyState === 1), true), 10 * 60 * 1000);

function extractShots(results, jobId) {
  const files = [];
  let n = 0;
  const json = JSON.stringify(results);
  const re = /iVBORw0KGgo[A-Za-z0-9+/=\n]+/g; // base64 PNG magic
  for (const m of json.matchAll(re)) {
    const data = m[0].replace(/\s/g, "");
    if (data.length < 1000) continue; // too small to be a real image
    files.push({ path: `relay/results/${jobId}-shot${++n}.png`, b64: data });
  }
  return files;
}

async function processQueue() {
  const jobs = await listPending();
  if (!jobs.length) return;
  for (const job of jobs.sort((a, b) => a.name.localeCompare(b.name))) {
    const raw = await gh(`/repos/${REPO}/contents/${job.path}?ref=${BRANCH}`);
    let parsed;
    try { parsed = JSON.parse(Buffer.from(raw.content, "base64").toString("utf8")); }
    catch (e) { log(`job ${job.name} is not valid JSON — deleting`, String(e)); await deleteFile(job.path, raw.sha, "relay: delete malformed job"); continue; }
    const jobId = parsed.id || job.name.replace(/\.json$/, "");
    log(`processing job ${jobId} (${parsed.commands?.length ?? 0} commands)`);
    const results = [];
    for (const cmd of parsed.commands || []) {
      const t0 = Date.now();
      const r = await callGodot(cmd.method, cmd.params ?? {});
      results.push({ method: cmd.method, ...r, ms: Date.now() - t0 });
      log(`  ${cmd.method} -> ${r.ok ? "ok" : "ERROR " + r.error} (${Date.now() - t0}ms)`);
    }
    // truncate gigantic payloads so commits stay sane
    let out = JSON.stringify({ id: jobId, results }, null, 2);
    if (out.length > 900_000) out = JSON.stringify({ id: jobId, results: results.map((r) => ({ ...r, result: r.result ? "[truncated — see screenshot files]" : undefined })), note: "payload truncated" }, null, 2);
    await putFile(`relay/results/${jobId}.json`, `relay: result ${jobId}`, b64(out));
    for (const shot of extractShots(results, jobId)) {
      await putFile(shot.path, `relay: screenshot for ${jobId}`, shot.b64);
    }
    await deleteFile(job.path, raw.sha, `relay: done ${jobId}`);
    log(`job ${jobId} complete`);
  }
}

let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  try { await processQueue(); }
  catch (e) { log("poll error:", String(e)); }
  finally { busy = false; }
}, POLL_MS);

log(`bridge up. repo=${REPO} branch=${BRANCH} poll=${POLL_MS}ms ws=ws://127.0.0.1:${PORT}`);
log("waiting for Godot editor... (open your project with the godot_mcp plugin enabled)");
