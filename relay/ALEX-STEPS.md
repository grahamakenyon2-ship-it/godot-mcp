# Alex's Setup Steps — godot-mcp GitHub Relay Bridge (beginner edition)

Every step, click by click. If you get stuck on any line, screenshot the error
and send it — do not improvise.

## Overview (what you're building)
Your Godot editor and Vibe (me) will talk through GitHub:
- I drop request files in the fork's `relay/queue/pending/` folder.
- A small program on your PC (`bridge.mjs`) picks them up, hands them to
  your open Godot editor over a localhost-only connection, and uploads the
  answer (and screenshots) back to the repo.
- Nothing on your PC is reachable from the internet. The connection only
  works between Godot and the bridge ON YOUR OWN MACHINE.

## STEP 1 — Check you have Node (5 min)
1. Press the Windows key, type `powershell`, press Enter.
2. Type: `node -v` and press Enter.
3. If you see something like `v22.x.x` — done, go to Step 2.
4. If you see an error (not recognized): open https://nodejs.org in your
   browser, click the big green "LTS" download button, run the installer
   (just click Next through every screen), then CLOSE PowerShell and open a
   NEW one and try `node -v` again.

## STEP 2 — Create your GitHub token (5 min)
This is a password that ONLY works on the godot-mcp repo, ONLY to read/write
files. Even if it leaked, it can do nothing else.
1. Go to https://github.com/settings/personal-access-tokens (logged in as
   grahamakenyon2-ship-it). If that 404s: click your avatar (top right) →
   Settings → Developer settings (bottom of left menu) → Personal access
   tokens → Fine-grained tokens.
2. Click "Generate new token".
3. Token name: `godot-relay`. Expiration: pick 90 days.
4. Resource owner: must say `grahamakenyon2-ship-it`.
5. Repository access: click "Only select repositories" → in the dropdown
   click `grahamakenyon2-ship-it/godot-mcp` (NOT any other repo).
6. Click "Permissions" tab (or expand Permissions) → under "Repository
   permissions" find **Contents** → change it to "Read and write".
   Leave EVERYTHING ELSE as "No access". Do not touch user/organization perms.
7. Click "Generate token" at the bottom.
8. You'll see the token ONCE (starts with `github_pat_`).
   Click the copy icon and paste it into Notepad temporarily.
   NEVER paste it into chat, email, or anywhere else.

## STEP 3 — Get the bridge code onto your PC (2 min)
1. Go to https://github.com/grahamakenyon2-ship-it/godot-mcp
   (make sure you're on the fork, not mkdevkit's original).
2. Click the green **< > Code** button → **Download ZIP**.
3. Right-click the downloaded file → "Extract All..." → extract it to
   somewhere simple like `C:\Users\<you>\godot-mcp`.
   You should now have a folder `godot-mcp-main` with a `relay` folder inside.

## STEP 4 — Install the one dependency (2 min)
1. Open the `godot-mcp-main` folder, then the `relay` folder inside it.
2. Click the folder's address bar (top of the window), type `powershell`,
   press Enter. A blue terminal opens already pointed at this folder.
3. Type: `npm install` and press Enter. Wait for it to finish
   (about 30 seconds; it makes a `node_modules` folder — that's normal).

## STEP 5 — Get the Godot editor plugin into your project (5 min)
You need: Godot 4.x (you already have it from godot-3d-lab) and the
ghost-company project on your PC.
1. If you don't have ghost-company locally yet: go to
   https://github.com/grahamakenyon2-ship-it/ghost-company → green
   Code button → Download ZIP → extract it (e.g. next to your other projects).
2. Open Godot. Click "Import" → navigate into the extracted
   `ghost-company` folder → select `project.godot` → Open.
   The project appears in your Godot project list.
3. Open the `godot-mcp-main` folder → open its `addons` folder →
   you'll see a folder called `godot_mcp`. Copy it.
4. In Windows Explorer, go into your ghost-company project folder
   (where project.godot is). If there's no `addons` folder, right-click →
   New → Folder → name it exactly `addons` (lowercase).
   Open `addons` and paste `godot_mcp` inside.
5. Back in Godot: open the ghost-company project (double-click it).
   Ignore any "files changed on disk" scan.
6. Top menu: Project → Project Settings → click the "Plugins" tab (top right
   of that window). You should see "Godot MCP" listed.
   Tick its "Enable" checkbox. If Godot asks to reload/restart the editor,
   say yes and reopen the project.

## STEP 6 — Start the bridge (2 min)
Keep Godot OPEN with ghost-company loaded. Then:
1. Go back to the PowerShell window from Step 4 (still in the relay folder).
   If you closed it: reopen it the same way (address bar → type powershell).
2. Paste these two lines one at a time (replace the fake token with your
   real one from Notepad):
```powershell
$env:GODOT_MCP_RELAY_TOKEN = "github_pat_PASTE_YOUR_TOKEN_HERE"
npm start
```
3. You should see these two lines:
```
[relay] repo=grahamakenyon2-ship-it/godot-mcp branch=main port=6505 (loopback only)
[relay] Godot editor connected on ws://127.0.0.1:6505
```
The second line is the important one — it means Godot and the bridge are
talking. Leave this window OPEN (minimized is fine). If you close it, the
bridge stops.

## STEP 7 — Tell Vibe
Just say "bridge is up" in the chat. I'll immediately send a test call
(`get_project_info` + `get_editor_screenshot`) and confirm I can see your
editor. If it fails, I'll tell you exactly which step to redo.

## Next time you want to use it (after the first setup)
1. Open ghost-company in Godot.
2. Open PowerShell in the relay folder, run the two lines from Step 6.
3. Say "bridge is up".

## Troubleshooting
- `npm : term not recognized` → Step 1 failed; reinstall Node, open a NEW PowerShell.
- **403 from GitHub** → token repo scope or Contents RW missing; redo Step 2.
- **EADDRINUSE 6505** → the old upstream server is running somewhere; close it.
- Bridge says `Godot editor connected` but I say requests sit unanswered →
  the plugin got disabled in Project Settings; re-check Step 5.6.
- Bridge says nothing after `npm start` except the first line →
  plugin isn't running or Godot is closed → re-check Step 5.6, keep editor open.
- Requests sit in `relay/queue/pending/` forever → check
  `relay/status.json` in the repo on github.com (click the file, the JSON
  shows connected true/false) and the bridge's own PowerShell output.
