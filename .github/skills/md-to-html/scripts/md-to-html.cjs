#!/usr/bin/env node
/**
 * @type muscle
 * @lifecycle stable
 * @muscle md-to-html
 * @lifecycle stable
 * @inheritance inheritable
 * @description Convert Markdown to standalone HTML with embedded assets
 * @version 1.2.0
 * @skill md-to-html
 * @reviewed 2026-04-15
 * @platform windows,macos,linux
 * @requires node,pandoc (mermaid-cli optional for --mermaid-png)
 *
 * Produces self-contained HTML files with embedded CSS, Mermaid diagram PNGs,
 * and local images as base64 data URIs. Designed for quick-share distribution
 * without requiring Word or email.
 *
 * Usage:
 *   node md-to-html.cjs SOURCE.md [OUTPUT.html] [options]
 *
 * Options:
 *   --style PRESET      Style: professional (default), academic, minimal, dark
 *   --toc               Generate table of contents
 *   --embed-images      Embed local images as base64 data URIs (default: true)
 *   --no-embed-images   Keep image references as-is
 *   --strip-frontmatter Strip YAML frontmatter (default: true)
 *   --mermaid-png       Render Mermaid diagrams to inline PNG (requires mmdc)
 *   --mermaid-fallback  Convert Mermaid to table fallback (default, no deps)
 *   --debug             Save preprocessed markdown as _debug_combined.md
 *   --dry-run           Run preprocessing only, no HTML output
 *
 * Requirements:
 *   - Node.js 24+
 *   - pandoc (Windows: winget install pandoc | macOS: brew install pandoc | Linux: apt install pandoc)
 *   - mermaid-cli (optional, for --mermaid-png)
 * @currency 2026-04-20
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
// Shared module imports
// ---------------------------------------------------------------------------
let sharedPreprocessor, sharedMermaid, sharedDataUri;
try {
  sharedPreprocessor = require(path.join(__dirname, '..', '..', '..', 'scripts', 'shared', 'markdown-preprocessor.cjs'));
  sharedMermaid = require(path.join(__dirname, '..', '..', '..', 'scripts', 'shared', 'mermaid-pipeline.cjs'));
  sharedDataUri = require(path.join(__dirname, '..', '..', '..', 'scripts', 'shared', 'data-uri.cjs'));
} catch {
  console.error('WARN: shared modules not found -- some features will be limited');
}

// ---------------------------------------------------------------------------
// Style presets
// ---------------------------------------------------------------------------
const STYLE_PRESETS = {
  professional: {
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
    codeFontFamily: "'Consolas', 'Fira Code', monospace",
    fontSize: '15px',
    lineHeight: '1.6',
    maxWidth: '900px',
    textColor: '#1F2328',
    bgColor: '#ffffff',
    linkColor: '#0563C1',
    h1Color: '#0078D4',
    h2Color: '#2B579A',
    h3Color: '#3B3B3B',
    tableHeaderBg: '#0078D4',
    tableHeaderColor: '#ffffff',
    tableStripeBg: '#F6F8FA',
    tableBorder: '#D0D7DE',
    codeBg: '#F6F8FA',
    codeBorder: '#E1E4E8',
    blockquoteBorder: '#0078D4',
    blockquoteBg: '#F0F7FF',
  },
  academic: {
    fontFamily: "'Palatino Linotype', 'Book Antiqua', Palatino, serif",
    codeFontFamily: "'Consolas', monospace",
    fontSize: '16px',
    lineHeight: '1.7',
    maxWidth: '750px',
    textColor: '#24292F',
    bgColor: '#ffffff',
    linkColor: '#0550AE',
    h1Color: '#24292F',
    h2Color: '#24292F',
    h3Color: '#57606A',
    tableHeaderBg: '#24292F',
    tableHeaderColor: '#ffffff',
    tableStripeBg: '#F6F8FA',
    tableBorder: '#D0D7DE',
    codeBg: '#F6F8FA',
    codeBorder: '#E1E4E8',
    blockquoteBorder: '#57606A',
    blockquoteBg: '#F6F8FA',
  },
  minimal: {
    fontFamily: "'Inter', system-ui, sans-serif",
    codeFontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: '15px',
    lineHeight: '1.65',
    maxWidth: '800px',
    textColor: '#333333',
    bgColor: '#ffffff',
    linkColor: '#0969DA',
    h1Color: '#111111',
    h2Color: '#222222',
    h3Color: '#444444',
    tableHeaderBg: '#F3F4F6',
    tableHeaderColor: '#111111',
    tableStripeBg: '#F9FAFB',
    tableBorder: '#E5E7EB',
    codeBg: '#F3F4F6',
    codeBorder: '#E5E7EB',
    blockquoteBorder: '#D1D5DB',
    blockquoteBg: '#F9FAFB',
  },
  dark: {
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    codeFontFamily: "'Consolas', 'Fira Code', monospace",
    fontSize: '15px',
    lineHeight: '1.6',
    maxWidth: '900px',
    textColor: '#C9D1D9',
    bgColor: '#0D1117',
    linkColor: '#58A6FF',
    h1Color: '#58A6FF',
    h2Color: '#79C0FF',
    h3Color: '#A5D6FF',
    tableHeaderBg: '#161B22',
    tableHeaderColor: '#C9D1D9',
    tableStripeBg: '#161B22',
    tableBorder: '#30363D',
    codeBg: '#161B22',
    codeBorder: '#30363D',
    blockquoteBorder: '#3B82F6',
    blockquoteBg: '#161B22',
  },
};

// ---------------------------------------------------------------------------
// CSS generation
// ---------------------------------------------------------------------------
function generateCss(style) {
  return `
    * { box-sizing: border-box; }
    body {
      font-family: ${style.fontFamily};
      font-size: ${style.fontSize};
      line-height: ${style.lineHeight};
      color: ${style.textColor};
      background: ${style.bgColor};
      max-width: ${style.maxWidth};
      margin: 0 auto;
      padding: 32px 24px;
    }
    h1 { color: ${style.h1Color}; font-size: 2em; font-weight: 600; margin-top: 1.5em; margin-bottom: 0.5em; border-bottom: 2px solid ${style.h1Color}; padding-bottom: 0.3em; }
    h2 { color: ${style.h2Color}; font-size: 1.5em; font-weight: 600; margin-top: 1.3em; margin-bottom: 0.4em; }
    h3 { color: ${style.h3Color}; font-size: 1.25em; font-weight: 600; margin-top: 1.1em; margin-bottom: 0.3em; }
    h4, h5, h6 { color: ${style.h3Color}; margin-top: 1em; margin-bottom: 0.3em; }
    a { color: ${style.linkColor}; text-decoration: none; }
    a:hover { text-decoration: underline; }
    p { margin: 0.8em 0; }
    img { max-width: 100%; height: auto; display: block; margin: 1em auto; }
    code {
      font-family: ${style.codeFontFamily};
      font-size: 0.9em;
      background: ${style.codeBg};
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid ${style.codeBorder};
    }
    pre {
      font-family: ${style.codeFontFamily};
      font-size: 0.88em;
      background: ${style.codeBg};
      padding: 16px;
      border-radius: 6px;
      border: 1px solid ${style.codeBorder};
      overflow-x: auto;
      white-space: pre-wrap;
      line-height: 1.45;
    }
    pre code { background: none; border: none; padding: 0; font-size: 1em; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th {
      background: ${style.tableHeaderBg};
      color: ${style.tableHeaderColor};
      padding: 8px 12px;
      text-align: left;
      border: 1px solid ${style.tableBorder};
      font-weight: 600;
    }
    td { padding: 8px 12px; border: 1px solid ${style.tableBorder}; }
    tbody tr:nth-child(even) { background: ${style.tableStripeBg}; }
    blockquote {
      border-left: 4px solid ${style.blockquoteBorder};
      margin: 1em 0;
      padding: 8px 16px;
      background: ${style.blockquoteBg};
      color: ${style.textColor};
    }
    blockquote p { margin: 0.4em 0; }
    hr { border: none; border-top: 1px solid ${style.tableBorder}; margin: 2em 0; }
    ul, ol { margin: 0.8em 0; padding-left: 2em; }
    li { margin: 0.3em 0; }
    kbd { font-family: ${style.codeFontFamily}; font-size: 0.85em; background: ${style.codeBg}; padding: 2px 6px; border: 1px solid ${style.tableBorder}; border-radius: 3px; box-shadow: 0 1px 0 ${style.tableBorder}; }
    mark { background: #FFF3BF; padding: 1px 4px; border-radius: 2px; }
    .toc { background: ${style.codeBg}; border: 1px solid ${style.codeBorder}; border-radius: 6px; padding: 16px 24px; margin: 1.5em 0; }
    .toc h2 { margin-top: 0; border-bottom: none; font-size: 1.2em; }
    .toc ul { list-style: none; padding-left: 0; }
    .toc li { margin: 0.2em 0; }
    .toc a { color: ${style.linkColor}; }
    @media print {
      body { max-width: 100%; padding: 0; }
      a { color: ${style.textColor}; text-decoration: none; }
      pre, code { border: 1px solid #ccc; }
    }
  `.trim();
}

// ---------------------------------------------------------------------------
// Mermaid handling
// ---------------------------------------------------------------------------
function processMermaidBlocks(markdown, sourceDir, usePng) {
  if (!sharedMermaid) {
    return markdown.replace(/```mermaid\r?\n[\s\S]*?```/g, '*[Diagram -- view source markdown]*');
  }

  const blocks = sharedMermaid.findMermaidBlocks(markdown);
  if (blocks.length === 0) return markdown;

  for (const block of blocks) {
    if (usePng) {
      // Render to PNG and embed as base64
      const tmpPng = path.join(os.tmpdir(), `mmd-html-${Date.now()}-${block.index}.png`);
      const rendered = sharedMermaid.renderMermaid(block.content, tmpPng, {
        format: 'html', scale: 3, width: 1200, injectPalette: true
      });
      if (rendered && fs.existsSync(tmpPng)) {
        try {
          const base64 = fs.readFileSync(tmpPng).toString('base64');
          markdown = markdown.replace(block.raw, `![Diagram](data:image/png;base64,${base64})`);
        } finally {
          try { fs.unlinkSync(tmpPng); } catch { /* ignore */ }
        }
      } else {
        const fallback = sharedMermaid.mermaidToTableFallback(block.content);
        markdown = markdown.replace(block.raw, fallback);
      }
    } else {
      const fallback = sharedMermaid.mermaidToTableFallback(block.content);
      markdown = markdown.replace(block.raw, fallback);
    }
  }
  return markdown;
}

// ---------------------------------------------------------------------------
// Image embedding
// ---------------------------------------------------------------------------
function embedLocalImages(html, sourceDir) {
  return html.replace(/<img\s+([^>]*?)src=["']([^"']+)["']([^>]*)>/g, (match, pre, src, post) => {
    if (src.startsWith('http') || src.startsWith('data:')) return match;
    const imagePath = path.resolve(sourceDir, src);
    if (!fs.existsSync(imagePath)) return match;

    const ext = path.extname(imagePath).toLowerCase();
    const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
    const mime = mimeMap[ext];
    if (!mime) return match;

    const base64 = fs.readFileSync(imagePath).toString('base64');
    return `<img ${pre}src="data:${mime};base64,${base64}"${post}>`;
  });
}

// ---------------------------------------------------------------------------
// Main conversion
// ---------------------------------------------------------------------------
function convertMarkdownToHtml(sourcePath, outputPath, options = {}) {
  const styleName = options.style || 'professional';
  const style = STYLE_PRESETS[styleName] || STYLE_PRESETS.professional;
  const embedImages = options.embedImages !== false;
  const stripFrontmatter = options.stripFrontmatter !== false;
  const usePngMermaid = !!options.mermaidPng;
  let generateToc = !!options.toc;

  let markdown = fs.readFileSync(sourcePath, 'utf8');
  const sourceDir = path.dirname(path.resolve(sourcePath));

  // Extract title from frontmatter or first H1
  let title = path.basename(sourcePath, '.md');
  const fmMatch = markdown.match(/^---\r?\n[\s\S]*?title:\s*["']?([^"'\n]+)["']?\s*\r?\n[\s\S]*?\r?\n---/);
  if (fmMatch) {
    title = fmMatch[1].trim();
  } else {
    const h1Match = markdown.match(/^# (.+)$/m);
    if (h1Match) title = h1Match[1].trim();
  }

  // Preprocess
  if (sharedPreprocessor) {
    markdown = sharedPreprocessor.preprocessMarkdown(markdown, {
      format: 'html',
      stripFrontmatter,
      replaceEmDashes: options.replaceEmDashes,
      stripDecorativeRules: options.stripDecorativeRules,
    });

    // [toc] marker auto-detection
    const tocResult = sharedPreprocessor.detectTocMarker(markdown);
    markdown = tocResult.content;
    if (tocResult.hasTocMarker && !generateToc) {
      generateToc = true;
      console.log('   \u{1f4d1} [toc] marker detected -- enabling Table of Contents');
    }
  } else if (stripFrontmatter) {
    markdown = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  }

  // Mermaid handling
  markdown = processMermaidBlocks(markdown, sourceDir, usePngMermaid);

  if (options.debug) {
    const debugPath = sourcePath.replace(/\.md$/, '_debug_combined.md');
    fs.writeFileSync(debugPath, markdown, 'utf8');
    console.log(`  \u{1F50D} Debug: saved preprocessed markdown to ${debugPath}`);
  }

  if (options.dryRun) {
    console.log('\u2705 Dry run complete -- preprocessing finished, no HTML generated.');
    return;
  }

  // Convert via pandoc
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-to-html-'));
  process.on('exit', () => { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ } });
  const tempMd = path.join(tempDir, 'source.md');
  const tempHtml = path.join(tempDir, 'output.html');

  try {
    fs.writeFileSync(tempMd, markdown, 'utf8');

    const pandocArgs = [tempMd, '-o', tempHtml, '--from', 'markdown', '--to', 'html5', '--standalone=false'];
    if (generateToc) pandocArgs.push('--toc', '--toc-depth=3');
    runTool('pandoc', pandocArgs, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });

    let htmlBody = fs.readFileSync(tempHtml, 'utf8');

    // Embed local images as base64
    if (embedImages) {
      htmlBody = embedLocalImages(htmlBody, sourceDir);
    }

    // Wrap in standalone HTML page
    const css = generateCss(style);
    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="generator" content="md-to-html.cjs v1.0.0">
  <title>${escapeHtml(title)}</title>
  <style>${css}</style>
</head>
<body>
${htmlBody}
</body>
</html>`;

    fs.writeFileSync(outputPath, fullHtml, 'utf8');

    const sizeKb = (fs.statSync(outputPath).size / 1024).toFixed(1);
    console.log(`\u2705 Generated: ${path.basename(outputPath)} (${sizeKb} KB, style: ${styleName})`);
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseCliArgs() {
  const args = process.argv.slice(2);
  const options = {};
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--style' && args[i + 1]) { options.style = args[++i]; }
    else if (arg === '--toc') { options.toc = true; }
    else if (arg === '--embed-images') { options.embedImages = true; }
    else if (arg === '--no-embed-images') { options.embedImages = false; }
    else if (arg === '--no-replace-em-dashes') { options.replaceEmDashes = false; }
    else if (arg === '--strip-decorative-rules') { options.stripDecorativeRules = true; }
    else if (arg === '--no-strip-decorative-rules') { options.stripDecorativeRules = false; }
    else if (arg === '--strip-frontmatter') { options.stripFrontmatter = true; }
    else if (arg === '--no-strip-frontmatter') { options.stripFrontmatter = false; }
    else if (arg === '--mermaid-png') { options.mermaidPng = true; }
    else if (arg === '--mermaid-fallback') { options.mermaidPng = false; }
    else if (arg === '--debug') { options.debug = true; }
    else if (arg === '--dry-run') { options.dryRun = true; }
    else if (!arg.startsWith('--')) { positional.push(arg); }
  }

  return { positional, options };
}

function main() {
  const { positional, options } = parseCliArgs();

  if (positional.length === 0) {
    console.log('Usage: node md-to-html.cjs SOURCE.md [OUTPUT.html] [options]');
    console.log('');
    console.log('Options:');
    console.log('  --style PRESET        Style: professional, academic, minimal, dark');
    console.log('  --toc                 Generate table of contents');
    console.log('  --embed-images        Embed images as base64 (default)');
    console.log('  --no-embed-images     Keep image refs as-is');
    console.log('  --strip-frontmatter   Remove YAML frontmatter (default)');
    console.log('  --mermaid-png         Render Mermaid as PNG (needs mmdc)');
    console.log('  --mermaid-fallback    Convert Mermaid to table (default)');
    console.log('  --debug               Save preprocessed markdown');
    console.log('  --dry-run             Preprocessing only');
    process.exit(1);
  }

  const sourcePath = path.resolve(positional[0]);
  if (!fs.existsSync(sourcePath)) {
    console.error(`ERROR: File not found: ${sourcePath}`);
    process.exit(1);
  }

  const outputPath = positional[1]
    ? path.resolve(positional[1])
    : sourcePath.replace(/\.md$/, '.html');

  convertMarkdownToHtml(sourcePath, outputPath, options);
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { convertMarkdownToHtml, STYLE_PRESETS, generateCss };
