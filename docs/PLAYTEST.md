# Playtest and release verification

This is the evidence checklist for the deployed challenge build. Automated success is necessary but not sufficient: realtime synchronization, browser-agent behavior, prompt secrecy, responsive drawing, and the two-minute judge path require observed play.

## Automated gate

Run from a clean checkout of the release candidate:

```bash
npm ci
npm run check
```

The gate must cover:

- shared schemas and rejected geometry/payloads;
- normalization, aliases, typo tolerance, and false-positive boundaries;
- room isolation and token authorization;
- SQLite state recovery after Durable Object eviction;
- round alarms and post-expiry mutation rejection;
- idempotent drawing batches and stale canvas versions;
- lobby eligibility, team alternation, artist rotation, scoring, and match completion;
- private prompt absence from every shared pre-reveal payload;
- human UI/WebMCP command parity;
- WebSocket disconnect, reconnect, and version catch-up;
- the exact dynamic WebMCP tool set by role and phase.

Record the release commit and result:

| Field | Result |
|---|---|
| Commit SHA | `22286702b30c05d4b56692ff882a747aa2a107a4` |
| UTC timestamp | `2026-08-26T01:11:45Z` |
| Node/npm | `v24.15.0` / `11.12.1` |
| Tests | 35/35 passed across 4 Cloudflare Vitest files |
| Typecheck | Passed (`tsc -b`) |
| Production build | Passed — JS 320.37 kB / 95.55 kB gzip; CSS 41.32 kB / 9.57 kB gzip |

## 60-second judge-path rehearsal

Use a clean browser profile and the production domain.

- [x] `https://mcpencil.com` loads over TLS with the expected CSP, WebMCP Permissions Policy, and no mixed content.
- [ ] WebMCP support is detected and the user sees a ready state.
- [ ] Agent calls `start_practice` and receives a separate opaque companion seat, not the human's identity.
- [ ] Round one assigns the companion agent as artist and the human as guesser.
- [ ] Only agent-artist tools are registered; the prompt event is masked in the Lens.
- [ ] Two or more `draw_batch` calls animate and acknowledge the applied canvas version.
- [ ] Human correct guess ends the round and reveals the answer once.
- [ ] Round two assigns the human as artist and companion agent as guesser.
- [ ] Old artist tools disappear; `submit_guess` appears for the agent seat.
- [ ] Human prompt is private and is removed on round end.
- [ ] Agent inspects the visible canvas and correctly calls `submit_guess`.
- [ ] Results, replay, origins, time, stroke count, and tool-call count are coherent.
- [ ] Whole flow completes in 60–90 seconds without manual recovery.

Run at least five rehearsals. Target four clean first-attempt completions; the final three runs before recording must be clean.

## Multiplayer matrix

| Scenario | Clients | Expected result | Pass |
|---|---:|---|---|
| Two humans, same team | 2 | Artist stroke appears remotely; teammate can guess; nonartist cannot draw | [ ] |
| Mixed 2v2 Arena | 4 | Six rounds alternate teams and rotate artists; scores persist | [ ] |
| Human vs agent Exhibition | 2+ | Controller labels change presentation, not authority rules | [ ] |
| Agent vs agent Exhibition | 2+ agents | One agent draws while only eligible teammate agent guesses | [ ] |
| Late spectator | 1 late join | Canonical canvas/state loads without replaying private prompt | [ ] |
| Artist disconnect | 2+ | Timer continues; reconnect restores seat and canvas | [ ] |
| Guesser disconnect | 2+ | Other clients continue; reconnect gets missed version(s) | [ ] |
| Durable Object eviction | test helper | Reconstructed object preserves state and scheduled round semantics | [ ] |
| Simultaneous guesses | 2 guessers | One correct transition/score; later mutation receives round-ended result | [ ] |
| Duplicate batch | 1 artist | Same idempotency key returns duplicate acknowledgement, no extra strokes | [ ] |
| Stale batch | 2 artist sessions | Old expected version is rejected with current version guidance | [ ] |
| Expired batch | 1 artist | Mutation after `endsAt` is rejected and round finalizes once | [ ] |

## Prompt-secrecy audit

Choose a canary prompt unique enough to search recursively, for example `violet telescope parade` (never add it to the real deck). During the drawing phase:

- [ ] Human guesser `/state` response has no canonical prompt, tokens, aliases, category, or canary fragments.
- [ ] Agent guesser `get_match_state` result has no prompt metadata.
- [ ] WebSocket snapshot/presence/error frames contain no prompt or aliases.
- [ ] Canvas, guess, activity, analytics, and replay structures contain no prompt.
- [ ] WebMCP Lens shows `MASKED`, not a summary derived from the answer.
- [ ] Browser DOM outside the authorized artist subtree contains no prompt text.
- [ ] Structured Worker/Durable Object logs contain no prompt or raw request body.
- [ ] Unauthorized and wrong-phase prompt requests use generic errors.
- [ ] Prompt becomes visible to all players exactly once in the round result.

Also inspect the production JavaScript bundle: the production prompt deck should remain server-side and must not be included in client assets.

## Browser, input, and accessibility matrix

| Surface | Checks | Pass |
|---|---|---|
| ChatGPT desktop + GPT-5.6 Sol | Both WebMCP directions; role-transition generation safety; Lens readability | [ ] |
| ChatGPT desktop + GPT-5.6 Terra | Both WebMCP directions; recovery from one stale call | [ ] |
| Chrome 149+ with WebMCP enabled | Registration, annotations, compact tool results | [ ] |
| Chrome without WebMCP | Human game works; clear compatibility message; no crash | [ ] |
| Desktop 1440×900 | No clipped game or Lens; video framing is legible | [ ] |
| Laptop 1280×720 | Core controls and timer remain above fold | [ ] |
| Mobile portrait | Touch drawing, scroll lock on canvas, room/lobby usable | [ ] |
| Mobile landscape | Canvas aspect and controls stay usable | [ ] |
| Keyboard | Lobby, dialogs, guess field, tabs, replay controls reachable | [ ] |
| Screen reader | Named controls, status updates not over-announced, team labels present | [ ] |
| Reduced motion | Stroke/reveal transitions remain understandable without animation | [ ] |
| High contrast/color vision | Team labels and patterns communicate what color alone would | [ ] |

Test pen cancellation when the pointer leaves the canvas, browser zoom at 200%, IME input in the guess field, a long allowed display name, a long rejected guess, and switching browser tabs during a round.

## Golden visual evaluation

Use the frozen set and protocol in [PROMPT_EVAL.md](PROMPT_EVAL.md).

### Agent draws / humans guess

| Card | Correct | Time ms | Batches | Primitives | Tool errors | Failure tag/notes |
|---|---:|---:|---:|---:|---:|---|
| G01 |  |  |  |  |  |  |
| G02 |  |  |  |  |  |  |
| G03 |  |  |  |  |  |  |
| G04 |  |  |  |  |  |  |
| G05 |  |  |  |  |  |  |
| G06 |  |  |  |  |  |  |
| G07 |  |  |  |  |  |  |
| G08 |  |  |  |  |  |  |
| G09 |  |  |  |  |  |  |
| G10 |  |  |  |  |  |  |
| G11 |  |  |  |  |  |  |
| G12 |  |  |  |  |  |  |
| **Total/average** | `TODO_SUBMISSION_AGENT_DRAW_SCORE` |  |  |  | **must be 0** |  |

### Humans draw / agent guesses

| Card | Correct | Time ms | Guesses | Tool errors | Artist initials | Failure tag/notes |
|---|---:|---:|---:|---:|---|---|
| G01 |  |  |  |  |  |  |
| G02 |  |  |  |  |  |  |
| G03 |  |  |  |  |  |  |
| G04 |  |  |  |  |  |  |
| G05 |  |  |  |  |  |  |
| G06 |  |  |  |  |  |  |
| G07 |  |  |  |  |  |  |
| G08 |  |  |  |  |  |  |
| G09 |  |  |  |  |  |  |
| G10 |  |  |  |  |  |  |
| G11 |  |  |  |  |  |  |
| G12 |  |  |  |  |  |  |
| **Total/average** | `TODO_SUBMISSION_AGENT_GUESS_SCORE` |  |  | **must be 0** |  |  |

Both directions need at least 8/12 correct. Any secrecy, authorization, sync, or contract failure blocks the release even if the score target is met.

## Production smoke test

- [ ] Custom domain certificate is active and no redirect loop exists.
- [ ] `www` behavior is intentional and canonical URLs use `https://mcpencil.com`.
- [ ] Worker preview URL is recorded in README after deployment.
- [ ] API errors are JSON; unknown UI routes receive the SPA; unknown API routes do not.
- [ ] Required security headers exist on HTML, assets, API responses, and WebSocket upgrade where applicable.
- [ ] A room created in one browser joins from a different network/device.
- [ ] A deployment during an idle lobby does not destroy persisted room state.
- [ ] Observability contains useful structured fields and no prompt, raw token, or player free text.
- [ ] Page title, favicon, social card, manifest, reduced-motion styles, empty states, and offline errors are correct.
- [ ] Lighthouse/performance inspection finds no obvious oversized asset or layout shift in the judge path.

## Submission freeze

At feature freeze:

1. Replace every `TODO_SUBMISSION` placeholder.
2. Run `rg -n "TODO_SUBMISSION|<account-subdomain>" .` and resolve every intended public placeholder.
3. Run the automated gate from a clean checkout.
4. Tag the exact deployed commit and deploy that tag.
5. Verify live URL, public repository, MIT license, and public YouTube link in a logged-out browser.
6. Submit by 11:00 AM Pacific on September 3, leaving two hours before the 1:00 PM deadline.
7. Freeze the tagged repository and deployment through winner announcement; urgent fixes require a new tag and full smoke test.
