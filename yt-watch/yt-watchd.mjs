#!/usr/bin/env node
/**
 * yt-watchd.mjs — YouTube Watcher daemon for Alex's PC (the "eyes" side of the Vibe relay).
 *
 * What it does:
 *   1. Polls the GitHub queue (relay/queue/pending/*.json) in this repo.
 *   2. For each job: launches YOUR real Chrome (your IP, your profile) with the video URL.
 *   3. Watches the video like a human would, capturing frames:
 *        - mode "hd": seeks through the video, full-resolution player screenshots.
 *        - mode "storyboard": grabs YouTube's own storyboard sprites (fast whole-video coverage).
 *        - mode "both" (default): storyboard for coverage + hd samples for detail.
 *   4. Saves the transcript (captions), video metadata, and progress status.
 *   5. Pushes everything to relay/results/<id>/ in batches, so Vibe can analyze
 *      frames WHILE the watch is still in progress (real-time learning).
 *
 * Anti-detection: there is nothing to detect. This is your real browser, real IP,
 * real profile, navigating and playing a public video at human pace. No automation
 * signatures beyond local CDP on 127.0.0.1, which the page cannot see.
 *
 * Requirements: Node.js (>= 22 preferred for built-in WebSocket; else `npm i ws`),
 * Git, Chrome. Token via env var YT_WATCH_TOKEN (never stored, never pasted in chat).
 *
 * Run:   set YT_WATCH_TOKEN=github_pat_xxx   &&   node yt-watchd.mjs
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import os from "node:os";

const REPO = process.env.YT_WATCH_REPO || "grahamakenyon2-ship-it/godot-mcp"; // lives inside the godot-mcp relay repo; reuses its token
const BRANCH = process.env.YT_WATCH_BRANCH || "master"; // BRANCH GOTCHA: the relay lives on master
const TOKEN = process.env.YT_WATCH_TOKEN || process.env.GODOT_MCP_RELAY_TOKEN; // reuse the existing relay PAT
const POLL_SEC = Number(process.env.YT_WATCH_POLL || 5);
const CDP_PORT = 9222;

if (!TOKEN) {
  console.error("[yt-watch] ERROR: set YT_WATCH_TOKEN (or GODOT_MCP_RELAY_TOKEN) — fine-grained PAT, Contents RW on godot-mcp only.");
  process.exit(1);
}
if (typeof WebSocket === "undefined") {
  console.error("[yt-watch] ERROR: this Node build has no built-in WebSocket. Run:  npm i ws");
  process.exit(1);
}

const git = (cmd) => execSync(`git ${cmd}`, { cwd: process.cwd(), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
const remoteUrl = () => `https://x-access-token:${TOKEN}@github.com/${REPO}.git`;

const chromePath = () => {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  throw new Error("chrome.exe not found — set YT_WATCH_CHROME to its full path");
};

const httpGet = (url) =>
  new Promise((res, rej) => {
    http.get(url, { headers: { Host: "localhost" } }, (r) => {
      let b = ""; r.on("data", (d) => (b += d)); r.on("end", () => res(b));
    }).on("error", rej);
  });

let cdpSeq = 0;
const cdpPending = new Map();
let cdpWs = null;

function cdpSend(method, params = {}, sessionId) {
  const id = ++cdpSeq;
  return new Promise((resolve, reject) => {
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    cdpPending.set(id, { resolve, reject });
    cdpWs.send(JSON.stringify(msg));
  });
}

async function cdpConnect() {
  const ver = JSON.parse(await httpGet(`http://127.0.0.1:${CDP_PORT}/json/version`));
  // find or create the youtube tab
  let targets = JSON.parse(await httpGet(`http://127.0.0.1:${CDP_PORT}/json/list`));
  let page = targets.find((t) => t.type === "page" && /youtube\.com\/watch/.test(t.url));
  if (!page) page = targets.find((t) => t.type === "page" && /youtube\.com/.test(t.url));
  if (!page) throw new Error("No Chrome tab found for YouTube");
  cdpWs = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { cdpWs.on("open", res); cdpWs.on("error", rej); });
  cdpWs.on("message", (data) => {
    const m = JSON.parse(data.toString());
    if (m.id && cdpPending.has(m.id)) {
      const p = cdpPending.get(m.id); cdpPending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  });
  await cdpSend("Page.enable").catch(() => {});
  await cdpSend("Runtime.enable").catch(() => {});
  return ver.Browser;
}

/** Evaluate an expression inside the page. Returns {result} value. */
async function pageEval(expr, awaitPromise = true) {
  const r = await cdpSend("Runtime.evaluate", {
    expression: expr, awaitPromise, returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error("page eval failed: " + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function gitPull() { try { git(`pull --rebase -q ${remoteUrl()} ${BRANCH}`); return true; } catch (e) { console.error("[yt-watch] pull failed:", e.message?.split("\n")[0]); return false; } }
function gitPush() { git(`add -A .`); try { git(`commit -q -m "yt-watch update" --allow-empty`); } catch {} git(`push -q ${remoteUrl()} HEAD:${BRANCH}`); }

function updateStatus(dir, s) {
  const f = path.join(dir, "status.json");
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, "utf8") || "{}"), ...s, last_update: new Date().toISOString() }, null, 2));
  const line = `[${new Date().toLocaleTimeString()}] ${s.phase || ""} ${s.note || ""} frame ${s.frames_captured ?? "?"}/${s.frames_total ?? "?"} @ ${Math.floor((s.current_time_sec || 0) / 60)}:${String(Math.floor((s.current_time_sec || 0) % 60)).padStart(2, "0")}`;
  console.log(line);
}

// ---------------------------------------------------------------- watch job

async function watchJob(job, resultsDir) {
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.mkdirSync(path.join(resultsDir, "frames"), { recursive: true });
  fs.writeFileSync(path.join(resultsDir, "status.json"), JSON.stringify({ id: job.id, phase: "starting" }, null, 2));
  updateStatus(resultsDir, { phase: "starting", note: "launching Chrome" });
  gitPush();

  // 1. Launch Chrome with the real profile (must be closed first).
  let targets;
  try { targets = JSON.parse(await httpGet(`http://127.0.0.1:${CDP_PORT}/json/list`)); } catch { targets = null; }
  if (!targets) {
    const profile = path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "User Data");
    console.log("[yt-watch] launching Chrome with your real profile. Close other Chrome windows first.");
    const { spawn } = await import("node:child_process");
    spawn(chromePath(), [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,   // explicit dir = CDP allowed (Chrome 136+) AND it's your real profile
      "--no-first-run", "--no-default-browser-check",
      job.url,
    ], { detached: true, stdio: "ignore" }).unref();
    for (let i = 0; i < 30; i++) { await sleep(1000); try { await httpGet(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch {} }
  } else {
    // Chrome already has CDP: navigate an existing youtube tab to the URL
    const page = targets.find((t) => t.type === "page" && /youtube\.com/.test(t.url)) || targets.find((t) => t.type === "page");
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/navigate?${page.id}`); // noop, real nav below
  }

  await cdpConnect();

  // navigate to the job URL if not already there
  const cur = await pageEval("location.href");
  if (!cur.includes(job.url.replace("https://www.", "").replace("https://", ""))) {
    await cdpSend("Page.navigate", { url: job.url });
    await sleep(6000);
  }
  // wait for player
  for (let i = 0; i < 20; i++) {
    if (await pageEval("!!document.querySelector('video')", false)) break;
    await sleep(1000);
  }
  await sleep(4000); // let ads/autoplay settle like a human

  // 2. Metadata + transcript + storyboard spec from the page's own player response
  const meta = await pageEval(`(() => {
    const pr = window.ytInitialPlayerResponse || {};
    const vd = pr.videoDetails || {};
    return JSON.stringify({
      title: vd.title, author: vd.author, lengthSeconds: Number(vd.lengthSeconds || 0),
      storyboardSpec: pr.storyboards?.playerStoryboardSpecRenderer?.spec || null,
      captions: (pr.captions?.playerCaptionsTracklistRenderer?.captionTracks || []).map(t => ({lang: t.languageCode, kind: t.kind || '', url: t.baseUrl})),
    });
  })`, false).then(JSON.parse);

  fs.writeFileSync(path.join(resultsDir, "meta.json"), JSON.stringify(meta, null, 2));
  updateStatus(resultsDir, { phase: "watching", note: `loaded "${meta.title}" (${Math.round(meta.lengthSeconds / 60)} min)` });
  gitPush();

  // transcript via the page's own session (works where raw fetches get throttled)
  try {
    const en = meta.captions.find((c) => c.lang.startsWith("en")) || meta.captions[0];
    if (en) {
      const text = await pageEval(`fetch("${en.url}&fmt=json3").then(r => r.text())`);
      const data = JSON.parse(text);
      const lines = (data.events || []).filter(e => e.segs).map(e => {
        const t = Math.floor((e.tStartMs || 0) / 1000);
        return `[${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}] ` + e.segs.map(s => s.utf8).join("");
      }).join("\n");
      fs.writeFileSync(path.join(resultsDir, "transcript.txt"), lines);
    }
  } catch (e) { console.log("[yt-watch] transcript unavailable:", e.message); }

  const mode = job.mode || "both";
  let captured = 0;
  const framesDir = path.join(resultsDir, "frames");

  // 3a. Storyboard mode: whole-video coverage, fast.
  if ((mode === "storyboard" || mode === "both") && meta.storyboardSpec) {
    updateStatus(resultsDir, { phase: "watching", note: "fetching storyboards (whole-video coverage)" });
    const parts = meta.storyboardSpec.split("|");
    const base = parts[0], tmpl = parts[parts.length - 1];
    const f = tmpl.split("#");
    const sigh = f[f.length - 1];
    const level = parts.length - 2;
    const frameW = Number(f[0]) / Number(f[3]); // sprite width / cols
    const totalFrames = Math.ceil(meta.lengthSeconds / 2); // ~2s per storyboard frame
    updateStatus(resultsDir, { phase: "watching", frames_total: totalFrames, note: "storyboards" });
    let i = 0;
    while (true) {
      const b64 = await pageEval(`fetch("${base.replace("$L", level).replace("$N", "M" + i)}&sigh=${sigh}").then(r => r.arrayBuffer()).then(b => { let s=''; const u=new Uint8Array(b); for(let j=0;j<u.length;j++) s+=String.fromCharCode(u[j]); return btoa(s); })`).catch(() => null);
      if (!b64) break;
      fs.writeFileSync(path.join(framesDir, `sb_${String(i).padStart(3, "0")}.jpg`), Buffer.from(b64, "base64"));
      captured += 9; i++;
      updateStatus(resultsDir, { frames_captured: Math.min(captured, totalFrames), current_time_sec: i * 18, note: "storyboards" });
      if (i % 4 === 0) gitPush();
      await sleep(300);
    }
    fs.writeFileSync(path.join(resultsDir, "storyboard_info.txt"), `level=${level} frame=${frameW.toFixed(0)}w grid 3x3, ~2s per sub-frame`);
  }

  // 3b. HD mode: full-res player screenshots at intervals (the real "watch").
  if (mode === "hd" || mode === "both") {
    const interval = job.interval || 15; // seconds between sampled moments
    const duration = meta.lengthSeconds;
    const times = [];
    for (let t = 5; t < duration - 2; t += interval) times.push(t);
    updateStatus(resultsDir, { frames_total: times.length, note: `HD pass: ${times.length} full-res frames @ ${interval}s` });
    gitPush();

    // try to start playback like a human (click the big play button area), then pause
    await pageEval(`(()=>{const b=document.querySelector('.ytp-large-play-button')||document.querySelector('button.ytp-play-button'); if(b) b.click();})()`, false).catch(() => {});
    await sleep(1500);
    await pageEval(`document.querySelector('video').pause()`, false).catch(() => {});

    for (let n = 0; n < times.length; n++) {
      const t = times[n];
      const ok = await pageEval(`new Promise(res => {
        const v = document.querySelector('video');
        if (!v) return res(false);
        v.muted = false;
        v.currentTime = ${t};
        v.onseeked = () => res(true);
        setTimeout(() => res(false), 8000);
      })`);
      if (!ok) { updateStatus(resultsDir, { note: "seek failed — skipping" }); continue; }
      await sleep(700); // frame settles
      const rect = await pageEval(`(()=>{const r=document.querySelector('.html5-video-player')?.getBoundingClientRect(); if(!r) return null; window.scrollTo(0,0); const r2=document.querySelector('.html5-video-player').getBoundingClientRect(); return JSON.stringify({x:r2.x,y:r2.y,w:r2.width,h:r2.height});})()`, false).then(JSON.parse).catch(() => null);
      const shot = await cdpSend("Page.captureScreenshot", {
        format: "jpeg", quality: 72,
        clip: rect ? { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: rect.w, height: rect.h, scale: 1 } : undefined,
        captureBeyondViewport: true,
      });
      fs.writeFileSync(path.join(framesDir, `hd_${String(t).padStart(5, "0")}s.jpg`), Buffer.from(shot.data, "base64"));
      captured++;
      updateStatus(resultsDir, { frames_captured: captured, current_time_sec: t, note: "HD frames" });
      if (n % 5 === 4) gitPush(); // stream batches so Vibe can analyze mid-watch
      await sleep(1200); // human-ish pacing
    }
  }

  updateStatus(resultsDir, { phase: "done", note: `complete: ${captured} frames + transcript` });
  gitPush();
}

// ---------------------------------------------------------------- queue loop

function pollQueue() {
  const q = path.join("yt-watch", "relay-yt", "queue", "pending");
  if (!fs.existsSync(q)) return null;
  const files = fs.readdirSync(q).filter((f) => f.endsWith(".json"));
  if (!files.length) return null;
  const f = files.sort()[0];
  const job = JSON.parse(fs.readFileSync(path.join(q, f), "utf8"));
  return { job, file: f };
}

async function main() {
  console.log(`[yt-watch] daemon up. repo=${REPO} branch=${BRANCH} poll=${POLL_SEC}s. Waiting for jobs...`);
  // keep-alive heartbeat
  setInterval(() => {
    try {
      fs.writeFileSync("yt-watch/relay-yt/status.json", JSON.stringify({ connected: true, heartbeat: new Date().toISOString(), cwd: process.cwd() }, null, 2));
      gitPush();
    } catch (e) { /* offline: retry next tick */ }
  }, 60000);

  while (true) {
    try {
      gitPull();
      const item = pollQueue();
      if (item) {
        console.log(`[yt-watch] JOB ${item.job.id}: ${item.job.url}`);
        fs.rmSync(path.join("yt-watch", "relay-yt", "queue", "pending", item.file));
        gitPush();
        const resultsDir = path.join("yt-watch", "relay-yt", "results", item.job.id);
        try {
          await watchJob(item.job, resultsDir);
        } catch (e) {
          console.error(`[yt-watch] job ${item.job.id} FAILED:`, e.message);
          updateStatus(resultsDir, { phase: "error", note: e.message });
          gitPush();
        }
      }
    } catch (e) { console.error("[yt-watch] loop error:", e.message); }
    await sleep(POLL_SEC * 1000);
  }
}

main().catch((e) => { console.error("[yt-watch] fatal:", e); process.exit(1); });
