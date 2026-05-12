import js from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";

export default tseslint.config(
  { ignores: ["dist", "public/drawio", "node_modules", "functions", "**/*.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs["flat/essential"],
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    files: ["**/*.{ts,tsx,js,jsx,vue}"],
    languageOptions: {
      globals: {
        // DrawIO / mxGraph globals (loaded via external scripts)
        mxUtils: "readonly",
        mxCodec: "readonly",
        mxGraphModel: "readonly",
        mxClient: "readonly",
        Graph: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-this-alias": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-unsafe-function-type": "warn",
      "no-empty": "warn",
      "prefer-const": "warn",
    },
  },
  {
    files: ["**/*.vue"],
    rules: {
      "vue/multi-word-component-names": "warn",
      "vue/no-reserved-component-names": "warn",
      "vue/no-deprecated-destroyed-lifecycle": "warn",
      "vue/prefer-import-from-vue": "warn",
      "no-undef": "off", // TypeScript handles this better for Vue SFCs
    },
  },
  {
    files: ["**/*.{jsx,tsx}"],
    linterOptions: {
      reportUnusedDisableDirectives: "warn",
    },
  },
  {
    files: ["**/__tests__/*.{j,t}s?(x)", "**/tests/unit/**/*.spec.{j,t}s?(x)"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        vi: "readonly",
      },
    },
  },
  {
    files: ["src/export.js"],
    languageOptions: {
      globals: {
        process: "readonly",
      },
    },
  },
);
