#!/usr/bin/env node
/**
 * @type muscle
 * @lifecycle stable
 * @muscle md-format
 * @inheritance inheritable
 * @description Format Markdown source files for professional appearance — whitespace and structure cleanup, no semantic changes
 * @version 1.0.0
 * @reviewed 2026-04-30
 * @platform windows,macos,linux
 * @requires node
 * @currency 2026-04-30
 *
 * Cleans .md files by:
 *  - Stripping UTF-8 BOM, normalizing line endings to LF
 *  - Trimming trailing whitespace (preserves ` \` and `  ` hard breaks)
 *  - Adding ` \` continuity to consecutive blockquote lines (forces visible
 *    line breaks instead of paragraph reflow)
 *  - Collapsing 3+ blank lines to 2
 *  - Ensuring blank line before and after ATX headings
 *  - Ensuring single trailing newline
 *  - Code fences are passed through untouched
 *
 * Usage:
 *   node md-format.cjs FILE.md                  # Print formatted to stdout
 *   node md-format.cjs FILE.md --in-place       # Overwrite file
 *   node md-format.cjs FILE.md --diff           # Show changes (no write)
 *   node md-format.cjs FILE.md --check          # Exit 1 if not formatted
 *   node md-format.cjs DIR --in-place           # Recurse all *.md in DIR
 *
 * Options:
 *   --in-place                  Overwrite source file(s)
 *   --diff                      Show unified diff of changes (no write)
 *   --check                     Exit 1 if any file would change (CI gate)
 *   --no-blockquote-breaks      Disable ` \` continuity in blockquotes
 *   --no-trim-trailing          Disable trailing-whitespace trim
 *   --no-collapse-blanks        Disable blank-line collapsing
 *   --no-normalize-headings     Disable heading-spacing pass
 *   --quiet                     Suppress per-file output
 */

'use strict';

process.on('uncaughtException', (err) => {
  console.error(`\x1b[31m[FATAL] ${err.message}\x1b[0m`);
  process.exit(1);
});

const fs = require('fs');
const path = require('path');

const { formatMarkdown } = require(path.join(__dirname, '..', '..', '..', 'scripts', 'shared', 'markdown-preprocessor.cjs'));

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = {
    paths: [], inPlace: false, diff: false, check: false, quiet: false,
    options: {},
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--in-place') result.inPlace = true;
    else if (a === '--diff') result.diff = true;
    else if (a === '--check') result.check = true;
    else if (a === '--quiet') result.quiet = true;
    else if (a === '--no-blockquote-breaks') result.options.blockquoteBreaks = false;
    else if (a === '--no-trim-trailing') result.options.trimTrailing = false;
    else if (a === '--no-collapse-blanks') result.options.collapseBlanks = false;
    else if (a === '--no-normalize-headings') result.options.normalizeHeadings = false;
    else if (!a.startsWith('--')) result.paths.push(a);
    else { console.error(`Unknown flag: ${a}`); process.exit(2); }
  }
  if (result.paths.length === 0) {
    console.error('Usage: node md-format.cjs FILE_OR_DIR [...] [--in-place|--diff|--check]');
    process.exit(2);
  }
  return result;
}

function collectMarkdownFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.git')) continue;
        walk(full);
      } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(target);
  return out;
}

function unifiedDiff(before, after, filename) {
  const a = before.split('\n');
  const b = after.split('\n');
  const out = [`--- ${filename}`, `+++ ${filename} (formatted)`];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) {
      if (a[i] !== undefined) out.push(`\x1b[31m- ${a[i]}\x1b[0m`);
      if (b[i] !== undefined) out.push(`\x1b[32m+ ${b[i]}\x1b[0m`);
    }
  }
  return out.join('\n');
}

function main() {
  const cfg = parseArgs(process.argv);
  const allFiles = [];
  for (const p of cfg.paths) {
    if (!fs.existsSync(p)) { console.error(`Not found: ${p}`); process.exit(2); }
    allFiles.push(...collectMarkdownFiles(p));
  }

  let changed = 0;
  let unchanged = 0;

  for (const file of allFiles) {
    const before = fs.readFileSync(file, 'utf8');
    const after = formatMarkdown(before, cfg.options);

    if (before === after) {
      unchanged++;
      if (!cfg.quiet && !cfg.check && !cfg.diff && !cfg.inPlace && allFiles.length === 1) {
        process.stdout.write(after);
      }
      continue;
    }

    changed++;

    if (cfg.diff) {
      console.log(unifiedDiff(before, after, file));
    } else if (cfg.inPlace) {
      fs.writeFileSync(file, after, 'utf8');
      if (!cfg.quiet) console.log(`\x1b[33mformatted\x1b[0m ${file}`);
    } else if (cfg.check) {
      if (!cfg.quiet) console.log(`\x1b[33mwould format\x1b[0m ${file}`);
    } else if (allFiles.length === 1) {
      process.stdout.write(after);
    } else {
      if (!cfg.quiet) console.log(`\x1b[33mwould format\x1b[0m ${file}`);
    }
  }

  if (!cfg.quiet && (cfg.inPlace || cfg.check || cfg.diff || allFiles.length > 1)) {
    console.log(`\n${changed} changed, ${unchanged} unchanged, ${allFiles.length} total`);
  }

  if (cfg.check && changed > 0) process.exit(1);
}

main();
