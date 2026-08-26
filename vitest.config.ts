import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["tests/**/*.test.ts"],
    // DO eviction and alarm helpers may wait for workerd's graceful request drain on Windows.
    testTimeout: 90_000,
    hookTimeout: 30_000,
  },
});
