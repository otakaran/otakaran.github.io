import { defineConfig } from "vitest/config";

// Pure-function unit tests run in Node (Web Crypto + Intl are built in on
// Node 20+). DB/HTTP integration is exercised separately via `wrangler dev`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.js"],
  },
});
