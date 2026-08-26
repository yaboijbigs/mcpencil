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
- one-primitive WebMCP enforcement, idempotent drawing calls, and stale canvas versions;
- lobby eligibility, mode-specific artist order, team and individual scoring, ties, and match completion;
- private prompt absence from every shared pre-reveal payload;
- human UI/WebMCP command parity;
- WebSocket disconnect, reconnect, and version catch-up;
- one page-lifetime WebMCP descriptor registration plus the exact actionable set and handler rejection by role and phase.

Record the release commit and result:

| Field | Result |
|---|---|
| Commit SHA | `c1d511a64f0d752abfed60a93ad983c2bb1097f0` |
| UTC timestamp | `2026-08-26T06:16:44Z` |
| Node/npm | `v24.15.0` / `11.12.1` |
| Tests | 71/71 passed |
| Typecheck | Passed (`tsc -b`) |
| Production build | Passed (`vite build`) |
| Deployed Worker version | `fe498da0-2af8-492f-b408-37441bda170d` |

That table is retained as the prior production diagnostic. The August 26 release candidate subsequently passed generated Cloudflare types, `tsc -b`, all **95/95 tests across 13 files**, `git diff --check`, and the Vite production build. On the process-heavy Windows development host, the identical Vitest suite was run with `--maxWorkers=1 --no-file-parallelism` after a parallel pool attempt exhausted worker-start capacity; no tests were skipped. The immutable Git SHA and Cloudflare Worker version belong in the public release/deployment record because a commit cannot contain its own final hash or the deployment identifier created from it.

The isolated visual-guesser release was deployed from public source commit `a9956d525b2d61e93f8091aa44f011f132025c26` on August 26, 2026. Generated Cloudflare types, `tsc -b`, **113/113 tests across 17 files**, `git diff --check`, and the Vite production build passed; no tests were skipped. Cloudflare Worker version `da2cf951-0ca1-442f-b03c-1d2c620b97c6` serves `mcpencil.com`, `www.mcpencil.com`, `agent.mcpencil.com`, and the recorded `workers.dev` URL. A live smoke test confirmed 200 responses with CSP and `Permissions-Policy: tools=(self)` on both human and agent origins. A temporary two-seat room—then presented under the former **Practice Pair** label—was created on the human origin and admitted one human and one agent through the agent origin into the same Durable Object; both test seats then left successfully. This verifies routing, TLS, same-origin API policy, and cross-origin room coordination in that historical build. It does not verify the later mode overhaul or replace the pending zero-context browser-agent rehearsals below.

## Recorded production diagnostics

The following observations were made against `https://mcpencil.com` on August 25–26, 2026. They are narrow implementation diagnostics, not a completed zero-context judge rehearsal:

| Observation | Result | Scope |
|---|---|---|
| Page-lifetime WebMCP handle | Passed | The same registered tool handle remained usable across landing → lobby → active-agent-artist state. |
| Inactive artist action gate | Passed | An attempted draw while inactive was rejected by the client action gate before a room mutation. |
| Live stroke settlement | Passed | A production long-line stroke entered its reveal animation, then settled after about 900 ms with no reveal class/dash styling and with both exact canonical endpoints present. |
| Isolated agent origin | Passed | `agent.mcpencil.com` served the agent route with the expected CSP and WebMCP Permissions Policy. |
| Cross-origin two-seat admission | Passed | Under the former Practice Pair label, a human-origin room admitted an agent-origin seat into the same room as distinct `human`/`agent` controllers; both temporary seats were cleaned up. |

These observations did **not** exercise a fresh zero-context invitation, a complete two-round Sketch Duet, Claude, Gemini, both recommended ChatGPT models, a repeated-run reliability target, or either new competitive mode. Those items remain pending below and must not be described as passed in the README, video, or submission.

## 60-second judge-path rehearsal

Use a clean browser profile and the production domain.

- [x] `https://mcpencil.com` loads over TLS with the expected CSP, WebMCP Permissions Policy, and no mixed content.
- [ ] WebMCP support is detected and the user sees a ready state.
- [ ] Human creates Sketch Duet, sees no **Invite a person** action, copies **Invite an AI player** into a fresh no-context agent conversation, and remains in a one-seat lobby until the agent opens the `agent.mcpencil.com` invite, calls `play_mcpencil`, and connects with a separate opaque identity.
- [ ] The pasted agent URL uses `https://agent.mcpencil.com/webmcp/rooms/{code}`, remains exactly `invite=agent` with a `#webmcp` fragment, and adjacent prose cannot become part of the query value.
- [ ] Calling `play_mcpencil` from the already seated human document fails without joining and returns the exact separate agent invite.
- [ ] A fresh agent uses its WebMCP-capable/in-app browser rather than a generic Chrome-control integration, then performs all game actions through page-exposed tools.
- [ ] An unsupported browser reports that WebMCP is unavailable instead of clicking the join form or asking the human to dismiss unrelated browser UI.
- [ ] Host changes to the mode-allowed settings appear for every connected player and survive a reload: rounds plus time in Sketch Duet and Team Match, time only in Free-for-All.
- [ ] Non-host players can see the synchronized settings but cannot change them through either the UI or WebMCP.
- [ ] Changing settings resets connected human ready states while agent seats remain auto-ready.
- [ ] Round one assigns the isolated agent seat as artist and the human as guesser.
- [ ] The complete descriptor registry attaches once; the Lens lists only the agent-artist actions currently authorized, and the prompt event is masked.
- [ ] Three or more `draw_stroke` calls each persist and broadcast separately, return distinct accepted versions, and appear as discrete rendered strokes; no multi-stroke burst appears. The acknowledgement need not prove that a remote browser has already painted the version.
- [ ] Human correct guess ends the round and reveals the answer once.
- [ ] Round two assigns the human as artist and the isolated agent seat as guesser.
- [ ] On role reversal, the Lens removes artist actions from its actionable set; `submit_guesses` becomes actionable only after the human prompt is hidden and the opening stroke lands.
- [ ] Calling a stable descriptor outside its current actionable set fails before local work, and a direct stale mutation is independently rejected by the room authority.
- [ ] Human prompt is private and is removed on round end.
- [ ] The rendered canvas remains visible in the isolated agent browser context; `get_match_state` exposes only the canvas-only `32 × 22` text raster, bounded canonical geometry, and recent guesses (no prompt metadata); the agent calls `submit_guesses`, and every submitted candidate is visible live. Record this transparently rather than claiming a pixel-only vision test.
- [ ] Round result and final replay contain the complete exact guess transcript with player, declared origin, correctness, and timing.
- [ ] Whole flow completes in 60–90 seconds without manual recovery.
- [ ] A 6- or 8-round match completes without descriptor re-registration, a tool-configuration-limit warning, or loss of WebMCP access.

Run at least five judge-path rehearsals. Target four clean first-attempt completions; the final three runs before recording must be clean.

## Mode-overhaul production verification

**Status: deployed; extended production playtest remains pending.** Source commit `3dc35bc` first deployed as Cloudflare Worker version `e39779f0-7141-4ca4-9573-e1a25ecc7347` on August 26, 2026. Generated Cloudflare types, TypeScript, the Vite production build, `git diff --check`, and the sequential **120/120 tests across 17 files** passed. Live checks confirmed the same `index-DCGt-_UI.js` bundle, CSP, and `Permissions-Policy: tools=(self)` across `mcpencil.com`, `www.mcpencil.com`, `agent.mcpencil.com`, and the `workers.dev` URL. A temporary three-seat Free-for-All room reported three rounds, three zeroed individual standings, and no team score before all smoke-test seats were removed. The checks marked below were also observed on the deployed human and agent origins; the remaining full-match checks are deliberately still pending.

- [x] Landing cards consistently show **Sketch Duet**, **Team Match**, and **Free-for-All** with distinct graphics and rule-aligned descriptions.
- [x] A human invite deep link scrolls to the prefilled join form and focuses the display-name field; an agent invite remains on the isolated WebMCP handoff path with `play_mcpencil` available.
- [ ] Sketch Duet admits exactly one human plus one agent, exposes no human-invite action to its human creator, alternates roles for 2, 4, or 6 rounds, and starts automatically only after both sockets connect.
- [ ] Team Match requires 4–8 players split into two teams of 2–4, runs the selected 4, 6, or 8 rounds, rotates artists, permits only active teammates to guess, and awards only the team score.
- [ ] Free-for-All requires 3–8 players, exposes only drawing time as a host setting, freezes the starting roster and stable shuffled artist order, and creates exactly one round per starting player.
- [ ] During every Free-for-All round, all starting non-artists can guess simultaneously, the first accepted correct guess ends the round, and later guesses cannot mutate the result.
- [ ] A solved Free-for-All round independently credits the artist and first solver `100 + remaining whole seconds`; an unsolved round awards neither; the individual leaderboard and final standings agree with persisted scores.
- [ ] Free-for-All can end in a valid tie and displays all tied leaders without inventing a tie-breaker.
- [ ] Human and agent seats complete all three modes through the same stable ten-tool WebMCP registry without descriptor churn.

## Multiplayer matrix

| Scenario | Clients | Expected result | Pass |
|---|---:|---|---|
| Sketch Duet | 1 human + 1 agent | Starts only after both sockets connect; roles alternate; no human invite is offered | [ ] |
| Mixed 2v2 Team Match | 4 | Configured rounds alternate teams and rotate artists; only teammates guess; team score persists | [ ] |
| Full Team Match | 8 | Two teams cap at four seats; every active artist remains mode-authorized across rotation | [ ] |
| Three-player Free-for-All | 3 | Roster freezes; shuffled order is stable; exactly three rounds run; each player draws once | [ ] |
| Mixed eight-player Free-for-All | 8 | All seven non-artists may guess; individual standings persist through all eight rounds | [ ] |
| Late join after start | 1 attempted join | Frozen competitive roster is unchanged and no new competitor is added | [ ] |
| Artist disconnect | 2+ | Timer continues; reconnect restores seat and canvas | [ ] |
| Guesser disconnect | 2+ | Other clients continue; reconnect gets missed version(s) | [ ] |
| Durable Object eviction | test helper | Reconstructed object preserves state and scheduled round semantics | [ ] |
| Simultaneous Free-for-All guesses | 2+ guessers | First correct transition credits that solver and the artist once; later mutation receives round-ended result | [ ] |
| Duplicate stroke | 1 artist | Same idempotency key returns duplicate acknowledgement, no extra stroke | [ ] |
| Stale stroke | 2 artist sessions | Old expected version is rejected with current version guidance | [ ] |
| Expired stroke | 1 artist | Mutation after `endsAt` is rejected and round finalizes once | [ ] |

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
| Chrome 149+ with WebMCP enabled | Stable descriptor registration, role/phase action gate, annotations, compact results | [ ] |
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

### Zero-context interoperability evidence

No row below is complete yet. Record the exact app/browser build, model, invitation text, room, outcome, time to join, time to first action, tool errors, and whether any DOM/browser-automation fallback was attempted. A claimed supported client needs repeated fresh conversations, not a reused task with MCPencil context.

| Client target | Required before claiming support | Recorded clean runs | Status |
|---|---|---:|---|
| ChatGPT desktop + GPT-5.6 Sol | Five fresh zero-context Sketch Duet invitations; final three consecutive runs clean | 0 | Pending |
| ChatGPT desktop + GPT-5.6 Terra | Five fresh zero-context Sketch Duet invitations; final three consecutive runs clean | 0 | Pending |
| Claude browser-agent surface | First confirm that the tested public client exposes page WebMCP; then run three fresh invitations | 0 | Capability and runs pending; not currently claimed as supported |
| Gemini browser-agent surface | First confirm that the tested public client exposes page WebMCP; then run three fresh invitations | 0 | Capability and runs pending; not currently claimed as supported |

For every run, opening the page is not success: the agent must call `play_mcpencil`, follow each callable `nextAction`, complete both directions, and reach `match-end` without substituting DOM clicks or generic browser automation for game actions.

## Golden visual evaluation

Use the frozen set and protocol in [PROMPT_EVAL.md](PROMPT_EVAL.md).

### Agent draws / humans guess

| Card | Correct | Time ms | Strokes | Tool calls | Tool errors | Failure tag/notes |
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
3. Run `git status --short` and verify every required source file and asset is tracked while incidental local screenshots, generated scratch output, credentials, and caches are excluded.
4. Run the automated gate from a clean checkout.
5. Tag the exact public commit, deploy that tag, and record the commit, tag, UTC timestamp, and Worker version above.
6. Verify the live URL, public repository, licenses/notices, and public YouTube link in a logged-out browser.
7. Submit by 11:00 AM Pacific on September 3, leaving two hours before the 1:00 PM deadline.
8. Freeze the tagged repository and deployment through winner announcement; urgent fixes require a new tag and full smoke test.
