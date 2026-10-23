import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Material Symbols are written as their ligature names; they are icons, not words.
const ICONS = ["person", "expand_more", "expand_less", "palette", "translate", "logout", "science", "arrow_back", "attach_file", "close", "check", "add", "arrow_upward", "arrow_forward", "description", "image", "delete", "edit", "refresh", "info", "lightbulb", "help", "chat", "auto_awesome", "menu_book", "bolt", "tune", "undo", "link_off", "travel_explore", "public_off", "content_copy", "recommend", "edit_note", "compress", "folder_open", "workspaces", "chevron_right", "restore_from_trash", "create_new_folder", "drive_file_move", "link", "download", "table_view", "fact_check", "check_circle", "forum", "lock", "list_alt", "splitscreen_right", "task_alt"];

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
      "src/app/projects/new/page.tsx",
      "src/components/projects/front-door.tsx",
      "src/components/projects/guide-interview.tsx",
      "src/components/projects/setup-card.tsx",
      "src/components/projects/workflow-picker.tsx",
      "src/components/projects/start-attachments.tsx",
      "src/components/projects/draft-status.tsx",
      "src/app/projects/page.tsx",
      "src/components/projects/folders-sidebar.tsx",
      "src/components/projects/move-to-menu.tsx",
      "src/components/projects/use-in-project-menu.tsx",
      "src/components/projects/deleted-projects.tsx",
      "src/components/projects/guest-banner.tsx",
      "src/components/workflow/stage-rail.tsx",
      "src/components/workflow/stage-header.tsx",
      "src/components/workflow/project-references.tsx",
      "src/components/workflow/project-reader-pane.tsx",
      "src/components/workflow/project-setup.tsx",
      "src/components/workflow/project-facts.tsx",
      "src/components/workflow/web-sources.tsx",
      "src/components/workflow/project-data.tsx",
      "src/components/workflow/full-document-reader.tsx",
      "src/components/workflow/export-menu.tsx",
    ],
    rules: {
      "react/jsx-no-literals": ["error", { noStrings: false, ignoreProps: true, allowedStrings: ["PromptMaster", "·", "—", "…", ".", "/", "+", "[S", "[R", "]", ";", ...ICONS] }],
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
