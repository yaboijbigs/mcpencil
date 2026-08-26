import { describe, expect, it } from "vitest";
import { isGuessClose, isGuessCorrect, normalizeGuess, oneEditApart } from "../src/worker/guessing";

describe("guess normalization", () => {
  it("normalizes case, punctuation, spacing, and accents", () => {
    expect(normalizeGuess("  HÓT---Air   Balloon!! ")).toBe("hot air balloon");
    expect(normalizeGuess("Café_Racer")).toBe("cafe racer");
  });

  it("accepts exact canonical answers and curated aliases", () => {
    expect(isGuessCorrect("HOT AIR BALLOON", "hot air balloon", ["balloon"])).toBe(true);
    expect(isGuessCorrect("light-house", "lighthouse", ["light house"])).toBe(true);
    expect(isGuessCorrect("spyglass", "telescope", ["spyglass"])).toBe(true);
  });

  it("ignores ordinary articles without dropping concept words", () => {
    expect(isGuessCorrect("a sleepy turtle", "sleepy turtle", ["tired turtle"])).toBe(true);
    expect(isGuessCorrect("an octopus playing drums", "octopus playing drums")).toBe(true);
    expect(isGuessCorrect("the bear reading a book", "bear reading a book")).toBe(true);
    expect(isGuessCorrect("toaster on a beach", "toaster at the beach", ["toaster on beach"])).toBe(true);
  });

  it("accepts one substitution, insertion, deletion, or transposition for long answers", () => {
    expect(oneEditApart("camera", "camara")).toBe(true);
    expect(oneEditApart("camera", "cameras")).toBe(true);
    expect(oneEditApart("camera", "camra")).toBe(true);
    expect(oneEditApart("camera", "camrea")).toBe(true);
    expect(isGuessCorrect("lighthous", "lighthouse")).toBe(true);
  });

  it("does not typo-match short words or answers more than one edit away", () => {
    expect(isGuessCorrect("bat", "cat")).toBe(false);
    expect(isGuessCorrect("cameraaa", "camera")).toBe(false);
    expect(isGuessCorrect("", "camera")).toBe(false);
    expect(oneEditApart("same", "same")).toBe(false);
  });

  it("does not typo-match semantic changes to required words", () => {
    expect(isGuessCorrect("cat on a cardboard box", "cat in a cardboard box")).toBe(false);
    expect(isGuessCorrect("bat in a cardboard box", "cat in a cardboard box")).toBe(false);
    expect(isGuessCorrect("pear reading a book", "bear reading a book")).toBe(false);
    expect(isGuessCorrect("fox hiding a scooter", "fox riding a scooter")).toBe(false);
    expect(isGuessCorrect("frog in a lily pad", "frog on a lily pad")).toBe(false);
  });

  it("does not accept semantic near-misses without a curated alias", () => {
    expect(isGuessCorrect("helicopter", "hot air balloon", ["balloon"])).toBe(false);
    expect(isGuessCorrect("tower", "lighthouse", ["light house"])).toBe(false);
    expect(isGuessCorrect("volcano", "sleepy volcano", ["sleeping volcano"])).toBe(false);
  });

  it("recognizes conservative close guesses after normalization", () => {
    const aliases = ["cowboy cactus", "cactus wearing a cowboy hat"];
    expect(isGuessClose(" CÁCTUS!!! ", "cactus wearing a hat", aliases)).toBe(true);
    expect(isGuessCorrect("cactus wearing hat", "cactus wearing a hat", aliases)).toBe(true);
    expect(isGuessClose("cactus wearing", "cactus wearing a hat", aliases)).toBe(true);
    expect(isGuessClose("tree", "treehouse", ["tree house"])).toBe(true);
  });

  it("does not label correct or unrelated guesses as close", () => {
    const aliases = ["cowboy cactus", "cactus wearing a cowboy hat"];
    expect(isGuessClose("cactus wearing a hat", "cactus wearing a hat", aliases)).toBe(false);
    expect(isGuessClose("hat", "cactus wearing a hat", aliases)).toBe(false);
    expect(isGuessClose("cactus orchestra", "cactus wearing a hat", aliases)).toBe(false);
    expect(isGuessClose("robot vacuuming carpet", "robot watering a plant", ["gardening robot"])).toBe(false);
    expect(isGuessClose("octopus skating", "octopus playing drums", ["octopus drummer"])).toBe(false);
    expect(isGuessClose("dragonfly", "tiny dragon", ["dragon"])).toBe(false);
  });
});
