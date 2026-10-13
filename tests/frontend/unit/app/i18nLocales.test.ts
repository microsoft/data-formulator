import { describe, expect, it } from "vitest";

import en from "../../../../src/i18n/locales/en";
import zh from "../../../../src/i18n/locales/zh";
import hi from "../../../../src/i18n/locales/hi";
import id from "../../../../src/i18n/locales/id";
import ja from "../../../../src/i18n/locales/ja";
import de from "../../../../src/i18n/locales/de";
import fr from "../../../../src/i18n/locales/fr";
import ko from "../../../../src/i18n/locales/ko";

type TranslationValue = string | string[] | { [key: string]: TranslationValue };
type TranslationMap = Record<string, TranslationValue>;

function collectKeys(value: TranslationMap, prefix = ""): Set<string> {
  const keys = new Set<string>();

  for (const [key, child] of Object.entries(value)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string" || Array.isArray(child)) {
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

  it("keeps Hindi translation keys aligned with English", () => {
    expect(collectKeys(hi)).toEqual(collectKeys(en));
  });

  it("keeps Indonesian translation keys aligned with English", () => {
    expect(collectKeys(id)).toEqual(collectKeys(en));
  });

  it("keeps Japanese translation keys aligned with English", () => {
    expect(collectKeys(ja)).toEqual(collectKeys(en));
  });

  it("keeps German translation keys aligned with English", () => {
    expect(collectKeys(de)).toEqual(collectKeys(en));
  });

  it("keeps French translation keys aligned with English", () => {
    expect(collectKeys(fr)).toEqual(collectKeys(en));
  });

  it("keeps Korean translation keys aligned with English", () => {
    expect(collectKeys(ko)).toEqual(collectKeys(en));
  });
});
