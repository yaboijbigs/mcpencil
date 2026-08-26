export interface PromptCard {
  readonly prompt: string;
  readonly category: string;
  readonly aliases: readonly string[];
}

// Original cards intentionally favor silhouettes that read well under constrained geometry.
export const PROMPT_DECK: readonly PromptCard[] = [
  { prompt: "campfire", category: "outdoors", aliases: ["fire", "bonfire"] },
  {
    prompt: "robot gardener",
    category: "characters",
    aliases: ["gardening robot", "robot gardening", "robot watering a plant", "robot watering the plant"],
  },
  { prompt: "hot air balloon", category: "travel", aliases: ["air balloon", "balloon"] },
  { prompt: "sleepy volcano", category: "nature", aliases: ["sleeping volcano"] },
  { prompt: "pancake tower", category: "food", aliases: ["stack of pancakes", "pancakes"] },
  { prompt: "moon mailbox", category: "space", aliases: ["mailbox on the moon", "space mailbox"] },
  { prompt: "roller-skating octopus", category: "animals", aliases: ["octopus skating", "skating octopus"] },
  { prompt: "lighthouse", category: "places", aliases: ["light house"] },
  { prompt: "umbrella parade", category: "activities", aliases: ["parade of umbrellas"] },
  { prompt: "telescope", category: "objects", aliases: ["spyglass"] },
  { prompt: "submarine sandwich", category: "wordplay", aliases: ["sub sandwich", "sandwich submarine"] },
  { prompt: "mountain goat", category: "animals", aliases: ["goat on a mountain", "goat"] },
  { prompt: "birthday meteor", category: "space", aliases: ["meteor birthday", "birthday asteroid"] },
  { prompt: "detective duck", category: "characters", aliases: ["duck detective"] },
  { prompt: "treehouse", category: "places", aliases: ["tree house"] },
  { prompt: "kite festival", category: "outdoors", aliases: ["flying kites", "kites"] },
  { prompt: "coffee rocket", category: "wordplay", aliases: ["rocket coffee", "coffee powered rocket"] },
  { prompt: "snail race", category: "activities", aliases: ["racing snails", "snails racing"] },
  { prompt: "desert island", category: "places", aliases: ["island", "tropical island"] },
  { prompt: "drum set", category: "music", aliases: ["drums", "drum kit"] },
  { prompt: "penguin picnic", category: "animals", aliases: ["picnic with penguins", "picnic penguin"] },
  { prompt: "bicycle", category: "travel", aliases: ["bike"] },
  { prompt: "cloud factory", category: "fantasy", aliases: ["factory making clouds"] },
  { prompt: "cactus orchestra", category: "music", aliases: ["cactus band", "musical cactus"] },
  { prompt: "treasure map", category: "objects", aliases: ["map to treasure"] },
  { prompt: "flying library", category: "fantasy", aliases: ["library in the sky", "airborne library"] },
  { prompt: "snowman vacation", category: "activities", aliases: ["vacationing snowman", "snowman on vacation"] },
  { prompt: "pizza planet", category: "space", aliases: ["planet pizza", "pizza world"] },
  { prompt: "bridge", category: "places", aliases: ["river bridge"] },
  { prompt: "camera", category: "objects", aliases: ["photo camera"] },
  { prompt: "dancing teapot", category: "characters", aliases: ["teapot dancing"] },
  { prompt: "rainbow tunnel", category: "fantasy", aliases: ["tunnel rainbow"] },
  { prompt: "beach castle", category: "outdoors", aliases: ["sand castle", "sandcastle"] },
  { prompt: "astronaut fishing", category: "space", aliases: ["fishing astronaut", "space fishing"] },
  { prompt: "tiny dragon", category: "fantasy", aliases: ["baby dragon", "small dragon", "dragon"] },
  { prompt: "train station", category: "travel", aliases: ["railway station"] },
  {
    prompt: "robot watering a plant",
    category: "characters",
    aliases: [
      "robot watering plant",
      "robot watering the plant",
      "a robot watering a plant",
      "a robot watering the plant",
      "watering plant robot",
      "robot gardener",
      "gardening robot",
      "robot gardening",
      "robot with watering can",
    ],
  },
  { prompt: "raccoon stealing a sandwich", category: "animals", aliases: ["raccoon with sandwich", "sandwich thief raccoon"] },
  { prompt: "astronaut walking a dog", category: "space", aliases: ["astronaut dog walk", "space dog walk"] },
  {
    prompt: "cactus wearing a hat",
    category: "characters",
    aliases: [
      "cowboy cactus",
      "cactus in cowboy hat",
      "cactus in a cowboy hat",
      "cactus wearing a cowboy hat",
      "a cactus wearing a cowboy hat",
      "cactus with a cowboy hat",
      "cactus with a hat",
      "a cactus wearing a hat",
    ],
  },
  {
    prompt: "octopus playing drums",
    category: "music",
    aliases: [
      "drumming octopus",
      "octopus drummer",
      "octopus playing the drums",
      "an octopus playing drums",
      "an octopus playing the drums",
      "drum playing octopus",
      "octopus with drums",
    ],
  },
  { prompt: "toaster at the beach", category: "wordplay", aliases: ["beach toaster", "toaster on beach"] },
  { prompt: "moon fishing for a star", category: "space", aliases: ["moon fishing", "fishing moon"] },
  { prompt: "bicycle with square wheels", category: "travel", aliases: ["square wheel bicycle", "square wheeled bike"] },
  { prompt: "penguin delivering pizza", category: "characters", aliases: ["pizza delivery penguin", "penguin with pizza"] },
  { prompt: "cloud using an umbrella", category: "wordplay", aliases: ["cloud with umbrella", "umbrella cloud"] },
] as const;

const PRACTICE_PROMPT_NAMES = new Set([
  "campfire",
  "lighthouse",
  "telescope",
  "treehouse",
  "bicycle",
  "camera",
  "hot air balloon",
  "drum set",
]);
const PRACTICE_PROMPTS = PROMPT_DECK.filter((card) => PRACTICE_PROMPT_NAMES.has(card.prompt));

export function randomPrompt(exclude?: string, practice = false): PromptCard {
  const deck = practice ? PRACTICE_PROMPTS : PROMPT_DECK;
  const random = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  let index = random % deck.length;
  if (deck[index]?.prompt === exclude) index = (index + 1) % deck.length;
  return deck[index] ?? deck[0] ?? PROMPT_DECK[0]!;
}
