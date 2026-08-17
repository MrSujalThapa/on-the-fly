import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __PUBLIC_AGENT_ENABLED__: "false",
    __PUBLIC_BACKEND_ENABLED__: "false",
    __LOCAL_DEV_AGENT_ENABLED__: "true",
    __LOCAL_AGENT_SERVER_URL__: '"http://127.0.0.1:4317"',
    // Mirrors a public build; tests that need the channel call setDiagnosticsEnabled.
    __OTF_DIAGNOSTICS_ENABLED__: "false",
    __OTF_RUNTIME_V2__: "false",
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "happy-dom",
  },
});
