import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "agent-server/dist/**",
      "node_modules/**",
      "scripts/**",
      "eslint.config.mjs",
      "vitest.config.ts",
      "playwright.config.ts",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["src/runtime-v2/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/edit-session*",
                "**/transform-controller*",
                "**/session-operation-state*",
                "**/session-history*",
                "**/page-customization-controller*",
                "**/editor-shell*",
                "**/floating-toolbar*",
                "**/session-command-host*",
                "**/content-script*",
                "**/dom-runtime-adapter*",
                "**/default-commands*",
                "**/style-text-controller*",
                "**/save-window-controller*",
                "**/agent/**",
                "**/editor/index*",
              ],
              message:
                "runtime-v2 cannot import legacy orchestration. Use approved lower-level modules only.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.ts"],
    ignores: ["src/runtime-v2/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/runtime-v2/**", "**/runtime-v2"],
              message: "Legacy code must not import runtime-v2 (strangler boundary).",
            },
          ],
        },
      ],
    },
  },
);
