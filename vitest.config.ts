import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __PUBLIC_AGENT_ENABLED__: "false",
    __PUBLIC_BACKEND_ENABLED__: "false",
    __LOCAL_AGENT_SERVER_URL__: '""',
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "happy-dom",
  },
});
