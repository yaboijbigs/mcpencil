# Demo script — target 2:40

**Status: future required deliverable. No demo video has been recorded or published yet.** The final challenge entry needs a public YouTube video with audible English narration (or equivalent English audio), under three minutes. This file is only the recording plan.

The video should be one continuous argument: WebMCP turns a website into a place where people bring their own agents as real participants. Record at 1440p or 1080p with a large cursor, 125% browser zoom if needed, and no private notifications. Keep the live app URL visible early and the public repository URL visible at the end.

## Pre-recording setup

- Deploy the exact tagged release to `https://mcpencil.com`.
- Use a seeded Practice Pair whose prompts have been rehearsed but are not named in narration.
- Open the app in ChatGPT's in-app browser with GPT-5.6 Sol or Terra.
- Pre-size the WebMCP Lens so tool names and results are readable at video resolution.
- Open a second human browser only if the practiced flow needs it; hide unrelated tabs.
- Clear rooms, stale credentials, console errors, notifications, autofill, and personal account details.
- Record clean original/programmatic game sound on one audio track and narration on another when possible. Use no unlicensed music, sound effect, artwork, logo, or third-party game footage.
- Have one uninterrupted backup take before experimenting with faster edits.

## Shot-by-shot script

### 0:00–0:10 — correction and reveal

**Picture:** Cold open on the original note or camera clip containing “agentic charades,” quick pencil-scratch transition into the MCPencil landing page and logo.

**Narration:** “On day one I pitched agentic charades—then realized I was describing a drawing game. So we fixed the name and taught agents to play it.”

**On-screen text:** `MCPencil — Bring your own agent to game night.`

### 0:10–0:25 — the thesis

**Picture:** Landing page. Cursor highlights Practice Pair, mixed human/agent seats, and the WebMCP-ready indicator.

**Narration:** “Most AI games bring their bot to you. MCPencil lets people bring the browser agent they already use. Humans and agents join the same realtime room, take the same roles, and use one authoritative game engine.”

### 0:25–0:40 — agent joins and artist actions unlock

**Picture:** The human clicks **Practice Pair**, chooses **Invite an AI player**, and pastes the generated invitation into a fresh no-context agent chat. The agent uses its WebMCP-capable browser surface to navigate, the dedicated handoff page appears, and it calls the page-exposed `play_mcpencil({})` tool. The waiting lobby starts only after the agent connects; expand the Lens as artist actions become available.

**Narration:** “The agent joins through WebMCP. One stable tool registry lasts for the page, while role and phase atomically control which actions are legal now—so long matches stay compatible without weakening authorization.”

**Lens close-up:** `get_match_state`, `draw_stroke`, `undo_last_stroke`; prompt event visibly reads `MASKED`.

### 0:40–1:05 — agent draws, human guesses

**Picture:** Agent reads its role-safe state, then immediately calls `draw_stroke` several times. Keep the Lens and canvas together so every call, returned canvas version, and separately rendered stroke can be followed. Enter the correct human guess before time expires; show points.

**Narration:** “The secret answer goes only to the active artist. The agent cannot ask to ‘draw it.’ It must compose bounded lines, shapes, and polygons on a normalized canvas. The server checks role, time, version, rate, and idempotency before committing and broadcasting every stroke.”

**Lens close-up:** Accepted result with `batchId`, `canvasVersion`, and `remainingMs`; input summary says one primitive.

### 1:05–1:20 — reverse roles

**Picture:** Round transition remains readable for its minimum display time. The private human card appears while the Lens does not list `submit_guesses` as actionable. Hide the card and place the opening stroke; the configured round clock begins and the Lens adds `submit_guesses` to the actionable set.

**Narration:** “Now the exact same room reverses direction. Artist actions are revoked, guessing unlocks, and the agent never receives the answer.”

### 1:20–1:45 — human draws, agent interprets the canvas

**Picture:** Human uses pen plus one shape control. Keep the rendered canvas visible in the visiting agent's browser context. Show `get_match_state` transparently returning the bounded canonical geometry (and no prompt), then show the agent call `submit_guesses` and land the answer. Keep its full visible guess trail on screen, then show the same transcript in the final replay. Do not edit around the geometry field or imply this is a pixel-only evaluation.

**Narration:** “I draw with pointer controls. The agent follows the rendered picture and a bounded summary of its canonical geometry, then submits a normal, rate-limited guess through WebMCP. The prompt and its aliases never enter guesser state. There is no hosted model, API key, bot OAuth, or DOM automation inside MCPencil.”

### 1:45–2:03 — mixed-team arena and Lens

**Picture:** Fast cut to a prepared Team Arena lobby and active mixed teams. Show controller icons plus non-color team patterns, artist rotation, and a live spectator view. Pan the Lens across declared human and WebMCP origin entries.

**Narration:** “Practice proves the loop; Team Arena scales it to mixed teams, humans versus agents, or even agent versus agent. The Lens makes invisible integration quality judgeable without exposing model reasoning.”

### 2:03–2:17 — replay and analytics

**Picture:** Open replay; scrub the vector timeline. Then show time-to-guess, stroke count, tool calls, and origin comparison.

**Narration:** “A canonical vector event log powers reconnects, deterministic replay, and analytics comparing how humans and agents communicate visually.”

### 2:17–2:32 — architecture and why WebMCP

**Picture:** Clean animated architecture diagram: browser controllers → typed command bus → Worker → per-room Durable Object → SQLite, WebSockets, alarm.

**Narration:** “Each room is one SQLite-backed Durable Object with hibernatable WebSockets and a server alarm. WebMCP is not decoration here—it is the protocol that makes a visiting agent a safe, first-class player.”

### 2:32–2:40 — close

**Picture:** Hero logo, live URL, GitHub URL, four seats around the paper canvas. Pencil cursor draws an underline.

**Narration:** “MCPencil. Bring your own agent to game night. Play it now at mcpencil.com.”

**On-screen text:** `mcpencil.com` · `github.com/yaboijbigs/mcpencil`

## Edit priorities

1. Preserve actual tool calls, actual latency, and actual accepted results; never substitute a mock call overlay.
2. Keep at least one role-driven actionable-set transition readable in the Lens.
3. Show the private prompt only when the agent/human artist is authorized; never reveal the answer early to a guesser.
4. Put subtitles on every narration line and verify spelling of WebMCP, Durable Objects, and MCPencil.
5. Keep third-party product UI brief and functional. The project UI, behavior, and evidence should dominate the frame.
6. Be explicit that guesser state includes bounded canonical geometry; demonstrate the visible browser canvas, but do not call the current release a pixel-only vision benchmark.
7. Use only original/programmatic audio or properly licensed material with recorded attribution; silence is preferable to unlicensed music.
8. Export to 2:35–2:45, confirm the uploaded YouTube duration is below 3:00, and watch the public upload once at normal speed with audio enabled.

## Pickup list

- Clean MCPencil logo reveal with pencil sound.
- Lens close-up showing the actionable set change while the descriptor registry stays stable.
- Accepted singular `draw_stroke` result with no private prompt in the event stream.
- Human pointer stroke synced in a second browser.
- Replay scrub and analytics close-up.
- Architecture graphic.
- Final `mcpencil.com` and repository end card.

## Final truth check

Every claim in narration must be demonstrable in the tagged public release. If a fallback or planned feature is not functioning on recording day, remove that claim instead of simulating it. Before submission, verify the public video is under three minutes, has audible English narration, shows the real bidirectional WebMCP flow, and corresponds to the exact deployed/tagged release.
