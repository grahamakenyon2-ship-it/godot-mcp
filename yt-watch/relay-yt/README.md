# yt-watch/relay-yt/README.md — yt-watch queue protocol (for Vibe)

Same relay pattern as the godot-mcp bridge; separate namespace, same repo. Branch: **master** (the relay gotcha).

## Send a job
Commit `yt-watch/relay-yt/queue/pending/<id>.json`:
```json
{
  "id": "vid-20261116-<slug>",
  "url": "https://www.youtube.com/watch?v=XXXXXXXXXXX",
  "mode": "both",          // "hd" (full-res sampled frames) | "storyboard" (fast whole-video 2s coverage) | "both"
  "interval": 15           // seconds between HD samples (hd/both modes)
}
```

## Read results (poll while the job runs — frames stream in batches)
- `yt-watch/relay-yt/results/<id>/status.json` — `{phase: starting|watching|done|error, frames_captured, frames_total, current_time_sec, note}`
- `yt-watch/relay-yt/results/<id>/meta.json` — title, channel, duration
- `yt-watch/relay-yt/results/<id>/transcript.txt` — timestamped captions
- `yt-watch/relay-yt/results/<id>/frames/sb_XXX.jpg` — storyboard sprites (3x3 grids of 2s-apart frames, 320x180 each)
- `yt-watch/relay-yt/results/<id>/frames/hd_XXXXXs.jpg` — full-res player screenshots at `<interval>`s marks
- `yt-watch/relay-yt/status.json` — daemon heartbeat (`connected: true`, ~60s)
- `yt-watch/relay-yt/results/<id>/analysis.md` — Vibe writes live findings here as frames are analyzed

## Vibe-side analysis loop (real-time learning)
1. Poll `status.json` every ~30s while phase != done.
2. Download new frames (raw.githubusercontent or `git pull`), analyze each with vision
   (uploads.analyze_image works on any local path).
3. Append findings to `analysis.md` with timestamps, commit, and report highlights in chat.
4. Storyboard sprites: describe the 3x3 grid per image (9 frames each, 2s apart).
   HD frames: describe the single moment (filename = timestamp in seconds).

## Hygiene
- Delete result folders for old jobs once findings are preserved in Knowledge.
- Never put tokens in this repo. The daemon reads YT_WATCH_TOKEN from its environment.
