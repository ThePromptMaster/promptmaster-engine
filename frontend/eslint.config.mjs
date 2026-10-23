import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Material Symbols are written as their ligature names; they are icons, not words.
const ICONS = ["person", "expand_more", "expand_less", "palette", "translate", "logout", "science", "arrow_back", "attach_file", "close", "check", "add", "arrow_upward", "arrow_forward", "description", "image", "delete", "edit", "refresh", "info", "lightbulb", "help", "chat", "auto_awesome", "menu_book", "bolt", "tune", "undo"];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Translated files (client, 21 Oct: "pick your language"): words people
  // read come from lib/i18n/messages, so a bare English sentence in JSX is a
  // regression. Widened as each surface is translated.
  {
    files: [
      "src/components/shared/app-header.tsx",
      "src/components/shared/colour-preferences.tsx",
      "src/components/shared/beta-notice.tsx",
      "src/components/shared/feedback-form.tsx",
    ],
    rules: {
      "react/jsx-no-literals": ["error", { noStrings: false, ignoreProps: true, allowedStrings: ["PromptMaster", "·", "—", "…", ...ICONS] }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright: the E2E build output, recordings and report.
    ".next-e2e/**",
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
