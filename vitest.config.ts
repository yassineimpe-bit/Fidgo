import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    env: {
      DATABASE_URL: "postgres://user:password@127.0.0.1:5432/fidgo_test",
    },
  },
});
