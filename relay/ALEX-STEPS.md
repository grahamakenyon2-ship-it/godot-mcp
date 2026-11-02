# ALEX'S STEPS — follow in order, ~10 minutes total

You need each of these ONCE. After that, "working on Godot with me" = keep the Godot editor open and the bridge running (one double-click / one terminal command).

---

## STEP 0 — What you need already installed
- **Godot 4.4 or newer** (you have this)
- **Git** (you have this)
- **Node.js** — *only if you don't have it:*
  1. Go to https://nodejs.org
  2. Click the big green button that says **"LTS"** (the left one, with the big version number)
  3. Run the installer. Click **Next** on every screen. **Finish.**
  4. Check it worked: open a **Command Prompt** (press Windows key, type `cmd`, Enter) and type:
     ```
     node --version
     ```
     Press Enter. You should see something like `v22.x.x`. If you do, Node is installed.

---

## STEP 1 — Create your GitHub token (the bridge's permission slip)
1. Go to: https://github.com/settings/personal-access-tokens/new
   (That's: GitHub → click your face top-right → **Settings** → scroll down left sidebar → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**)
2. **Token name:** type `godot relay`
3. **Expiration:** pick `Custom` → a year from now
4. **Repository access:** click **"Only select repositories"** → in the dropdown, pick **`grahamakenyon2-ship-it/godot-mcp`**
5. Under **Permissions → Repository permissions**, find **Contents** and set it to **Read and write**
   (everything else stays "No access" — that's correct and safest)
6. Click **Generate token** (green button, bottom)
7. **RIGHT NOW**: copy the token it shows you (clicks the copy icon). It looks like `github_pat_长长的...`.
   ⚠️ You will never see it again after leaving that page. Paste it somewhere safe temporarily (Notepad is fine).

---

## STEP 2 — Get the repo onto your PC
1. Open a **Command Prompt**
2. Type these lines, pressing Enter after each:
   ```
   cd %USERPROFILE%
   git clone https://github.com/grahamakenyon2-ship-it/godot-mcp.git
   cd godot-mcp\relay
   ```

---

## STEP 3 — Give the bridge your token
1. Still in that same Command Prompt, in the `relay` folder, type:
   ```
   copy relay-config.example.json relay-config.json
   ```
2. Open the file in Notepad:
   ```
   notepad relay-config.json
   ```
3. Replace `PASTE_YOUR_TOKEN_HERE` with the token from Step 1 (between the quotes). Save and close (Ctrl+S, Alt+F4).

---

## STEP 4 — Install the bridge's one dependency (once)
```
npm install
```
Wait ~10 seconds until it stops printing things. Errors in *yellow* are fine; errors in *red* mean call me.

---

## STEP 5 — Start the bridge
```
node bridge.mjs
```
**Keep this window open.** You want to see:
```
[relay ...] bridge up. repo=grahamakenyon2-ship-it/godot-mcp ...
[relay ...] waiting for Godot editor...
```

---

## STEP 6 — Plug the addon into your Godot project (once per project, e.g. ghost-company)
1. In File Explorer, open the cloned `godot-mcp` folder, then the `addons` folder inside it.
2. **Copy** the `godot_mcp` folder.
3. Go to your game project folder (e.g. where you cloned `ghost-company`), open its `addons` folder (make one if there isn't), and **paste** it there.
4. Open the project in Godot.
5. Top menu: **Project → Project Settings → Plugins** tab.
6. Find **"Godot MCP"** in the list → turn the checkbox **ON**.
7. Look at Godot's **Output** panel (bottom). You want to see:
   ```
   [Godot MCP] Plugin started
   ```
8. Check your Command Prompt (Step 5 window). You want to see:
   ```
   [relay ...] Godot editor CONNECTED
   ```
9. **Final proof it works:** refresh this page: https://github.com/grahamakenyon2-ship-it/godot-mcp/blob/main/relay/status.json
   — it should say `"connected": true`.

That's it. From then on: **editor open + bridge running = I can see and drive your editor.** I'll tell you when I've sent a command so you can leave the window alone.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `node` is not recognized | Step 0 failed — reinstall Node LTS, then close and reopen the Command Prompt |
| `npm install` prints red errors | Your internet or GitHub token — paste me the error text |
| Bridge says `waiting for Godot editor...` forever | Godot isn't open, or the plugin toggle (Step 6.6) is off, or you have the OLD Node server running from before — close anything else that might use port 6505 |
| `Godot editor DISCONNECTED` right after connecting | You closed Godot or the project — just reopen it |
| status.json says `connected: false` but Godot is open | The Godot Output panel probably shows an error — screenshot it for me |
| Nothing in `relay/results/` after I say I sent a command | Bridge window may show `poll error: ... GitHub 401` → your token expired or wasn't pasted right (Step 3) |

## Every-day use (later sessions)
1. Open Godot with the game project.
2. Command Prompt: `cd %USERPROFILE%\godot-mcp\relay` then `node bridge.mjs`
3. Tell me "editor's up" — that's your whole day's job.
