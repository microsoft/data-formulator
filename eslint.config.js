import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";

const apiSelectors = [
  {
    selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='json'][callee.object.type='CallExpression'][callee.object.callee.name='fetchWithIdentity']",
    message: "Use apiRequest() for JSON API calls instead of fetchWithIdentity().json().",
  },
  {
    selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='json'][callee.object.type='AwaitExpression'][callee.object.argument.callee.name='fetchWithIdentity']",
    message: "Use apiRequest() for JSON API calls instead of (await fetchWithIdentity()).json().",
  },
];

// Views say what something is and use the roles in src/app/look (or the tokens); only the look module, its
// primitives and the app shell may ask which look is active. See design/sharp/plan.md.
const lookSelectors = [
  {
    selector: "MemberExpression[property.name=/^(look|contrast)$/]",
    message: "Don't branch on the active look in views: add or use a role in src/app/look/roles.ts.",
  },
  {
    selector: "ImportSpecifier[imported.name=/^(useLook|readLook|lookOf|LOOKS)$/]",
    message: "Don't read the active look in views: add or use a role in src/app/look/roles.ts.",
  },
];

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
      'react-hooks': pluginReactHooks,
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
      "react/display-name": "off",
      "react/no-unescaped-entities": "off",
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "no-restricted-syntax": ["error", ...apiSelectors, ...lookSelectors],
    }
  },
  {
    files: ["src/app/look/**", "src/components/look/**", "src/app/theme.ts", "src/app/App.tsx", "src/app/reactApp/runtime/index.tsx"],
    rules: {
      "no-restricted-syntax": ["error", ...apiSelectors],
    },
  },
];