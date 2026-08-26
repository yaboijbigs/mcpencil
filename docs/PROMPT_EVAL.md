# Original prompt and golden-evaluation plan

## Prompt design principles

MCPencil prompts should reward composition, not text spelling or cultural trivia. Every card must be safe for a general audience, understandable without brand knowledge, drawable with the six allowed vector primitives, and visually judgeable on a `1000 × 700` canvas.

The deck is original to this project. Common nouns are facts and not proprietary game content; the combinations, categories, aliases, and difficulty labels below were authored for MCPencil during the challenge period.

Rules for production cards:

- 2–6 meaningful words; no trademarks, public figures, copyrighted characters, flags, or logos;
- no answer that is best communicated by writing letters or numbers;
- no color-dependent answer;
- one dominant subject for easy cards, one relation or action for medium cards, two interacting subjects for hard cards;
- aliases represent ordinary wording differences, never clues unrelated to the visible concept;
- avoid near-duplicate answers within one match;
- do not expose category or aliases to guessers before reveal;
- manually draw each card once with the allowed primitives before admitting it to the deck.

## Twelve-card golden set

This set is frozen for repeatable release evaluation. It should not be used as the entire production deck and should not be injected into an agent's instructions outside the secret artist prompt.

| ID | Canonical answer | Category | Difficulty | Curated aliases | Visual anchors |
|---|---|---|---|---|---|
| G01 | lighthouse | places | easy | light house | tower, beam, water |
| G02 | hot air balloon | travel | easy | balloon | large envelope, basket, sky |
| G03 | robot watering a plant | actions | medium | robot watering plant | robot, watering can, sprout |
| G04 | raccoon stealing a sandwich | animals | hard | raccoon with sandwich; raccoon taking a sandwich | mask face, striped tail, sandwich, reaching |
| G05 | astronaut walking a dog | space | medium | astronaut with dog; astronaut dog walk | helmet, leash, dog, stars |
| G06 | cactus wearing a cowboy hat | silly things | medium | cactus with cowboy hat; cowboy cactus | cactus arms, pot/desert, wide hat |
| G07 | octopus playing drums | music | hard | drumming octopus; octopus drummer | eight arms, drum kit, sticks |
| G08 | toaster at the beach | odd places | medium | beach toaster; toaster on a beach | toaster, toast slots, sun, waves/sand |
| G09 | moon fishing for a star | space | hard | moon catching a star; moon fishing | crescent, rod, line, star |
| G10 | bicycle with square wheels | impossible machines | medium | bike with square wheels; square wheel bicycle | bicycle frame, two squares |
| G11 | penguin delivering pizza | jobs | hard | pizza delivery penguin; penguin with pizza | penguin body, pizza box/slice, motion |
| G12 | cloud using an umbrella | weather | medium | cloud with umbrella; umbrella cloud | cloud, rain, umbrella beneath/held |

The answer matcher additionally handles case, punctuation, repeated spacing, accents, and a one-character typo for sufficiently long normalized answers. The recorded test result must distinguish an accepted canonical/alias/typo from a semantic near-miss.

## Production deck balance

Target at least 72 cards before public launch:

| Category | Count | Easy | Medium | Hard |
|---|---:|---:|---:|---:|
| Animals | 12 | 4 | 5 | 3 |
| Actions | 12 | 3 | 6 | 3 |
| Objects | 12 | 5 | 5 | 2 |
| Places and travel | 12 | 4 | 5 | 3 |
| Space and weather | 12 | 3 | 6 | 3 |
| Silly combinations | 12 | 2 | 6 | 4 |

Practice Pair should draw from a separate short list of visually reliable easy/medium cards so the judge path is fast, but it must still select server-side and keep prompts private.

## Evaluation protocol

Run two blinded passes against all 12 cards.

### Agent draws, humans guess

1. Use the submission model/browser configuration.
2. Give the agent only the private prompt and normal artist tools.
3. Do not coach drawing strategy after the round starts.
4. Recruit at least three human guessers across the set; no guesser sees this document.
5. Record correct/incorrect, time-to-correct, number of drawing batches, primitives, tool errors, and whether a human needed a curated alias.

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
- `PROMPT`: card depended on text, culture, color, or an unclear relationship.

Any `CONTRACT`, `SYNC`, secrecy, or authorization failure blocks release. Content failures may lead to a documented card replacement, but never silently change the golden set mid-run; increment its version and rerun all cards.

## Versioning

Golden set version: **1.0 — August 25, 2026**.

If a card changes, record the old and new wording, reason, date, and commit. Store result artifacts without raw model reasoning or private prompt transport logs.
