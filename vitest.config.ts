import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./tests/setup/global-setup.ts"],
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    env: { NODE_ENV: "test" },
  },
});
