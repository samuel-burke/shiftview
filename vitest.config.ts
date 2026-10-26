import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["node_modules", "e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "lcov"],
      include: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "proxy.ts"],
      exclude: ["**/*.test.{ts,tsx}", "**/*.d.ts"],
      // Just under the measured baseline (2026-10-26) so coverage can't drop.
      // The 0.1-point margin absorbs run-to-run noise: identical code has
      // measured 1 function and 1 statement apart between runs.
      // Raise these as coverage improves; the target is 85% lines / 80%
      // branches (docs/testing.md). Never lower them to get a green build.
      thresholds: {
        lines: 68.8,
        statements: 66.5,
        branches: 64.1,
        functions: 56.2,
      },
    },
  },
});
