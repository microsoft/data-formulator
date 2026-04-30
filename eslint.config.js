import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import jsxA11y from "eslint-plugin-jsx-a11y";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    languageOptions: { globals: globals.browser },
    settings: {
      react: {
        version: "detect", // Automatically detect the React version
      },
    },
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  pluginReact.configs.flat.recommended,
  {
    plugins: {
      'jsx-a11y': jsxA11y,
    },
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-empty-pattern": "off",
      "no-empty": "off",
      "no-unsafe-optional-chaining": "off",
      "no-useless-escape": "off",
      "prefer-const": "off",
      "react/no-unescaped-entities": "off",
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='json'][callee.object.type='CallExpression'][callee.object.callee.name='fetchWithIdentity']",
          message: "Use apiRequest() for JSON API calls instead of fetchWithIdentity().json().",
        },
        {
          selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='json'][callee.object.type='AwaitExpression'][callee.object.argument.callee.name='fetchWithIdentity']",
          message: "Use apiRequest() for JSON API calls instead of (await fetchWithIdentity()).json().",
        },
      ],
    }
  }
];