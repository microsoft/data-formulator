import { readdirSync } from "fs";
import { join } from "path";
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

// English connector guides are the Markdown files the server sends with each loader;
// the other locales translate them under loader.<type>.authInstructions.
const GUIDE_KEY = /^loader\.[^.]+\.authInstructions$/;
const withoutGuides = (keys: Set<string>) => new Set([...keys].filter(key => !GUIDE_KEY.test(key)));
const guideKeys = (keys: Set<string>) => [...keys].filter(key => GUIDE_KEY.test(key)).sort();
const GUIDE_DIR = join(__dirname, "../../../../py-src/data_formulator/data_loader/guides");
const MARKDOWN_GUIDES = readdirSync(GUIDE_DIR).filter(file => file.endsWith(".md"))
  .map(file => `loader.${file.slice(0, -3)}.authInstructions`).sort();

describe("i18n locale bundles", () => {
  it("keeps Simplified Chinese translation keys aligned with English", () => {
    expect(withoutGuides(collectKeys(zh))).toEqual(collectKeys(en));
  });

  it("keeps Hindi translation keys aligned with English", () => {
    expect(withoutGuides(collectKeys(hi))).toEqual(collectKeys(en));
  });

  it("keeps Indonesian translation keys aligned with English", () => {
    expect(withoutGuides(collectKeys(id))).toEqual(collectKeys(en));
  });

  it("keeps Japanese translation keys aligned with English", () => {
    expect(withoutGuides(collectKeys(ja))).toEqual(collectKeys(en));
  });

  it("keeps German translation keys aligned with English", () => {
    expect(withoutGuides(collectKeys(de))).toEqual(collectKeys(en));
  });

  it("keeps French translation keys aligned with English", () => {
    expect(withoutGuides(collectKeys(fr))).toEqual(collectKeys(en));
  });

  it("keeps Korean translation keys aligned with English", () => {
    expect(withoutGuides(collectKeys(ko))).toEqual(collectKeys(en));
  });

  it("translates every connector setup guide in each locale", () => {
    for (const locale of [zh, hi, id, ja, de, fr, ko]) {
      expect(guideKeys(collectKeys(locale))).toEqual(MARKDOWN_GUIDES);
    }
  });
});
