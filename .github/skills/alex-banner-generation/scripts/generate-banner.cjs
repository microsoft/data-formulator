#!/usr/bin/env node
/**
 * generate-banner.cjs
 *
 * Mechanical SVG banner generator for Alex — ACT Edition.
 *
 * What it does:
 *   - Substitutes title / subtitle / watermark into a fixed 1200x300 template.
 *   - Writes the SVG to assets/banner-<slug>.svg (or a path you specify).
 *   - Validates inputs (lengths, watermark whitelist).
 *
 * What it does NOT do (those are LLM/skill jobs):
 *   - Choose a good subtitle.
 *   - Pick the right watermark category.
 *   - Convert SVG to PNG.
 *
 * @inheritance inheritable
 * @currency 2026-04-28
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ALLOWED_WATERMARKS = ['ACT', 'EDITION', 'DOCS', 'RELEASE', 'PLAN', 'NOTE'];
const MAX_TITLE_LEN = 32;       // 56px text fits ~32 chars in a 700px box
const MAX_SUBTITLE_LEN = 80;    // 18px text fits ~80 chars in 700px

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--help' || a === '-h') { out.help = true; continue; }
        if (a === '--force') { out.force = true; continue; }
        if (a.startsWith('--')) {
            const eq = a.indexOf('=');
            if (eq > 0) {
                out[a.slice(2, eq)] = a.slice(eq + 1);
            } else {
                out[a.slice(2)] = argv[i + 1];
                i++;
            }
        }
    }
    return out;
}

function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function escapeXml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function buildSvg({ title, subtitle, watermark }) {
    const T = escapeXml(title);
    const S = escapeXml(subtitle);
    const W = escapeXml(watermark);

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 300" width="1200" height="300" role="img" aria-label="${T} — ${S}">
  <title>${T}</title>
  <desc>${S}</desc>

  <!-- Background: Slate 900 -->
  <rect width="1200" height="300" fill="#0f172a"/>

  <!-- Left accent bar: Indigo 500 -->
  <rect x="0" y="0" width="4" height="300" fill="#6366f1"/>

  <!-- Ghost watermark -->
  <text x="1180" y="252" font-family="'Segoe UI', system-ui, sans-serif"
        font-size="100" font-weight="800" fill="#f1f5f9" opacity="0.10" text-anchor="end">${W}</text>

  <!-- Neural network decoration (right third) -->
  <line x1="880" y1="60"  x2="960"  y2="120" stroke="#6366f1" stroke-width="1.5" opacity="0.18"/>
  <line x1="960" y1="120" x2="1040" y2="80"  stroke="#818cf8" stroke-width="1.5" opacity="0.15"/>
  <line x1="1040" y1="80" x2="1120" y2="140" stroke="#6366f1" stroke-width="1.5" opacity="0.15"/>
  <line x1="960" y1="120" x2="1000" y2="200" stroke="#818cf8" stroke-width="1.5" opacity="0.12"/>
  <line x1="1000" y1="200" x2="1100" y2="220" stroke="#6366f1" stroke-width="1.5" opacity="0.12"/>
  <line x1="1120" y1="140" x2="1100" y2="220" stroke="#818cf8" stroke-width="1.5" opacity="0.10"/>

  <!-- Neural nodes -->
  <circle cx="880"  cy="60"  r="8"  fill="none" stroke="#6366f1" stroke-width="2" opacity="0.25"/>
  <circle cx="960"  cy="120" r="12" fill="none" stroke="#818cf8" stroke-width="2" opacity="0.22"/>
  <circle cx="1040" cy="80"  r="7"  fill="none" stroke="#6366f1" stroke-width="2" opacity="0.20"/>
  <circle cx="1120" cy="140" r="9"  fill="none" stroke="#818cf8" stroke-width="2" opacity="0.18"/>
  <circle cx="1000" cy="200" r="10" fill="none" stroke="#6366f1" stroke-width="2" opacity="0.20"/>
  <circle cx="1100" cy="220" r="7"  fill="none" stroke="#818cf8" stroke-width="2" opacity="0.16"/>

  <!-- Series label -->
  <text x="40" y="90" font-family="'Segoe UI', system-ui, sans-serif"
        font-size="13" font-weight="700" fill="#94a3b8" letter-spacing="5">ALEX · ACT EDITION</text>

  <!-- Title -->
  <text x="40" y="175" font-family="'Segoe UI', system-ui, sans-serif"
        font-size="56" font-weight="700" fill="#f1f5f9">${T}</text>

  <!-- Subtitle -->
  <text x="40" y="220" font-family="'Segoe UI', system-ui, sans-serif"
        font-size="18" font-weight="600" fill="#94a3b8">${S}</text>
</svg>
`;
}

function help() {
    console.log(`Usage: node generate-banner.cjs --title "..." --subtitle "..." --watermark <CATEGORY> [--out <path>] [--force]

Generates an Alex — ACT Edition SVG banner (1200x300) into ./assets/.

Required:
  --title "..."         Document title (<= ${MAX_TITLE_LEN} chars)
  --subtitle "..."      One-line purpose statement (<= ${MAX_SUBTITLE_LEN} chars)
  --watermark <CAT>     One of: ${ALLOWED_WATERMARKS.join(', ')}

Optional:
  --out <path>          Output file (default: assets/banner-<title-slug>.svg)
  --force               Overwrite existing file
  --help, -h            This message

Watermark categories:
  ACT       Critical-thinking content, ACT framework docs
  EDITION   Top-level repo identity (README, ABOUT)
  DOCS      User guides, tutorials, references
  RELEASE   Changelogs, release notes, version stamps
  PLAN      Planning docs, roadmaps, milestones
  NOTE      Session notes, ad-hoc memos

Exit codes:
  0  banner written
  1  validation error (bad inputs)
  2  filesystem error (file exists without --force, write failed)
`);
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) { help(); process.exit(0); }

    const errors = [];
    const title = args.title;
    const subtitle = args.subtitle;
    const watermark = args.watermark;

    if (!title) errors.push('--title is required');
    else if (title.length > MAX_TITLE_LEN) errors.push(`--title too long (${title.length} > ${MAX_TITLE_LEN})`);

    if (!subtitle) errors.push('--subtitle is required');
    else if (subtitle.length > MAX_SUBTITLE_LEN) errors.push(`--subtitle too long (${subtitle.length} > ${MAX_SUBTITLE_LEN})`);

    if (!watermark) errors.push('--watermark is required');
    else if (!ALLOWED_WATERMARKS.includes(watermark.toUpperCase())) {
        errors.push(`--watermark must be one of: ${ALLOWED_WATERMARKS.join(', ')}`);
    }

    if (errors.length) {
        console.error('ERROR: invalid inputs');
        errors.forEach(e => console.error('  -', e));
        console.error('\nRun with --help for usage.');
        process.exit(1);
    }

    const slug = slugify(title);
    const outPath = path.resolve(process.cwd(), args.out || path.join('assets', `banner-${slug}.svg`));

    if (fs.existsSync(outPath) && !args.force) {
        console.error(`ERROR: ${outPath} already exists. Re-run with --force to overwrite.`);
        process.exit(2);
    }

    try {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        const svg = buildSvg({ title, subtitle, watermark: watermark.toUpperCase() });
        fs.writeFileSync(outPath, svg);
    } catch (err) {
        console.error('ERROR: write failed —', err.message);
        process.exit(2);
    }

    const rel = path.relative(process.cwd(), outPath).replace(/\\/g, '/');
    console.log(`Wrote ${rel} (${title.length}c title, ${subtitle.length}c subtitle, ${watermark.toUpperCase()})`);
    console.log(`Embed in markdown: ![Banner](${rel})`);
    process.exit(0);
}

main();
