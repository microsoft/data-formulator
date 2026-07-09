#!/usr/bin/env node
/**
 * @type muscle
 * @lifecycle stable
 * @muscle md-to-txt
 * @lifecycle stable
 * @inheritance inheritable
 * @description Convert Markdown to plain text via pandoc
 * @version 1.2.0
 * @reviewed 2026-04-21
 * @platform windows,macos,linux
 * @requires node,pandoc
 *
 * Strips all Markdown formatting and produces clean plain text.
 * Useful for clipboard export, email body, accessibility, or
 * as input to text analysis tools.
 *
 * Usage:
 *   node md-to-txt.cjs SOURCE.md [OUTPUT.txt] [options]
 *
 * Options:
 *   --wrap N              Line wrap width (default: 80, 0 = no wrap)
 *   --strip-frontmatter   Remove YAML frontmatter
 *   --strip-mermaid       Remove Mermaid diagrams entirely
 *   --strip-images        Remove image references
 *   --no-replace-em-dashes  Disable em-dash --> comma (default: enabled for txt)
 *   --strip-decorative-rules  Strip decorative `---` (default: disabled for txt)
 *
 * Requirements:
 *   - Node.js 24+
 *   - pandoc 2.19+
 * @currency 2026-04-21
 */

'use strict';

process.on("uncaughtException", (err) => {
  console.error(`\x1b[31m[FATAL] ${err.message}\x1b[0m`);
  process.exit(1);
});

const fs = require('fs');
const path = require('path');
const os = require('os');
const { runTool } = require(path.join(__dirname, '..', '..', '..', 'scripts', 'shared', 'tool-runner.cjs'));

// Best-effort load of the shared preprocessor (em-dash + decorative-HR transforms).
let sharedPreprocessor = null;
try { sharedPreprocessor = require(path.join(__dirname, '..', '..', '..', 'scripts', 'shared', 'markdown-preprocessor.cjs')); } catch { /* optional */ }

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = argv.slice(2);
  const result = {
    source: null, output: null, wrap: 80,
    stripFrontmatter: false, stripMermaid: false, stripImages: false,
    replaceEmDashes: undefined, stripDecorativeRules: undefined,
  };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--wrap' && i + 1 < args.length) result.wrap = parseInt(args[++i], 10);
    else if (args[i] === '--strip-frontmatter') result.stripFrontmatter = true;
    else if (args[i] === '--strip-mermaid') result.stripMermaid = true;
    else if (args[i] === '--strip-images') result.stripImages = true;
    else if (args[i] === '--no-replace-em-dashes') result.replaceEmDashes = false;
    else if (args[i] === '--strip-decorative-rules') result.stripDecorativeRules = true;
    else if (args[i] === '--no-strip-decorative-rules') result.stripDecorativeRules = false;
    else if (!args[i].startsWith('--')) positional.push(args[i]);
  }
  if (positional.length === 0) {
    console.error('Usage: node md-to-txt.cjs SOURCE.md [OUTPUT.txt] [options]');
    process.exit(1);
  }
  result.source = positional[0];
  result.output = positional[1] || positional[0].replace(/\.md$/i, '.txt');
  return result;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
async function build(args) {
  const sourcePath = path.resolve(args.source);
  if (!fs.existsSync(sourcePath)) { console.error(`ERROR: Source file not found: ${sourcePath}`); process.exit(1); }

  const outputPath = path.resolve(args.output);
  const sourceDir = path.dirname(sourcePath);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-to-txt-'));
  process.on('exit', () => { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  console.log(`\u{1f4c4} Converting ${sourcePath} \u2192 ${outputPath}`);

  let content = fs.readFileSync(sourcePath, 'utf8');

  // Strip frontmatter
  if (args.stripFrontmatter) {
    const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
    if (fmMatch) content = content.slice(fmMatch[0].length);
  }

  // Strip Mermaid blocks
  if (args.stripMermaid) {
    content = content.replace(/```mermaid\r?\n[\s\S]*?```/g, '[diagram]');
  }

  // Strip image references
  if (args.stripImages) {
    content = content.replace(/!\[([^\]]*)\]\([^)]+\)/g, '[$1]');
  }

  // Apply shared preprocessor transforms (em-dash -> comma; optional HR strip).
  if (sharedPreprocessor) {
    content = sharedPreprocessor.preprocessMarkdown(content, {
      format: 'txt',
      stripFrontmatter: false, // already handled above if requested
      replaceEmDashes: args.replaceEmDashes,
      stripDecorativeRules: args.stripDecorativeRules,
    });
  }

  const tempMd = path.join(tempDir, '_temp.md');
  fs.writeFileSync(tempMd, content, 'utf8');

  console.log('\u{1f4dd} Generating plain text...');
  const pandocArgs = [
    tempMd, '-o', outputPath,
    '--from', 'markdown', '--to', 'plain',
    '--resource-path', path.resolve(sourceDir),
  ];
  if (args.wrap > 0) {
    pandocArgs.push('--wrap=auto', `--columns=${args.wrap}`);
  } else {
    pandocArgs.push('--wrap=none');
  }

  try {
    runTool('pandoc', pandocArgs, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 });
  } catch (err) {
    console.error(`ERROR: pandoc failed: ${err.stderr ? err.stderr.toString() : err}`);
    process.exit(1);
  }

  const stats = fs.statSync(outputPath);
  console.log(`\u2705 Done! Output: ${outputPath}`);
  console.log(`   Size: ${(stats.size / 1024).toFixed(1)} KB`);
}

const args = parseArgs(process.argv);
build(args).catch(err => { console.error(`FATAL: ${err.message || err}`); process.exit(1); });
