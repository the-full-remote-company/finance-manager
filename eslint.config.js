import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Root ESLint configuration.
 *
 * Three constitutional rules are enforced here rather than by convention:
 *
 *  - No raw colour literal and no Tailwind arbitrary colour value (Article V).
 *    Stylelint covers .css; this covers class strings in TS/TSX.
 *  - No hard-coded user-facing string in a rendering package ("Locale":
 *    "Hard-coded user-facing strings are a lint error"). Strings live in
 *    apps/web/messages/de.json and reach the view through next-intl.
 *  - No `any` and no non-null assertion on a security path
 *    ("Baseline security controls").
 */

const HEX_OR_COLOUR_FUNCTION = String.raw`#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color-mix)\s*\(`;
const TAILWIND_ARBITRARY_COLOUR = String.raw`\b(bg|text|border|ring|outline|fill|stroke|decoration|shadow|from|via|to|accent|caret|divide|placeholder)-\[(#|rgb|hsl|oklch)`;

/**
 * `no-restricted-syntax` is a single rule, so a later config block that sets it
 * REPLACES an earlier one rather than adding to it. The colour selectors are
 * therefore spread into every block that touches the rule. Discovered by
 * probing the rule with a violating file, which is the only way to know a lint
 * gate is live.
 */
const COLOUR_SELECTORS = [
  {
    selector: `Literal[value=/${HEX_OR_COLOUR_FUNCTION}/]`,
    message:
      "Article V: raw colour literals MUST NOT appear in this repository. Use a @tfrc/product token.",
  },
  {
    selector: `TemplateElement[value.raw=/${HEX_OR_COLOUR_FUNCTION}/]`,
    message:
      "Article V: raw colour literals MUST NOT appear in this repository. Use a @tfrc/product token.",
  },
  {
    selector: `Literal[value=/${TAILWIND_ARBITRARY_COLOUR}/]`,
    message:
      "Article V: a Tailwind arbitrary colour value is a lint error. Use a @tfrc/product token.",
  },
  {
    selector: "Literal[value=/--color-(gain|loss)/]",
    message:
      "Article V: --color-gain and --color-loss are reserved for literal market direction. Use .amt--gain / .amt--loss for money direction, and neither for status.",
  },
];

const LOCALE_SELECTORS = [
  {
    selector: "JSXText[value=/[\\p{L}]{2,}/u]",
    message:
      "Locale: hard-coded user-facing strings are a lint error. Use useTranslations() and add the key to apps/web/messages/de.json.",
  },
  {
    selector:
      "JSXAttribute[name.name=/^(alt|title|placeholder|label|aria-label|aria-description|aria-placeholder|aria-roledescription|aria-valuetext)$/] > Literal[value=/[\\p{L}]{2,}/u]",
    message:
      "Locale: a user-facing attribute string is a lint error. Use useTranslations() and add the key to apps/web/messages/de.json.",
  },
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    // Plain scripts and config files live outside every tsconfig. Type-aware
    // rules cannot apply to them, so they are linted syntactically rather than
    // excluded — an unlinted file is how a rule quietly stops being enforced.
    files: ["**/scripts/**/*.mjs", "**/*.config.{js,mjs,cjs}", "**/*.cjs", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        module: "writable",
        require: "readonly",
      },
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "no-restricted-syntax": ["error", ...COLOUR_SELECTORS],
    },
  },
  {
    // Security paths: sessions, workspace scoping, password verification.
    files: [
      "packages/auth/src/**/*.ts",
      "packages/api/src/middleware/**/*.ts",
      "packages/db/src/rls.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
    },
  },
  {
    // Rendering surfaces: every user-facing string comes from next-intl.
    files: ["apps/web/**/*.tsx", "packages/ui/src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": ["error", ...COLOUR_SELECTORS, ...LOCALE_SELECTORS],
    },
  },
  {
    files: ["**/tests/**/*.ts", "**/tests/**/*.tsx", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      // A fixture is not a user-facing string, and a test asserting a colour
      // token by name must be able to write it.
      "no-restricted-syntax": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
