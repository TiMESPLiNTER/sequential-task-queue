const js = require("@eslint/js");
const globals = require("globals");
const tseslint = require("typescript-eslint");

module.exports = tseslint.config(
    { ignores: ["dist/**", "doc/**"] },
    js.configs.recommended,
    {
        files: ["**/*.js", "**/*.ts"],
        rules: {
            // Always require braces, even for single-statement if/for/while/do bodies.
            "curly": ["error", "all"],
        },
    },
    {
        files: ["**/*.js"],
        languageOptions: {
            globals: globals.node,
        },
    },
    {
        files: ["**/*.ts"],
        extends: [...tseslint.configs.recommendedTypeChecked],
        languageOptions: {
            parserOptions: {
                project: "./tsconfig.eslint.json",
                tsconfigRootDir: __dirname,
            },
        },
        rules: {
            // Variadic args passed through to Function.apply/callbacks genuinely need any[]
            "@typescript-eslint/no-explicit-any": ["error", { ignoreRestArgs: true }],
            // Convention: prefix an intentionally-unused parameter with _ (e.g. required
            // Promise executor params like (resolve, _reject) that aren't used in a test)
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
            "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
            "@typescript-eslint/explicit-member-accessibility": ["error", { accessibility: "explicit" }],
            "@typescript-eslint/explicit-function-return-type": "error",
        },
    },
);
