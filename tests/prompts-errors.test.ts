import { describe, expect, it, vi } from "vitest";
import { PROMPT_DECK, randomPrompt } from "../src/worker/prompts";
import {
  ApiError,
  SECURITY_HEADERS,
  applySecurityHeaders,
  failureResponse,
  jsonResponse,
  readJsonBody,
  zodIssues,
} from "../src/worker/errors";

describe("original prompt deck", () => {
  it("contains a substantial, uniquely named, bounded deck", () => {
    expect(PROMPT_DECK.length).toBeGreaterThanOrEqual(36);
    expect(new Set(PROMPT_DECK.map((card) => card.prompt)).size).toBe(PROMPT_DECK.length);
    for (const card of PROMPT_DECK) {
      expect(card.prompt.length).toBeGreaterThan(2);
      expect(card.prompt.length).toBeLessThanOrEqual(40);
      expect(card.category.length).toBeGreaterThan(0);
      expect(card.aliases).not.toContain(card.prompt);
    }
  });

  it("selects only deck prompts and honors an excluded prompt", () => {
    const knownPrompts = new Set(PROMPT_DECK.map((card) => card.prompt));
    for (let index = 0; index < 24; index += 1) {
      expect(knownPrompts.has(randomPrompt("campfire").prompt)).toBe(true);
      expect(randomPrompt("campfire").prompt).not.toBe("campfire");
    }
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
