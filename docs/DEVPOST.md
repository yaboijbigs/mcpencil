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

MCPencil is a realtime draw-and-guess party game in which human and agent seats share one game engine.

In the hero **Sketch Duet** flow, exactly one human and one browser agent cooperate across alternating drawing and guessing turns. A human-created room waits for its agent to join through an isolated `agent.mcpencil.com` document and starts automatically only after both sockets connect. The agent receives an artist-only private prompt and draws with singular low-level `draw_stroke` calls; every accepted mark is persisted and broadcast before acknowledgement, then animates as clients receive it. When the roles reverse, the human memorizes and hides a private card and draws with pointer or touch controls. The opening stroke starts the host-configured clock and gives the agent `submit_guesses`, which records and displays every candidate it submits through WebMCP. The guesser visually inspects the rendered canvas; a compact canvas-only text raster and bounded geometry provide portable fallbacks, never the prompt, aliases, category, or a semantic label. MCPencil does not claim this is a pixel-only vision benchmark.

**Team Match** puts 4–8 human or agent players into two teams of 2–4. It runs a host-configured 4, 6, or 8 rounds, alternates team turns, rotates artists, and lets only teammates guess. **Free-for-All** freezes a 3–8-player roster and shuffled artist order at start. Every player draws exactly once while every other player guesses simultaneously; the first correct guess ends the round, and both that solver and the artist independently earn `100 + remaining whole seconds`. Individual standings determine the winner and preserve ties. Sketch Duet supports 2, 4, or 6 rounds, Free-for-All derives its round count from the starting roster, and every mode supports 45, 60, or 90 seconds per round. Scoring, artist order, realtime synchronization, reconnects, replay, and post-match analytics are server-authoritative.

A judge-facing **WebMCP Lens** shows the exact tools actionable for the current role and phase, safe call summaries, results, timing, canvas versions, and each seat's declared human-UI or WebMCP origin. This origin is useful provenance, not cryptographic model attestation. Private prompts remain masked.

## How we built it

The client is a React and TypeScript single-page app with a normalized `1000 × 700` SVG canvas. Human controls and WebMCP handlers produce the same Zod-validated commands. The complete semantic WebMCP descriptor registry is attached once through `document.modelContext.registerTool` for the document lifetime. An atomic client action gate derives the exact legal tools from the latest authenticated role and phase, while the room authority repeats every permission check before mutation. This avoids spending a finite tool-configuration-change budget during long matches without treating discoverability as authorization.

A Cloudflare Worker serves the app and routes each room code deterministically to one SQLite-backed `GameRoom` Durable Object. That object is the realtime authority for seats, rounds, versions, scores, guesses, vector operations, and idempotency keys. It persists a mutation before broadcasting it over hibernatable WebSockets. A Durable Object alarm ends the current round even when every player disconnects.

We do not call an LLM API and do not ship a built-in bot. The intelligence belongs to the visiting browser agent. The site supplies a safe game protocol.

## How MCPencil uses WebMCP

WebMCP is the player-control layer, not a convenience feature.

- `start_practice` and the zero-context `play_mcpencil` room-invite tool let agents become authenticated game participants without an MCPencil-specific skill or prior conversation.
- Agent seats ready automatically on join. Sketch Duet starts when both required sockets connect; only the host can start an eligible Team Match or Free-for-All and configure the settings that mode permits.
- `draw_stroke` and `undo_last_stroke` become actionable only for the current agent artist and become non-actionable when the role rotates. Its private prompt is included only in its role-safe `get_match_state` result.
- A guesser receives `submit_guesses`, browser-visible canvas, a `32 × 22` canvas-only text raster, bounded canonical geometry, and recent guesses, but never the private prompt; up to three ordered candidates become distinct visible room guesses.
- Round-end tools reveal the result and coordinate the next round.
- `get_match_state` is always available but always role-safe.

`draw_stroke` accepts exactly one line, polyline, ellipse, rectangle, arc, or polygon. The server rejects multi-primitive agent calls, text, URLs, uploads, arbitrary SVG paths, out-of-bounds geometry, stale versions, duplicate side effects, expired rounds, and unauthorized callers before writing. This both forces visual communication and makes the picture form in realtime instead of arriving as a delayed bundle.

## Challenges we ran into

The most interesting challenge was prompt secrecy in a collaborative browser. Tool visibility is not an authorization boundary, so the answer had to be excluded by construction from every shared snapshot, broadcast, replay record, activity entry, error, and log. Only a separately authorized artist request can access it during the round.

Realtime tools introduced a second challenge: a successful tool result should mean more than “the request was sent.” MCPencil acknowledges a draw only after the authoritative mutation is persisted and its versioned update is broadcast, returning the accepted canvas version. Receiving browsers paint asynchronously, so the result does not claim every client has rendered it already. Invocation cancellation, the current client action gate, and server authorization protect the role-transition boundary.

Long matches exposed a less obvious constraint: some browser-agent surfaces have a finite budget for tool-configuration changes. Replacing descriptors every round could exhaust it even though only a few actions were visible at once. MCPencil now keeps one stable semantic registry for the page and changes only its atomically enforced actionable set, so six- and eight-round matches remain available without weakening permissions.

Finally, agent drawings can feel like a database update instead of a performance. We kept the server event log canonical but animate accepted primitives stroke-by-stroke for spectators, preserving correctness and delight at the same time.

## Accomplishments we are proud of

- One symmetric engine supports cooperative duets, mixed teams, and individual human-agent competition without an app-owned bot.
- WebMCP role authorization changes are observable and easy to judge through the Lens.
- Low-level vector constraints make agent strategy visible while keeping rendering deterministic, safe, replayable, and responsive.
- Durable room state survives reconnects and object eviction; alarms enforce real deadlines without client traffic.
- Analytics compare visual communication across human and agent roles without recording hidden model reasoning.

## What we learned

The strongest WebMCP tools are not remote-control wrappers around existing buttons. They expose the website's domain model with precise permissions, compact state, and predictable outcomes. We also learned that making invisible agent infrastructure visible—the Lens, provenance labels, version acknowledgements, and role transitions—dramatically improves both trust and storytelling.

## What's next

MCPencil can grow into a public human-agent visual communication benchmark: seeded prompt packs, model-versus-model Free-for-All tournaments, replay-based evaluation, accessibility-oriented drawing controls, classroom rooms, and community leagues. The core pattern—people bringing their own agent into social software—extends far beyond games.

## Judging criteria evidence

| Criterion | Evidence in the build and video |
|---|---|
| WebMCP Leverage | Agent joins from an isolated browser document, receives private role-safe state, draws constrained geometry, loses artist actionability on rotation, visually interprets the rendered canvas with disclosed nonsemantic fallbacks, and guesses through WebMCP without a model API or DOM automation. Lens makes authorization and annotations visible. |
| Execution | Responsive SVG controls, authoritative multiplayer rooms, hibernatable realtime sync, alarms, reconnects, team and individual scoring, Sketch Duet, replay, analytics, tests, and a focused judge path. |
| Potential Impact | A legible example of bring-your-own-agent social software and a reusable visual communication evaluation surface. |
| Creativity & Ambition | Agents communicate through low-level geometry, reverse roles to interpret human marks, form mixed teams, and compete in an all-player individual race. |

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
