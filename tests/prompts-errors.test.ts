import { describe, expect, it, vi } from "vitest";
import { isGuessCorrect, normalizeGuess } from "../src/worker/guessing";
import { PRACTICE_PROMPTS, PROMPT_DECK, randomPrompt } from "../src/worker/prompts";
import {
  ApiError,
  SECURITY_HEADERS,
  applySecurityHeaders,
  failureResponse,
  jsonResponse,
  readJsonBody,
  zodIssues,
} from "../src/worker/errors";

describe("single-word prompt deck", () => {
  it("contains a large, normalized-unique deck and Practice pool", () => {
    expect(PROMPT_DECK.length).toBeGreaterThanOrEqual(150);
    expect(PRACTICE_PROMPTS.length).toBeGreaterThanOrEqual(100);
    expect(PRACTICE_PROMPTS.length).toBeLessThan(PROMPT_DECK.length);
    expect(PRACTICE_PROMPTS.every((card) => card.practiceEligible)).toBe(true);

    const normalizedPrompts = PROMPT_DECK.map((card) => normalizeGuess(card.prompt));
    expect(new Set(normalizedPrompts).size).toBe(PROMPT_DECK.length);

    for (const card of PROMPT_DECK) {
      expect(card.prompt.length).toBeGreaterThan(2);
      expect(card.prompt.length).toBeLessThanOrEqual(40);
      expect(card.prompt, `${card.prompt} must be one lowercase alphabetic word`).toMatch(/^[a-z]+$/);
      expect(normalizeGuess(card.prompt)).toBe(card.prompt);
      expect(card.category.length).toBeGreaterThan(0);
      expect(card.aliases.length).toBeGreaterThan(0);
      expect(card.rejectedAnswers.length).toBeGreaterThan(0);
    }

    expect(PROMPT_DECK.map((card) => card.prompt)).not.toContain("penguin building an igloo");
    expect(PROMPT_DECK.map((card) => card.prompt)).not.toContain("rabbit painting eggs");
  });

  it("keeps every accepted spelling globally unambiguous", () => {
    const acceptedByNormalizedValue = new Map<string, string>();
    for (const card of PROMPT_DECK) {
      for (const accepted of [card.prompt, ...card.aliases]) {
        const normalized = normalizeGuess(accepted);
        expect(normalized.length).toBeGreaterThan(0);
        expect(
          acceptedByNormalizedValue.get(normalized),
          `duplicate accepted answer ${JSON.stringify(accepted)} on ${card.prompt}`,
        ).toBeUndefined();
        acceptedByNormalizedValue.set(normalized, card.prompt);
      }
    }
  });

  it("accepts every canonical answer and alias while rejecting every vetted near-miss", () => {
    for (const card of PROMPT_DECK) {
      const accepted = new Set([card.prompt, ...card.aliases].map(normalizeGuess));
      const rejected = new Set(card.rejectedAnswers.map(normalizeGuess));

      expect([...accepted].some((answer) => rejected.has(answer))).toBe(false);
      for (const answer of [card.prompt, ...card.aliases]) {
        expect(isGuessCorrect(answer, card.prompt, card.aliases), `${answer} -> ${card.prompt}`).toBe(true);
      }
      for (const answer of card.rejectedAnswers) {
        expect(isGuessCorrect(answer, card.prompt, card.aliases), `${answer} -X-> ${card.prompt}`).toBe(false);
      }
    }
  });

  it("does not repeat a prompt within one room until the selected pool is exhausted", () => {
    for (const practice of [false, true]) {
      const pool = practice ? PRACTICE_PROMPTS : PROMPT_DECK;
      const knownPrompts = new Set(pool.map((card) => card.prompt));
      const used: string[] = [];
      for (let index = 0; index < pool.length; index += 1) {
        const selected = randomPrompt(used, practice);
        expect(knownPrompts.has(selected.prompt)).toBe(true);
        expect(used).not.toContain(selected.prompt);
        used.push(selected.prompt);
      }
      expect(new Set(used)).toHaveLength(pool.length);

      const exhausted = randomPrompt(used, practice);
      expect(knownPrompts.has(exhausted.prompt)).toBe(true);
    }
  });

  it("accepts vetted alternate nouns while rejecting related but incorrect objects", () => {
    const card = (prompt: string) => PROMPT_DECK.find((candidate) => candidate.prompt === prompt)!;
    const rabbit = card("rabbit");
    expect(isGuessCorrect("rabbit", rabbit.prompt, rabbit.aliases)).toBe(true);
    expect(isGuessCorrect("bunny", rabbit.prompt, rabbit.aliases)).toBe(true);
    expect(isGuessCorrect("cat", rabbit.prompt, rabbit.aliases)).toBe(false);
    expect(isGuessCorrect("hamster", rabbit.prompt, rabbit.aliases)).toBe(false);

    const flashlight = card("flashlight");
    expect(isGuessCorrect("torch", flashlight.prompt, flashlight.aliases)).toBe(true);
    expect(isGuessCorrect("lamp", flashlight.prompt, flashlight.aliases)).toBe(false);
  });
});

describe("safe Worker responses", () => {
  it("applies challenge security headers", () => {
    const headers = applySecurityHeaders(new Headers());
    expect(headers.get("Permissions-Policy")).toContain("tools=(self)");
    expect(headers.get("Origin-Agent-Cluster")).toBe("?1");
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Object.keys(SECURITY_HEADERS).length).toBeGreaterThanOrEqual(8);
  });

  it("returns non-cacheable JSON with structured API errors", async () => {
    const response = failureResponse(new ApiError(409, "STALE_VERSION", "Canvas changed."));
    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "Canvas changed.", code: "STALE_VERSION" });
  });

  it("does not reflect unknown error objects into the response", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = failureResponse(new Error("private prompt: do not reflect"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Something went wrong.",
      code: "INTERNAL_ERROR",
    });
    spy.mockRestore();
  });

  it("bounds JSON bodies before parsing", async () => {
    const request = new Request("https://mcpencil.com/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "1234567890" }),
    });
    await expect(readJsonBody(request, 8)).rejects.toMatchObject({
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
    });
  });

  it("rejects malformed JSON and caps issue output", async () => {
    await expect(
      readJsonBody(
        new Request("https://mcpencil.com/api/test", { method: "POST", body: "{" }),
      ),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_JSON" });

    const issues = zodIssues(
      Array.from({ length: 20 }, (_, index) => ({
        path: ["primitives", index],
        message: `issue ${index}`,
      })),
    );
    expect(issues).toHaveLength(12);
    expect(issues[0]).toEqual({ path: "primitives.0", message: "issue 0" });
  });

  it("sets security and no-store headers on normal JSON", () => {
    const response = jsonResponse({ ok: true });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Permissions-Policy")).toContain("tools=(self)");
  });
});
