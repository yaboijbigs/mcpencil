# MCPencil

**Bring your own agent to game night.**

MCPencil is a realtime draw-and-guess party game where humans and browser agents are first-class players. An agent can receive a private prompt and draw with constrained vector tools while people guess; then the roles reverse and the agent inspects a human drawing and submits its answer. The same room engine supports human-agent pairs, mixed teams, humans versus agents, and agent-versus-agent exhibitions.

- **Play:** [https://mcpencil.com](https://mcpencil.com)
- **Source:** [github.com/yaboijbigs/mcpencil](https://github.com/yaboijbigs/mcpencil)
- **Workers diagnostic:** [mcpencil.bigbeejack.workers.dev](https://mcpencil.bigbeejack.workers.dev) *(the custom domain above is canonical)*
- **Demo video:** `TODO_SUBMISSION_PUBLIC_YOUTUBE_URL` *(recording scheduled before submission)*
- **License:** [MIT](LICENSE)

> MCPencil is an original human-agent draw-and-guess game. It is not affiliated with any commercial drawing-game brand.

## The 60-second judge path

1. Open [mcpencil.com](https://mcpencil.com) in ChatGPT's in-app browser with **GPT-5.6 Sol or Terra** and choose **Practice Pair**.
2. Click **Invite an AI player** and paste the copied zero-context invitation into a fresh browser-agent conversation.
3. The invitation tells the agent to open the agent-specific room URL and call `play_mcpencil`. That zero-argument tool joins and readies the agent; only then does Practice Pair begin.
4. In round one, watch the WebMCP Lens: the private prompt stays masked and each `draw_stroke` call produces exactly one immediately visible mark. Guess the picture in the game UI.
5. In round two, memorize the private prompt and hide the card. Your first stroke starts the configured round clock and makes `submit_guesses` actionable; draw while the agent visually inspects each canvas update.
6. Open the result and replay panels. Compare every guess, human/WebMCP provenance, time-to-guess, strokes, and tool calls.

The entire path demonstrates both WebMCP directions without an app-owned bot, model API key, bot OAuth flow, or DOM automation.

## Why WebMCP is essential

MCPencil exposes a game protocol, not a pile of clickable UI. A stable page-lifetime registry describes the complete game vocabulary, while the actionable set changes with the authenticated seat, match phase, team, and role. An agent draws through the same typed command bus as a human and can only communicate with bounded low-level geometry—there is no semantic “draw a cat” tool and no image-generation escape hatch. When roles reverse, the canvas remains visual; the agent must understand what the human drew and use the page's guess tool.

Every accepted mutation follows one path:

```text
human UI or WebMCP tool
  → shared Zod schema
  → room/seat authorization
  → SQLite commit in one room Durable Object
  → versioned WebSocket broadcast
  → local render acknowledgement
```

The collapsible **WebMCP Lens** makes this visible to judges: the exact tools actionable for the current role and phase, invocation timing, safe input summaries, compact results, canvas versions, and action provenance. Private prompts are represented only by masked events.

### Zero-context invitations

Every lobby has two deliberately different share actions. **Invite a person** copies the plain room URL. **Invite an AI player** copies a complete interface handoff plus a structurally delimited, self-describing `/webmcp/rooms/{code}?invite=agent#webmcp` link. It tells the agent to navigate with its WebMCP-capable browser surface, then use browser viewing only for the canvas and perform every game action through MCPencil's page-exposed tools. It calls out `play_mcpencil({})`, every returned `nextAction`, and `match-end`; if WebMCP is absent, the agent reports that limitation instead of substituting clicks or DOM automation.

The page does not depend on an MCPencil skill, system prompt, model API, or prior conversation. The agent deep link reinforces the user's intent with a room-specific WebMCP document title, a dedicated no-form handoff page, a visible accessible alert, and a minimal initial actionable set. It also recognizes the legacy `invite=agentOpen` value produced when a chat client glued prose to an undelimited URL. `play_mcpencil` needs no arguments when the URL contains the room code, supplies a default display name, joins as an automatically ready agent seat, and returns the exact next tool and arguments. Every subsequent state repeats `mustContinue` and the match-end completion condition.

## WebMCP tool contract

Tools are registered imperatively with `document.modelContext.registerTool`. The complete semantic descriptor set is registered once for the document lifetime instead of being removed and recreated every round; this stays compatible with browser and agent surfaces that impose a finite tool-configuration-change budget. Separately, the client computes an exact actionable set from the latest authenticated role and phase. Every handler checks that set at invocation time, and the room authority independently repeats all seat, role, phase, time, and version checks before mutation. Invocation execution signals still cancel pending work. Read tools use `readOnlyHint`; results containing player-authored names, guesses, or canvas geometry use `untrustedContentHint`.

| Tool | Actionable when | Mutates | What it does |
|---|---|---:|---|
| `get_match_state` | Always | No | Returns a role-safe summary. An authenticated active agent artist also receives its private prompt so it can draw immediately; an eligible agent guesser receives compact canvas geometry and recent guesses. No other role receives either private prompt or guesser-only geometry. |
| `start_practice` | Landing/practice | Yes | Creates the balanced agent-draws/human-draws judge path and joins the caller. |
| `play_mcpencil` | Room invite/practice | Yes | Zero-context entry point. Joins and readies an agent from the room URL with no required arguments, then returns the exact next action and match-end completion condition. |
| `configure_match` | Lobby, host only | Yes | Sets an allowed round count and round duration before play begins. The authoritative room validates, persists, and broadcasts the change. |
| `start_match` | Lobby, host only | Yes | Starts an eligible match after server-side lobby validation. |
| `draw_stroke` | Prepared/drawing round, active agent artist only | Yes | Commits exactly one validated primitive. The first stroke starts the configured clock; its acknowledgement supplies the next canvas version. |
| `undo_last_stroke` | Prepared/drawing round, active agent artist only | Yes | Removes the caller's latest accepted stroke at the expected canvas version. |
| `submit_guesses` | Drawing, eligible agent guesser | Yes | Submits 1–3 ordered, distinct guesses as real room actions, 350 ms apart, stopping on the first correct answer. Every accepted attempt is broadcast and retained. |
| `get_round_result` | After any completed round | No | Returns the revealed answer, points, elapsed time, stroke count, tool-call count, and complete guess transcript. |
| `ready_next` | Round end | Yes | Marks the caller ready and advances when the room is eligible. |

Between turns, agents can long-poll `get_match_state` with the last `revision` and `waitMs` up to 25 seconds. The call resolves on the next authoritative WebSocket update, so a new artist receives its private prompt immediately instead of noticing the turn on a later polling cycle.

`draw_stroke` accepts exactly one `line`, `polyline`, `ellipse`, `rectangle`, `arc`, or `polygon` primitive on a normalized `1000 × 700` canvas. Coordinates, colors, stroke widths, fills, point counts, payload size, role, phase, version, rate, and idempotency are enforced. Text, URLs, uploads, arbitrary SVG/path strings, out-of-range geometry, and multi-primitive WebMCP mutations are rejected before any write. Each successful call is persisted and broadcast before the tool acknowledges it, so spectators see the picture form stroke by stroke instead of receiving a late burst.

## Game modes

- **Practice Pair:** a noncompetitive proof path—agent draws, then human draws—with 2, 4, or 6 rounds. Creating practice opens a one-seat lobby and does not start a game. `play_mcpencil` creates the agent’s distinct credential, and the first prepared round begins only after both WebSockets connect. The human-artist round remains private and untimed until the human's first stroke; the guess action is not authorized before it lands.
- **Team Arena:** two mixed teams of 2–4 seats play 4, 6, or 8 rounds, alternating teams and rotating artists.
- **Exhibition:** the Team Arena engine with controller labels arranged for humans-versus-agents or agent-versus-agent play.

The host chooses 45, 60, or 90 seconds per round in the waiting room. Defaults remain 2 rounds for Practice Pair, 6 rounds for Team Arena, and 90 seconds per round. Everyone sees the synchronized settings; only the host can change them.

Only the active artist's teammates may guess. A correct answer awards `100 + remaining whole seconds`; wrong guesses do not lose points but are rate-limited. Matching normalizes case, punctuation, spacing, accents, curated aliases, and one-character typos for sufficiently long answers. Prompt cards are dealt without replacement for the entire match.

## Architecture

```mermaid
flowchart LR
    A[Human UI] --> B[Typed command bus]
    M[Browser agent via WebMCP] --> B
    B --> W[Cloudflare Worker router]
    W -->|getByName room code| D[GameRoom Durable Object]
    D --> S[(SQLite room state + event log)]
    D --> T[Durable Object alarm]
    D -->|hibernatable WebSockets| C1[Player browser]
    D -->|versioned broadcasts| C2[Spectator browser]
    C1 --> L[SVG canvas + WebMCP Lens]
    C2 --> L2[SVG canvas + replay]
```

The React/TypeScript single-page app keeps tools attached to one document. One deterministically addressed, SQLite-backed Durable Object owns each room. The room persists state before broadcasting, uses hibernatable WebSockets for realtime updates and reconnect catch-up, and schedules a single alarm to finalize a round even if every client disconnects. See [Architecture](docs/ARCHITECTURE.md) for protocols and invariants.

## Browser and model setup

### Recommended challenge setup

1. Open the latest ChatGPT desktop app.
2. Select **GPT-5.6 Sol** or **GPT-5.6 Terra**. Luna does not expose website tools for this flow.
3. Open [mcpencil.com](https://mcpencil.com) in the in-app browser and allow the page's site tools when prompted.
4. Keep the page visible while the agent draws or guesses so the canvas and Lens can be inspected.

### Chromium development setup

Use **Chrome 149 or newer** with the experimental WebMCP feature enabled, then connect through a compatible browser agent. Without WebMCP, MCPencil still works as a realtime human multiplayer game and shows an unsupported-browser explanation; agent controls remain unavailable.

WebMCP is experimental. Exact browser UI and flag labels may change between prerelease builds, so the ChatGPT desktop path above is the submission's supported judge path.

## Local development

Prerequisites: Node.js 24+, npm, and a Cloudflare account for deployment. No OpenAI API key or hosted model credential is used.

```bash
npm ci
npm run types
npm run dev
```

`npm run dev` starts the Vite UI for frontend work. To exercise Worker routes, Durable Objects, WebSockets, and alarms locally:

```bash
npm run dev:worker
```

Useful checks:

```bash
npm run typecheck
npm test
npm run build
npm run check
```

The test suite uses Cloudflare's `@cloudflare/vitest-plugin` so Worker and Durable Object tests execute in `workerd` with real local bindings. The manual release matrix is in [Playtesting](docs/PLAYTEST.md).

## Deploy to Cloudflare

The checked-in `wrangler.jsonc` defines the static asset binding, `GameRoom` SQLite Durable Object migration, observability, `nodejs_compat`, `mcpencil.com`, and `www.mcpencil.com` custom-domain routes.

```bash
npx wrangler login
npm run check
npm run deploy
```

After deployment, verify DNS/custom-domain activation in the same Cloudflare account, replace the Workers preview placeholder at the top of this README, and run the release checklist in [Playtesting](docs/PLAYTEST.md). No secrets belong in `wrangler.jsonc`; future secrets must use `wrangler secret put`.

## Security and integrity

- A private artist prompt is returned only to the authenticated active artist through its role-safe `get_match_state` result or the private human card. It is excluded from shared snapshots, WebSocket payloads, activity details, replay events, and logs. In Practice round two, `submit_guesses` remains non-actionable until the human hides and unmounts the prompt card and sends the opening stroke.
- Anonymous seat credentials use opaque random tokens; only token hashes are persisted.
- Names and guesses are length-limited data, never HTML or instructions.
- Every mutation is authorized against room phase, seat, role, team, expiry, expected canvas version, and rate limits.
- Duplicate drawing idempotency keys are harmless; expired-round writes and stale versions are rejected.
- Responses set CSP, `Origin-Agent-Cluster: ?1`, and `Permissions-Policy: tools=(self)`; tools are not exposed cross-origin.
- Disconnects do not pause timers. Reconnecting players recover the canonical snapshot and events after their last canvas version.

See the [Threat model](docs/THREAT_MODEL.md) for assets, trust boundaries, abuse cases, and release checks.

## Tests and evaluation

Automated coverage targets:

- strict vector schemas, geometry bounds, payload limits, and rejected unknown fields;
- room isolation, SQLite persistence after eviction, alarm expiry, WebSocket reconnect, and version catch-up;
- lobby constraints, artist rotation, scoring, idempotency, normalization, typo tolerance, and rate limiting;
- proof that private prompts never enter a shared response, event, replay record, or log object;
- parity between human UI and WebMCP commands;
- stable page-lifetime descriptor registration, exact role/controller/gate-driven actionability, in-flight cancellation, and result annotations.

The release evaluation uses 12 original golden cards. The target is at least 8/12 agent drawings guessed by humans, at least 8/12 human drawings guessed by the browser agent, and zero WebMCP tool-contract failures. Record results in [Playtesting](docs/PLAYTEST.md).

## Known limitations

- WebMCP currently requires a compatible experimental browser/agent environment; ordinary browsers cannot occupy an agent seat.
- MCPencil deliberately has no built-in LLM fallback. The participating browser agent supplies the intelligence.
- Anonymous room identity is device-local; clearing site storage loses the reconnect token.
- Rooms are designed for small party sessions (up to eight active seats), not massive spectator broadcasts.

## Challenge-period provenance

This repository was created from an empty directory on **August 25, 2026**, after the WebMCP Challenge began. All implementation, original prompts, artwork, audio, documentation, and commit history are being produced during the challenge period. The project will remain publicly accessible throughout judging.

## Attribution

MCPencil's product design, prompt deck, icons, vector art, and programmatic sound effects are original. It is built with [React](https://react.dev/), [Vite](https://vite.dev/), [Zod](https://zod.dev/), [Cloudflare Workers and Durable Objects](https://developers.cloudflare.com/durable-objects/), and the experimental [WebMCP imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api). No uploaded art, proprietary game content, or generated answer images are included.

Released under the [MIT License](LICENSE).
