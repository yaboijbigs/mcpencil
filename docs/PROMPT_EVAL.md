# Prompt difficulty and golden-evaluation plan

## Prompt design principles

MCPencil has two prompt difficulties. **Easy** rewards immediate recognition of a single-word subject, such as `bear`, `dog`, `hat`, or `helicopter`. **Hard** asks players to communicate one visible action, such as `flying a kite` or `driving a car`. Neither difficulty should depend on text spelling, cultural trivia, or decoding an elaborate multi-part scene. Every card should be safe for a general audience, understandable without brand knowledge, drawable with the six allowed vector primitives, and visually judgeable on a `1000 × 700` canvas.

The catalog, categories, accepted whole-answer aliases, and rejected near-misses are authored for MCPencil. The pools use common nouns and everyday action phrases rather than content copied from another game's deck.

Rules for production cards:

- Easy: exactly one lowercase alphabetic canonical word naming a concrete noun; standard closed compounds such as `lighthouse` and `paintbrush` are allowed, but no required action, relationship, emotion, pose, costume, or modifier;
- Hard: a short lowercase phrase describing one concrete, drawable action and its necessary props; avoid unrelated extra subjects, required emotions, and elaborate scene modifiers;
- no trademark, public figure, copyrighted character, flag, or logo;
- no answer that is best communicated by writing letters or numbers;
- no color-dependent answer;
- Easy has one dominant, independently recognizable subject; Hard has one dominant action with enough visual context to distinguish it from simply showing the prop;
- Easy aliases represent the same whole object through ordinary plurals, regional names, alternate spellings, or true synonyms—never a broader category;
- Hard aliases preserve the action: `fly a kite` and `kite flying` can solve `flying a kite`, but `kite` alone cannot. Avoid aliases that double as equipment names, such as `roller skate`, because plural/typo tolerance could otherwise accept `roller skates` without an action;
- every card records tempting rejected answers so incomplete guesses stay rejected in automated tests;
- avoid near-duplicate answers within one match;
- do not expose category or aliases to guessers before reveal;
- manually draw each card with the allowed primitives as part of human validation; being present in the catalog or passing automated tests does not mean a card has completed that validation.

## Historical twelve-card Easy golden set

This noun-only set is frozen for repeatable Easy release evaluation. All 12 cards belong to the current Easy pool. The original easy/medium recognition ratings below are historical evaluation labels, not the current Easy/Hard room setting. The set should not be used as the entire production deck and should not be injected into an agent's instructions outside the secret artist prompt. It provides no evidence of Hard-mode human playability.

| ID | Canonical answer | Category | Historical recognition rating | Curated aliases | Visual anchors |
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

The current server-side pools contain **300 Easy single-word noun cards** and **140 Hard action cards**. Sketch Duet uses a **265-card Easy subset**; Team Match and Free-for-All use all 300 Easy cards. All three modes use the same 140-card Hard pool. Easy remains the default. Each match deals without replacement until its selected pool is exhausted, then continues drawing only from that same pool.

The previous catalog contained 174 nouns, including a 139-card Sketch Duet subset. Those historical counts and the noun-only golden evaluation predate the expanded Easy catalog and optional Hard mode; they are not validation results for the new cards.

Every canonical answer and accepted alias is normalized-unique and tested as correct. Every card also carries at least two rejected near-misses that are tested as incorrect. For example, Easy `rabbit` accepts `bunny`, while `cat` and `hamster` do not count. Hard `driving a car` accepts `drive a car` and `car driving`, while `car` and `washing a car` do not count. Automated checks also cover difficulty-specific pool selection, no repeats before exhaustion, and equipment-only/incomplete Hard guesses. These checks establish catalog and matcher behavior, not human drawing or guessing success rates.

## Evaluation protocol

For the Easy golden set, run two blinded passes against all 12 cards. The thresholds below are evaluation targets, not claims that a new run or the expanded pools have met them.

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

### Separate Hard validation

The new Hard pool needs its own frozen, representative action set and blinded human-agent evaluation before reporting Hard success rates. Use both directions above and the same timing, tool, and ambiguity records. A correct result must communicate the action, not just its object. Do not reuse the historical noun-set results as evidence that the 140 Hard prompts have been human-validated.

## Failure taxonomy

Tag every failed round with one primary cause:

- `CONTRACT`: invalid tool arguments, stale version not recovered, wrong-role call, bad result handling;
- `DRAW_STRATEGY`: legal drawing omitted the prompt's visual anchors;
- `HUMAN_AMBIGUITY`: human drawing lacked distinguishable anchors;
- `VISION`: agent did not interpret visible geometry;
- `MATCHER`: a reasonable equivalent answer was rejected;
- `TIMING`: correct intent arrived after expiry;
- `SYNC`: canvas/state seen by players diverged;
- `PROMPT`: card depended on text, culture, color, or did not provide a concrete recognizable noun in Easy or a clearly drawable action in Hard.

Any `CONTRACT`, `SYNC`, secrecy, or authorization failure blocks release. Content failures may lead to a documented card replacement, but never silently change the golden set mid-run; increment its version and rerun all cards.

## Versioning

Golden set version: **2.0 — August 26, 2026**. Version 2 replaced multi-part action prompts with production single-word nouns after live human-agent playtesting showed that required actions and modifiers slowed both drawing and guessing. That historical observation remains the reason for the noun-only Easy baseline. The later optional Hard pool deliberately reintroduces actions as a separate difficulty; it does not change this golden set or establish new human-playtest results.

If a card changes, record the old and new wording, reason, date, and commit. Store result artifacts without raw model reasoning or private prompt transport logs.
