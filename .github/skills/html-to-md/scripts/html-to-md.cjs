#!/usr/bin/env node
/**
 * @type muscle
 * @lifecycle stable
 * @muscle html-to-md
 * @lifecycle stable
 * @inheritance inheritable
 * @description Convert HTML to Markdown via pandoc
 * @version 1.2.0
 * @reviewed 2026-04-30
 * @platform windows,macos,linux
 * @requires node,pandoc
 *
 * Converts HTML files to clean Markdown. Extracts images to a local
 * images/ directory and rewrites links. Handles tables, lists, code
 * blocks, and nested structures.
 *
 * Usage:
 *   node html-to-md.cjs SOURCE.html [OUTPUT.md] [options]
 *
 * Options:
 *   --extract-images     Download/copy images to images/ dir (default: true)
 *   --no-extract-images  Keep original image URLs
 *   --wrap N             Line wrap width (default: 0 = no wrap)
 *   --gfm               Use GitHub-Flavored Markdown output
 *   --atx-headers        Use ATX-style headers (#) instead of Setext
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

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = argv.slice(2);
  const result = {
    source: null, output: null, extractImages: true,
    wrap: 0, gfm: false, atxHeaders: true,
  };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--extract-images') result.extractImages = true;
    else if (args[i] === '--no-extract-images') result.extractImages = false;
    else if (args[i] === '--wrap' && i + 1 < args.length) result.wrap = parseInt(args[++i], 10);
    else if (args[i] === '--gfm') result.gfm = true;
    else if (args[i] === '--atx-headers') result.atxHeaders = true;
    else if (!args[i].startsWith('--')) positional.push(args[i]);
  }
  if (positional.length === 0) {
    console.error('Usage: node html-to-md.cjs SOURCE.html [OUTPUT.md] [options]');
    process.exit(1);
  }
  result.source = positional[0];
  result.output = positional[1] || positional[0].replace(/\.html?$/i, '.md');
  return result;
}

// ---------------------------------------------------------------------------
// Post-processing: clean up pandoc markdown quirks
// ---------------------------------------------------------------------------
function cleanupMarkdown(md) {
  let result = md;
  // Remove excessive blank lines (3+ → 2)
  result = result.replace(/\n{4,}/g, '\n\n\n');
  // Remove trailing whitespace per line
  result = result.replace(/[ \t]+$/gm, '');
  // Normalize div remnants pandoc may leave
  result = result.replace(/^:::\s*\{[^}]*\}\s*$/gm, '');
  result = result.replace(/^:::\s*$/gm, '');
  return result.trim() + '\n';
}

// ---------------------------------------------------------------------------
// Image extraction
// ---------------------------------------------------------------------------
function extractImages(md, sourceDir, outputDir) {
  const imagesDir = path.join(outputDir, 'images');
  let result = md;

  const imgPattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  let idx = 0;
  const seen = new Map();

  while ((match = imgPattern.exec(md)) !== null) {
    const [full, alt, src] = match;
    if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) continue;

    const srcPath = path.resolve(sourceDir, src);
    if (!fs.existsSync(srcPath)) continue;

    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

    if (seen.has(src)) {
      result = result.replace(full, `![${alt}](${seen.get(src)})`);
      continue;
    }

    const ext = path.extname(srcPath) || '.png';
    const destName = `image-${++idx}${ext}`;
    const destPath = path.join(imagesDir, destName);
    fs.copyFileSync(srcPath, destPath);
    const relPath = `images/${destName}`;
    result = result.replace(full, `![${alt}](${relPath})`);
    seen.set(src, relPath);
  }

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
  const outputDir = path.dirname(outputPath);

  console.log(`\u{1f310} Converting ${sourcePath} \u2192 ${outputPath}`);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-to-md-'));
  process.on('exit', () => { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  const tempMd = path.join(tempDir, '_temp.md');
  const toFormat = args.gfm ? 'gfm' : 'markdown';

  console.log('\u{1f4dd} Converting HTML to Markdown...');
  const pandocArgs = [
    sourcePath, '-o', tempMd,
    '--from', 'html', '--to', toFormat,
    '--resource-path', path.resolve(sourceDir),
  ];
  if (args.atxHeaders) pandocArgs.push('--markdown-headings=atx');
  if (args.wrap > 0) {
    pandocArgs.push('--wrap=auto', `--columns=${args.wrap}`);
  } else {
    pandocArgs.push('--wrap=none');
  }

  try {
    runTool('pandoc', pandocArgs, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 120000 });
  } catch (err) {
    console.error(`ERROR: pandoc failed: ${err.stderr ? err.stderr.toString() : err}`);
    process.exit(1);
  }

  let md = fs.readFileSync(tempMd, 'utf8');
  md = cleanupMarkdown(md);

  if (args.extractImages) {
    md = extractImages(md, sourceDir, outputDir);
  }

  fs.writeFileSync(outputPath, md, 'utf8');

  const stats = fs.statSync(outputPath);
  console.log(`\u2705 Done! Output: ${outputPath}`);
  console.log(`   Size: ${(stats.size / 1024).toFixed(1)} KB`);
}

const args = parseArgs(process.argv);
build(args).catch(err => { console.error(`FATAL: ${err.message || err}`); process.exit(1); });
