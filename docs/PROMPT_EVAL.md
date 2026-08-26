# Original prompt and golden-evaluation plan

## Prompt design principles

MCPencil prompts should reward immediate object recognition, not text spelling, cultural trivia, or decoding a multi-part scene. Every card must be safe for a general audience, understandable without brand knowledge, drawable with the six allowed vector primitives, and visually judgeable on a `1000 × 700` canvas.

The deck is original to this project. Common nouns are facts and not proprietary game content; the combinations, categories, accepted whole-answer aliases, and rejected near-misses were authored for MCPencil during the challenge period.

Rules for production cards:

- exactly one lowercase alphabetic canonical word naming a concrete noun; standard closed compounds such as `lighthouse` and `paintbrush` are allowed;
- no action, relationship, required emotion, pose, costume, modifier, trademark, public figure, copyrighted character, flag, or logo;
- no answer that is best communicated by writing letters or numbers;
- no color-dependent answer;
- one dominant, independently recognizable subject on every card;
- aliases represent the same whole object through ordinary plurals, regional names, alternate spellings, or true synonyms—never a broader category;
- every card records tempting rejected answers so incomplete guesses stay rejected in automated tests;
- avoid near-duplicate answers within one match;
- do not expose category or aliases to guessers before reveal;
- manually draw each card once with the allowed primitives before admitting it to the deck.

## Twelve-card golden set

This set is frozen for repeatable release evaluation. It should not be used as the entire production deck and should not be injected into an agent's instructions outside the secret artist prompt.

| ID | Canonical answer | Category | Difficulty | Curated aliases | Visual anchors |
|---|---|---|---|---|---|
| G01 | lighthouse | places | medium | light house | tower, lantern room, beam |
| G02 | rabbit | animals | easy | bunny | long ears, compact body, tail |
| G03 | penguin | animals | easy | penguins | flippers, white belly, feet |
| G04 | camera | objects | easy | cameras | body, lens, shutter button |
| G05 | cactus | nature | easy | cacti | trunk, raised arms, spikes |
| G06 | volcano | nature | easy | volcanoes | mountain cone, crater, eruption |
| G07 | guitar | objects | medium | guitars | body, sound hole, neck, strings |
| G08 | robot | characters | easy | automaton | geometric head/body, joints |
| G09 | turtle | animals | easy | tortoise | shell, head, four legs |
| G10 | bicycle | objects | medium | bike | two wheels, frame, handlebars |
| G11 | octopus | animals | medium | octopuses | round head, eight arms |
| G12 | castle | places | medium | fortress | towers, battlements, gate |

The answer matcher additionally handles case, punctuation, repeated spacing, accents, and a one-character typo for sufficiently long normalized answers. The recorded test result must distinguish an accepted canonical/alias/typo from a semantic near-miss.

## Production deck balance

The production deck contains 174 server-side single-word noun cards. Practice Pair draws from 139 vetted easy/medium cards, preventing the tiny-pool repetition that made separate practice matches feel identical while keeping the judge path legible. Both modes deal without replacement inside a match.

Every canonical answer and accepted alias is normalized-unique and tested as correct. Every card also carries at least two rejected near-misses that are tested as incorrect. For example, `rabbit` accepts `bunny`, while related drawings or broad guesses such as `cat` and `hamster` do not count.

## Evaluation protocol

Run two blinded passes against all 12 cards.

### Agent draws, humans guess

1. Use the submission model/browser configuration.
2. Give the agent only the private prompt and normal artist tools.
3. Do not coach drawing strategy after the round starts.
4. Recruit at least three human guessers across the set; no guesser sees this document.
5. Record correct/incorrect, time-to-correct, visible strokes, tool calls, tool errors, and whether a human needed a curated alias.

Release target: **at least 8/12 cards guessed correctly** and **zero tool-contract failures**.

### Humans draw, agent guesses

1. Use the same model/browser configuration and a fresh room.
2. The artist sees the normal private prompt UI and uses only shipped controls.
3. The agent receives no prompt/category/alias metadata and may inspect only the visible game page plus role-safe match state.
4. Use at least three human artists across the set; do not let an artist write letters or numbers.
5. Record correct/incorrect, time-to-correct, guesses submitted, any tool errors, and obvious ambiguity.

Release target: **at least 8/12 cards guessed correctly** and **zero tool-contract failures**.

## Failure taxonomy

Tag every failed round with one primary cause:

- `CONTRACT`: invalid tool arguments, stale version not recovered, wrong-role call, bad result handling;
- `DRAW_STRATEGY`: legal drawing omitted the prompt's visual anchors;
- `HUMAN_AMBIGUITY`: human drawing lacked distinguishable anchors;
- `VISION`: agent did not interpret visible geometry;
- `MATCHER`: a reasonable equivalent answer was rejected;
- `TIMING`: correct intent arrived after expiry;
- `SYNC`: canvas/state seen by players diverged;
- `PROMPT`: card depended on text, culture, color, or was not a concrete recognizable noun.

Any `CONTRACT`, `SYNC`, secrecy, or authorization failure blocks release. Content failures may lead to a documented card replacement, but never silently change the golden set mid-run; increment its version and rerun all cards.

## Versioning

Golden set version: **2.0 — August 26, 2026**. Version 2 replaced multi-part action prompts with production single-word nouns after live human-agent playtesting showed that required actions and modifiers slowed both drawing and guessing.

If a card changes, record the old and new wording, reason, date, and commit. Store result artifacts without raw model reasoning or private prompt transport logs.
