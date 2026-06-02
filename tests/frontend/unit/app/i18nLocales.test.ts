import { describe, expect, it } from "vitest";

import en from "../../../../src/i18n/locales/en";
import zh from "../../../../src/i18n/locales/zh";

type TranslationValue = string | Record<string, TranslationValue>;
type TranslationMap = Record<string, TranslationValue>;

function collectKeys(value: TranslationMap, prefix = ""): Set<string> {
  const keys = new Set<string>();

  for (const [key, child] of Object.entries(value)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") {
      keys.add(nextPrefix);
    } else {
      for (const childKey of collectKeys(child, nextPrefix)) {
        keys.add(childKey);
      }
    }
  }

  return keys;
}

describe("i18n locale bundles", () => {
  it("keeps Simplified Chinese translation keys aligned with English", () => {
    expect(collectKeys(zh)).toEqual(collectKeys(en));
  });
});
