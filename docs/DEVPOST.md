# Devpost submission copy

Use this document as the source of truth when completing the WebMCP Challenge entry. Replace every `TODO_SUBMISSION` value before publishing.

## Project title

MCPencil

## Tagline

Bring your own agent to game night.

## One-sentence pitch

MCPencil is a realtime draw-and-guess party game where humans and browser agents take turns drawing with constrained WebMCP vector tools and interpreting each other's pictures.

## Links

- Live app: [https://mcpencil.com](https://mcpencil.com)
- Source code: [https://github.com/yaboijbigs/mcpencil](https://github.com/yaboijbigs/mcpencil)
- Public YouTube demo (under three minutes): `TODO_SUBMISSION_PUBLIC_YOUTUBE_URL`
- Official rules: [https://webmcp.devpost.com/rules](https://webmcp.devpost.com/rules)

## Inspiration

Most “AI multiplayer” products put an app-owned bot behind an API and ask humans to visit it. WebMCP reverses that relationship: a person can bring the browser agent they already use into a website and let the site expose a purpose-built interaction protocol.

We wanted to make that difference instantly understandable, social, and fun. Drawing is the perfect shared language. It is visual enough that an agent must truly use the page, structured enough to constrain safely, and familiar enough that a judge can understand success in seconds.

The project began with a funny slip—we called the idea “agentic charades” while describing a drawing game. That correction became our opening, and **MCPencil** became the game.

## What it does

MCPencil is a realtime team draw-and-guess game in which human and agent seats share one game engine.

In the hero **Practice Pair** flow, a human creates a room that waits for a browser agent to join. The agent receives an artist-only private prompt and draws with singular low-level `draw_stroke` calls; every accepted mark is persisted, broadcast, and visible before the next call. Then the roles reverse: the human memorizes and hides a private card and draws with pointer or touch controls. The opening stroke starts the host-configured clock and gives the agent `submit_guesses`, which records and displays every candidate it submits through WebMCP.

**Team Arena** runs a host-configured 4, 6, or 8 timed rounds with two mixed teams. **Exhibition** uses the same seats for humans-versus-agents or agent-versus-agent matches. Practice supports 2, 4, or 6 balanced rounds, and every mode supports 45, 60, or 90 seconds per round. Scoring, artist rotation, realtime synchronization, reconnects, replay, and post-match analytics are server-authoritative.

A judge-facing **WebMCP Lens** shows which tools are currently registered, how the set changes with role and phase, safe call summaries, results, timing, canvas versions, and whether each action came from the human UI or WebMCP. Private prompts remain masked.

## How we built it

The client is a React and TypeScript single-page app with a normalized `1000 × 700` SVG canvas. Human controls and WebMCP handlers produce the same Zod-validated commands. WebMCP tools are registered imperatively through `document.modelContext.registerTool`; each role/phase owns an `AbortController`, so obsolete registrations disappear. Execution signals, generation guards, and current server role/phase checks keep invocations that were already in flight from applying stale local results or unauthorized mutations.

A Cloudflare Worker serves the app and routes each room code deterministically to one SQLite-backed `GameRoom` Durable Object. That object is the realtime authority for seats, rounds, versions, scores, guesses, vector operations, and idempotency keys. It persists a mutation before broadcasting it over hibernatable WebSockets. A Durable Object alarm ends the current round even when every player disconnects.

We do not call an LLM API and do not ship a built-in bot. The intelligence belongs to the visiting browser agent. The site supplies a safe game protocol.

## How MCPencil uses WebMCP

WebMCP is the player-control layer, not a convenience feature.

- `start_practice` and the zero-context `play_mcpencil` room-invite tool let agents become authenticated game participants without an MCPencil-specific skill or prior conversation.
- Lobby tools let an agent ready its own seat, configure an agent-hosted match, and let only the host start an eligible match.
- The artist receives `draw_stroke` and `undo_last_stroke`—and loses them immediately when the role rotates. Its private prompt is included only in its role-safe `get_match_state` result.
- A guesser receives `submit_guesses`, but never the private prompt or artist mutations; up to three ordered candidates become distinct visible room guesses.
- Round-end tools reveal the result and coordinate the next round.
- `get_match_state` is always available but always role-safe.

`draw_stroke` accepts exactly one line, polyline, ellipse, rectangle, arc, or polygon. The server rejects multi-primitive agent calls, text, URLs, uploads, arbitrary SVG paths, out-of-bounds geometry, stale versions, duplicate side effects, expired rounds, and unauthorized callers before writing. This both forces visual communication and makes the picture form in realtime instead of arriving as a delayed bundle.

## Challenges we ran into

The most interesting challenge was prompt secrecy in a collaborative browser. Tool visibility is not an authorization boundary, so the answer had to be excluded by construction from every shared snapshot, broadcast, replay record, activity entry, error, and log. Only a separately authorized artist request can access it during the round.

Realtime tools introduced a second challenge: a successful tool result should mean more than “the request was sent.” MCPencil waits for the authoritative canvas version to reach the local UI before acknowledging a draw, while execution signals and generation checks protect the role-transition boundary.

Finally, agent drawings can feel like a database update instead of a performance. We kept the server event log canonical but animate accepted primitives stroke-by-stroke for spectators, preserving correctness and delight at the same time.

## Accomplishments we are proud of

- One symmetric engine supports humans, agents, mixed teams, and agent-versus-agent play without an app-owned bot.
- WebMCP role changes are observable and easy to judge through the Lens.
- Low-level vector constraints make agent strategy visible while keeping rendering deterministic, safe, replayable, and responsive.
- Durable room state survives reconnects and object eviction; alarms enforce real deadlines without client traffic.
- Analytics compare visual communication across human and agent roles without recording hidden model reasoning.

## What we learned

The strongest WebMCP tools are not remote-control wrappers around existing buttons. They expose the website's domain model with precise permissions, compact state, and predictable outcomes. We also learned that making invisible agent infrastructure visible—the Lens, provenance labels, version acknowledgements, and role transitions—dramatically improves both trust and storytelling.

## What's next

MCPencil can grow into a public human-agent visual communication benchmark: seeded prompt packs, model-versus-model exhibitions, replay-based evaluation, accessibility-oriented drawing controls, classroom rooms, and community tournaments. The core pattern—people bringing their own agent into social software—extends far beyond games.

## Judging criteria evidence

| Criterion | Evidence in the build and video |
|---|---|
| WebMCP Leverage | Agent joins, gets a private role tool, draws constrained geometry, loses artist tools, visually guesses a human drawing, and uses no model API or DOM automation. Lens makes lifecycle and annotations visible. |
| Execution | Responsive SVG controls, authoritative multiplayer rooms, hibernatable realtime sync, alarms, reconnects, scoring, Practice Pair, replay, analytics, tests, and a one-minute judge path. |
| Potential Impact | A legible example of bring-your-own-agent social software and a reusable visual communication evaluation surface. |
| Creativity & Ambition | Agents communicate through low-level geometry and reverse roles to interpret human marks inside mixed, competitive realtime teams. |

## Technologies

WebMCP imperative API; React; TypeScript; Vite; Zod; SVG; Cloudflare Workers; SQLite-backed Durable Objects; hibernatable WebSockets; Durable Object alarms; Vitest running in Workerd.

## Submission checklist

- [ ] `https://mcpencil.com` works in an incognito browser and the ChatGPT in-app browser.
- [ ] `www.mcpencil.com` redirects or serves the same release.
- [x] Public GitHub URL is live here and ready for Devpost.
- [ ] Repository is public and visibly contains the MIT license.
- [ ] YouTube URL replaces `TODO_SUBMISSION_PUBLIC_YOUTUBE_URL`; video is public and under 3:00.
- [ ] Devpost description and every material shown are in English.
- [ ] The demo visibly shows actual WebMCP tool use in both directions.
- [ ] All third-party frameworks are attributed; all prompts and visual/audio assets are original or licensed.
- [ ] Final deployed commit is tagged and remains live throughout judging.
- [ ] Every placeholder in the repository is found with `rg TODO_SUBMISSION` and replaced.
