export default [
  {
    files: ["app.js", "shop.js", "store.js", "playbook.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "script" },
    rules: {
      "no-debugger": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-dupe-args": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "valid-typeof": "error",
      eqeqeq: ["error", "always"],
    },
  },
];
