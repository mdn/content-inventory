import eslint from "@eslint/js";

export default [
  eslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
    rules: {
      "no-warning-comments": [
        "error",
        { terms: ["xxx"], location: "anywhere" },
      ],
    },
  },
];
