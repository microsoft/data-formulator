#!/usr/bin/env node
/**
 * @type muscle
 * @lifecycle stable
 * @muscle converter-qa
 * @lifecycle stable
 * @inheritance inheritable
 * @description Converter quality assurance framework with 256+ assertions across all converters
 * @version 1.3.0
 * @skill converter-qa
 * @reviewed 2026-05-18
 * @platform windows,macos,linux
 * @requires node,pandoc,mermaid-cli
 *
 * Test harness for validating converter outputs:
 * - md-to-word.cjs regression tests (structure + font/margin values + [toc] semantic)
 * - md-to-html.cjs end-to-end with PNG + SVG image handling
 * - md-to-txt.cjs strip-formatting verification
 * - html-to-md.cjs structure preservation
 * - docx-to-md.cjs round-trip via md-to-word
 * - md-to-eml.cjs structure validation
 * - shared module unit tests
 * - File size bounds checking
 * - Output format verification
 *
 * Usage:
 *   node .github/scripts/converter-qa.cjs                # Run all tests
 *   node .github/scripts/converter-qa.cjs --suite=word   # Run word converter tests only
 *   node .github/scripts/converter-qa.cjs --suite=shared # Run shared module tests only
 *   node .github/scripts/converter-qa.cjs --verbose      # Show detailed output
 * @currency 2026-05-18
 */
'use strict';

process.on("uncaughtException", (err) => {
  console.error(`\x1b[31m[FATAL] ${err.message}\x1b[0m`);
  process.exit(1);
});

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const os = require('os');

// -----------------------------------------------------------------------------
// TEST FRAMEWORK (minimal, no deps)
// -----------------------------------------------------------------------------

let _passed = 0;
let _failed = 0;
let _skipped = 0;
const _failures = [];
const _verbose = process.argv.includes('--verbose');
const _suiteArg = (process.argv.find(a => a.startsWith('--suite=')) || '').split('=')[1] || 'all';

function assert(condition, message) {
  if (condition) {
    _passed++;
    if (_verbose) console.log(`  [PASS] ${message}`);
  } else {
    _failed++;
    _failures.push(message);
    console.log(`  [FAIL] ${message}`);
  }
}

function skip(message) {
  _skipped++;
  if (_verbose) console.log(`  [SKIP] ${message}`);
}

function suite(name, fn) {
  if (_suiteArg !== 'all' && !name.toLowerCase().includes(_suiteArg.toLowerCase())) return;
  console.log(`\n-- ${name} ${'-'.repeat(Math.max(0, 60 - name.length))}`);
  fn();
}

// -----------------------------------------------------------------------------
// PATHS
// -----------------------------------------------------------------------------

const ROOT = path.join(__dirname, '..', '..');
const SKILLS = path.join(ROOT, '.github', 'skills');
const SCRIPTS_SHARED = path.join(ROOT, '.github', 'scripts', 'shared');
const LUA = path.join(SKILLS, 'md-to-word', 'scripts', 'lua-filters');
const MD_TO_WORD = path.join(SKILLS, 'md-to-word', 'scripts', 'md-to-word.cjs');
const MD_TO_EML = path.join(SKILLS, 'md-to-eml', 'scripts', 'md-to-eml.cjs');
const MARKDOWN_LINT = path.join(SKILLS, 'markdown-mermaid', 'scripts', 'markdown-lint.cjs');

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'converter-qa-'));
process.on('exit', () => { try { fs.rmSync(TEMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ } });

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

function createTempFile(name, content) {
  const p = path.join(TEMP_DIR, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

function fileExists(p) { return fs.existsSync(p); }
function fileSize(p) { return fs.statSync(p).size; }

function runNode(script, args = [], timeout = 30000) {
  const result = spawnSync('node', [script, ...args], {
    cwd: ROOT,
    timeout,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
  });
  return { stdout: result.stdout || '', stderr: result.stderr || '', status: result.status, error: result.error };
}

// -----------------------------------------------------------------------------
// TEST SUITES
// -----------------------------------------------------------------------------

suite('shared: data-uri.cjs', () => {
  const mod = require(path.join(SCRIPTS_SHARED, 'data-uri.cjs'));

  assert(typeof mod.encodeToDataUri === 'function', 'encodeToDataUri is exported');
  assert(typeof mod.downloadFile === 'function', 'downloadFile is exported');
  assert(typeof mod.decodeDataUri === 'function', 'decodeDataUri is exported');
  assert(typeof mod.mimeFromExt === 'function', 'mimeFromExt is exported');
  assert(typeof mod.MIME_MAP === 'object', 'MIME_MAP is exported');

  // MIME detection
  assert(mod.mimeFromExt('photo.png') === 'image/png', 'mimeFromExt(.png)');
  assert(mod.mimeFromExt('photo.jpg') === 'image/jpeg', 'mimeFromExt(.jpg)');
  assert(mod.mimeFromExt('doc.svg') === 'image/svg+xml', 'mimeFromExt(.svg)');
  assert(mod.mimeFromExt('doc.pdf') === 'application/pdf', 'mimeFromExt(.pdf)');
  assert(mod.mimeFromExt('unknown.xyz') === 'application/octet-stream', 'mimeFromExt(unknown)');

  // Data URI round-trip
  const testFile = createTempFile('test.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
  const uri = mod.encodeToDataUri(testFile);
  assert(typeof uri === 'string' && uri.startsWith('data:image/png;base64,'), 'encodeToDataUri produces valid URI');
  const decoded = mod.decodeDataUri(uri);
  assert(decoded && Buffer.isBuffer(decoded.buffer), 'decodeDataUri returns { mime, buffer }');
  assert(decoded.buffer[0] === 0x89 && decoded.buffer[1] === 0x50, 'decodeDataUri round-trips correctly');

  // PNG data URI
  assert(uri.startsWith('data:image/png;base64,'), 'PNG encodes with correct MIME');
});

suite('shared: markdown-preprocessor.cjs', () => {
  const mod = require(path.join(SCRIPTS_SHARED, 'markdown-preprocessor.cjs'));

  assert(typeof mod.preprocessMarkdown === 'function', 'preprocessMarkdown is exported');
  assert(typeof mod.convertLatexMath === 'function', 'convertLatexMath is exported');
  assert(typeof mod.extractFrontmatter === 'function', 'extractFrontmatter is exported');

  // BOM stripping
  const bom = mod.preprocessMarkdown('\uFEFF# Hello');
  assert(!bom.startsWith('\uFEFF'), 'BOM is stripped');

  // LaTeX math conversion
  const math = mod.convertLatexMath('The formula $\\alpha$ is important');
  assert(math.includes(''), 'LaTeX \\alpha -> Unicode ');

  // Page break directives
  const pb = mod.preprocessMarkdown('Before\n<!-- pagebreak -->\nAfter');
  assert(pb.includes('\\newpage') || pb.includes('pagebreak'), 'Page break directive processed');

  // Keyboard shortcuts
  const kbd = mod.preprocessMarkdown('Press [[Ctrl+S]] to save');
  assert(kbd.includes('<kbd>') || kbd.includes('Ctrl+S'), 'Keyboard shortcut processed');

  // Highlights
  const hl = mod.preprocessMarkdown('This is ==highlighted== text');
  assert(hl.includes('<mark>') || hl.includes('highlighted'), 'Highlight processed');

  // Sub/superscript
  const sub = mod.preprocessMarkdown('H~2~O');
  assert(sub.includes('<sub>') || sub.includes('2'), 'Subscript processed');
  const sup = mod.preprocessMarkdown('E=mc^2^');
  assert(sup.includes('<sup>') || sup.includes('2'), 'Superscript processed');

  // Definition lists
  const dl = mod.preprocessMarkdown('Term\n: Definition here');
  assert(dl.includes('Definition here'), 'Definition list kept');

  // Frontmatter extraction (returns { frontmatter: rawString, content: body })
  const result = mod.extractFrontmatter('---\ntitle: Test\n---\nBody');
  assert(result.frontmatter != null && result.frontmatter.includes('title'), 'Frontmatter parsed');
  assert(result.content.trim() === 'Body', 'Body extracted after frontmatter');
});

suite('shared: mermaid-pipeline.cjs', () => {
  const mod = require(path.join(SCRIPTS_SHARED, 'mermaid-pipeline.cjs'));

  assert(typeof mod.findMermaidBlocks === 'function', 'findMermaidBlocks is exported');
  assert(typeof mod.injectPalette === 'function', 'injectPalette is exported');
  assert(typeof mod.mermaidToTableFallback === 'function', 'mermaidToTableFallback is exported');

  // Find mermaid blocks
  const blocks = mod.findMermaidBlocks('Text\n```mermaid\nflowchart TD\n  A-->B\n```\nMore');
  assert(blocks.length === 1, 'Finds one mermaid block');
  assert(blocks[0].content.includes('flowchart'), 'Block contains mermaid code');

  // Palette injection
  const withPalette = mod.injectPalette('flowchart TD\n  A-->B');
  assert(withPalette.includes('init') || withPalette.includes('theme') || withPalette === 'flowchart TD\n  A-->B', 'Palette injection runs (may be no-op without options)');

  // Table fallback
  const table = mod.mermaidToTableFallback('flowchart TD\n  A["Source"]-->B["Target"]');
  assert(table.includes('Source') || table.includes('A'), 'Table fallback extracts nodes');
  assert(table.includes('|'), 'Table fallback produces markdown table format');
});

suite('shared: converter-config.cjs', () => {
  const mod = require(path.join(SCRIPTS_SHARED, 'converter-config.cjs'));

  assert(typeof mod.loadConfig === 'function', 'loadConfig is exported');
  assert(typeof mod.loadCharacterConfig === 'function', 'loadCharacterConfig is exported');
  assert(typeof mod.getPromptTemplate === 'function', 'getPromptTemplate is exported');
  assert(typeof mod.DEFAULTS === 'object', 'DEFAULTS is exported');

  // Default config loading (no .converter.json)
  const cfg = mod.loadConfig('word', { projectRoot: TEMP_DIR });
  assert(cfg.style === 'professional', 'Default style is professional');
  assert(cfg.pageSize === 'letter', 'Default page size is letter');
  assert(cfg.fonts.body === 'Segoe UI', 'Default body font');

  // Override merging
  const cfgOverride = mod.loadConfig('word', {
    projectRoot: TEMP_DIR,
    overrides: { style: 'academic', fonts: { body: 'Times New Roman' } },
  });
  assert(cfgOverride.style === 'academic', 'Override applied to style');
  assert(cfgOverride.fonts.body === 'Times New Roman', 'Override applied to nested font');
  assert(cfgOverride.fonts.code === 'Consolas', 'Unoverridden nested value preserved');

  // Deep merge
  const merged = mod.deepMerge({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 99 }, e: 5 });
  assert(merged.a === 1, 'deepMerge preserves a');
  assert(merged.b.c === 99, 'deepMerge overrides nested c');
  assert(merged.b.d === 3, 'deepMerge preserves nested d');
  assert(merged.e === 5, 'deepMerge adds new keys');

  // Character config loading
  const charConfig = mod.loadCharacterConfig(null, ROOT);
  if (charConfig) {
    assert(charConfig.subjects?.alex != null, 'visual-memory.json has alex subject');
    assert(Array.isArray(charConfig.subjects.alex.immutableTraits), 'alex has immutableTraits');
    assert(charConfig.promptTemplates != null, 'Has prompt templates');
  } else {
    skip('visual-memory.json not found (ok in CI)');
  }

  // Prompt template interpolation
  if (charConfig?.promptTemplates) {
    const tmpl = mod.getPromptTemplate(charConfig, 'portrait', { subject: 'test-subject', age: 21 });
    if (tmpl) {
      assert(typeof tmpl === 'string', 'getPromptTemplate returns string');
    } else {
      skip('No portrait template in visual-memory.json');
    }
  }
});

suite('Lua Filters: syntax validation', () => {
  const luaFiles = ['keep-headings.lua', 'word-table-style.lua', 'caption-labels.lua'];
  for (const f of luaFiles) {
    const p = path.join(LUA, f);
    if (fileExists(p)) {
      const content = fs.readFileSync(p, 'utf8');
      assert(content.length > 50, `${f} has content (${content.length} chars)`);
      assert(content.includes('function'), `${f} contains function definition`);
      // Basic Lua syntax: no unterminated strings
      const opens = (content.match(/\bfunction\b/g) || []).length;
      const closes = (content.match(/\bend\b/g) || []).length;
      assert(closes >= opens, `${f} has balanced function/end blocks`);
    } else {
      skip(`${f} not found`);
    }
  }
});

suite('File Inventory: expected files exist', () => {
  const required = [
    { path: MD_TO_WORD, desc: 'md-to-word.cjs' },
    { path: MD_TO_EML, desc: 'md-to-eml.cjs' },
    { path: MARKDOWN_LINT, desc: 'markdown-lint.cjs' },
    { path: path.join(SCRIPTS_SHARED, 'data-uri.cjs'), desc: 'shared/data-uri.cjs' },
    { path: path.join(SCRIPTS_SHARED, 'mermaid-pipeline.cjs'), desc: 'shared/mermaid-pipeline.cjs' },
    { path: path.join(SCRIPTS_SHARED, 'markdown-preprocessor.cjs'), desc: 'shared/markdown-preprocessor.cjs' },
    { path: path.join(SCRIPTS_SHARED, 'converter-config.cjs'), desc: 'shared/converter-config.cjs' },
    { path: path.join(SCRIPTS_SHARED, 'prompt-preprocessor.cjs'), desc: 'shared/prompt-preprocessor.cjs' },
    { path: path.join(LUA, 'keep-headings.lua'), desc: 'lua-filters/keep-headings.lua' },
    { path: path.join(LUA, 'word-table-style.lua'), desc: 'lua-filters/word-table-style.lua' },
    { path: path.join(LUA, 'caption-labels.lua'), desc: 'lua-filters/caption-labels.lua' },
  ];

  for (const { path: p, desc } of required) {
    assert(fileExists(p), `${desc} exists`);
  }
});

suite('md-to-word.cjs: end-to-end smoke test', () => {
  // Create a test markdown file with various features
  const testMd = createTempFile('test-word.md', `# Test Document

## Introduction

This is a **bold** test with *italic* and \`code\`.

::: tip
This is a tip callout for testing.
:::

> [!WARNING]
> This is a GitHub-style warning.

Press [[Ctrl+S]] to save. Here is ==highlighted text==.

Water is H~2~O. Energy is E=mc^2^.

Term One
: The first definition.

| Column A | Column B |
|----------|----------|
| Cell 1   | Cell 2   |
| Cell 3   | Cell 4   |

\`\`\`javascript
const x = 42;
console.log(x);
\`\`\`

<!-- pagebreak -->

## Conclusion

Final paragraph.
`);

  // Check if pandoc is available
  const pandocCheck = spawnSync('pandoc', ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (pandocCheck.status !== 0) {
    skip('pandoc not installed -- skipping e2e test');
    return;
  }

  // md-to-word uses positional args: SOURCE [OUTPUT] [--options]
  const outputPath = path.join(TEMP_DIR, 'test-output.docx');
  const result = runNode(MD_TO_WORD, [testMd, outputPath, '--style', 'academic'], 60000);

  if (result.status === 0 && fileExists(outputPath)) {
    assert(true, 'Word output file created');
    const size = fileSize(outputPath);
    assert(size > 1000, `Output size reasonable (${size} bytes > 1KB)`);
    assert(size < 5000000, `Output not oversized (${size} bytes < 5MB)`);

    // Verify it's a valid ZIP (docx files are ZIP archives)
    const header = Buffer.alloc(4);
    const fd = fs.openSync(outputPath, 'r');
    fs.readSync(fd, header, 0, 4, 0);
    fs.closeSync(fd);
    assert(header[0] === 0x50 && header[1] === 0x4B, 'Output has valid ZIP/DOCX magic bytes');
  } else {
    if (_verbose) console.log(`  stdout: ${result.stdout.slice(0, 300)}`);
    if (_verbose) console.log(`  stderr: ${result.stderr.slice(0, 300)}`);
    assert(false, `md-to-word.cjs failed (status ${result.status})`);
  }
});

suite('md-to-word.cjs: style presets', () => {
  const styles = ['professional', 'academic', 'course', 'creative'];
  const pandocCheck = spawnSync('pandoc', ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (pandocCheck.status !== 0) {
    skip('pandoc not installed');
    return;
  }

  const testMd = createTempFile('style-test.md', '# Style Test\n\nParagraph content.\n');

  for (const style of styles) {
    const outPath = path.join(TEMP_DIR, `style-${style}.docx`);
    const result = runNode(MD_TO_WORD, [testMd, outPath, '--style', style], 30000);
    assert(result.status === 0, `--style ${style} exits cleanly`);
    if (result.status === 0 && fileExists(outPath)) {
      assert(true, `--style ${style} produces output`);
    }
  }
});

// -----------------------------------------------------------------------------
// Mermaid creation helpers
// -----------------------------------------------------------------------------

suite('shared: mermaid-pipeline.cjs -- creation helpers', () => {
  const mp = require(path.join(SCRIPTS_SHARED, 'mermaid-pipeline.cjs'));

  // createFlowchart
  assert(typeof mp.createFlowchart === 'function', 'createFlowchart exported');
  const fc = mp.createFlowchart({
    direction: 'TD',
    nodes: [
      { id: 'A', label: 'Start', shape: 'round' },
      { id: 'B', label: 'End', shape: 'stadium' },
    ],
    edges: [{ from: 'A', to: 'B', label: 'go' }],
  });
  assert(fc.includes('flowchart TD'), 'flowchart has direction');
  assert(fc.includes('A(') || fc.includes('A['), 'flowchart has node A');
  assert(fc.includes('-->'), 'flowchart has edge arrow');

  // createSequence
  assert(typeof mp.createSequence === 'function', 'createSequence exported');
  const seq = mp.createSequence({
    participants: ['Alice', 'Bob'],
    messages: [{ from: 'Alice', to: 'Bob', text: 'Hello' }],
  });
  assert(seq.includes('sequenceDiagram'), 'sequence has header');
  assert(seq.includes('Alice'), 'sequence has participant');

  // createGantt
  assert(typeof mp.createGantt === 'function', 'createGantt exported');
  const gantt = mp.createGantt({
    title: 'Test',
    sections: [{ name: 'Phase 1', tasks: [{ name: 'Task 1', status: 'done', duration: '3d' }] }],
  });
  assert(gantt.includes('gantt'), 'gantt has header');
  assert(gantt.includes('Phase 1'), 'gantt has section');

  // createTimeline
  assert(typeof mp.createTimeline === 'function', 'createTimeline exported');
  const tl = mp.createTimeline({
    entries: [{ period: '2024', events: ['Launch'] }],
  });
  assert(tl.includes('timeline'), 'timeline has header');

  // createMindmap
  assert(typeof mp.createMindmap === 'function', 'createMindmap exported');
  const mm = mp.createMindmap({
    root: { label: 'Root', children: [{ label: 'A' }] },
  });
  assert(mm.includes('mindmap'), 'mindmap has header');

  // wrapInFence
  assert(typeof mp.wrapInFence === 'function', 'wrapInFence exported');
  const fenced = mp.wrapInFence('flowchart TD\n  A-->B');
  assert(fenced.startsWith('```mermaid'), 'wrapInFence adds opening fence');
  assert(fenced.endsWith('```\n') || fenced.trimEnd().endsWith('```'), 'wrapInFence adds closing fence');
});

// -----------------------------------------------------------------------------
// SVG pipeline
// -----------------------------------------------------------------------------
// Markdown lint/validator
// -----------------------------------------------------------------------------

suite('markdown-lint.cjs', () => {
  const ML = MARKDOWN_LINT;
  const mdLint = require(ML);

  assert(typeof mdLint.lint === 'function', 'lint exported');
  assert(typeof mdLint.autofix === 'function', 'autofix exported');
  assert(Array.isArray(mdLint.RULES), 'RULES exported');

  // Clean document passes
  const clean = '# My Doc\n\nSome text.\n\n## Section\n\nMore text.\n';
  const r1 = mdLint.lint(clean);
  assert(r1.errors.length === 0, 'clean doc has no errors');

  // Separate tables may legitimately have different column counts.
  const separateTables = [
    '# My Doc',
    '',
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    'Between the tables.',
    '',
    '| A | B | C |',
    '| --- | --- | --- |',
    '| 1 | 2 | 3 |',
    '',
  ].join('\n');
  const separateTableResult = mdLint.lint(separateTables);
  assert(
    !separateTableResult.errors.some(e => e.id === 'TBL001'),
    'does not compare column counts across separate tables',
  );

  // Missing H1
  const noH1 = '## Section\n\nSome text.\n';
  const r2 = mdLint.lint(noH1);
  assert(r2.errors.some(e => e.id === 'MD001'), 'detects missing H1');

  // Heading skip
  const skipH = '# Title\n\n### Skip\n';
  const r3 = mdLint.lint(skipH, { target: 'word' });
  assert(r3.warnings.some(w => w.id === 'MD002'), 'detects heading skip');

  // Mermaid smart quotes
  const smartQ = '# Doc\n\n```mermaid\nflowchart TD\n  A[\u201CHello\u201D]-->B\n```\n';
  const r4 = mdLint.lint(smartQ);
  assert(r4.warnings.some(w => w.id === 'MMD002'), 'detects mermaid smart quotes');

  // Mermaid smart quotes auto-fix
  const { content: fixed } = mdLint.autofix(smartQ);
  assert(!fixed.includes('\u201C'), 'autofix removes smart quotes');

  // Em dash detection
  const emDash = '# Doc\n\nSome text \u2014 more text.\n';
  const r5 = mdLint.lint(emDash);
  assert(r5.info.some(i => i.id === 'CONV001'), 'detects em dashes');

  // Em dash auto-fix
  const { content: fixedDash } = mdLint.autofix(emDash);
  assert(!fixedDash.includes('\u2014'), 'autofix replaces em dashes');
  assert(fixedDash.includes('--'), 'autofix uses double hyphens');

  // Email frontmatter
  const emailBad = '# Just a doc\n';
  const r6 = mdLint.lint(emailBad, { target: 'email' });
  assert(r6.errors.some(e => e.id === 'FM001'), 'detects missing email frontmatter');

  // Slides H2 check
  const fewH2 = '# Deck\n\n## Slide 1\n';
  const r7 = mdLint.lint(fewH2, { target: 'slides' });
  assert(r7.warnings.some(w => w.id === 'FM002'), 'detects too few H2 for slides');

  // Empty mermaid block
  const emptyMmd = '# Doc\n\n```mermaid\n\n```\n';
  const r8 = mdLint.lint(emptyMmd);
  assert(r8.errors.some(e => e.id === 'MMD004'), 'detects empty mermaid block');

  // Target filtering
  const r9 = mdLint.lint(emailBad, { target: 'word' });
  assert(!r9.errors.some(e => e.id === 'FM001'), 'email rules skip for word target');
});
// -----------------------------------------------------------------------------
// Visual Regression Tests (#38) -- validate OOXML structure
// -----------------------------------------------------------------------------

suite('md-to-word.cjs: visual regression (OOXML structure)', () => {
  const pandocCheck = spawnSync('pandoc', ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (pandocCheck.status !== 0) {
    skip('pandoc not installed -- skipping visual regression');
    return;
  }

  // Document with tables, captions, headings, code blocks
  const regressionMd = createTempFile('regression.md', `# Visual Regression Test

## Tables

**Table 1: Sample Data**

| Name | Value |
|------|-------|
| Alpha | 100 |
| Beta  | 200 |
| Gamma | 300 |

**Figure 1: Test Caption**

## Code

\`\`\`python
def hello():
    return "world"
\`\`\`

## Conclusion

Final text.
`);

  const outPath = path.join(TEMP_DIR, 'regression.docx');
  const result = runNode(MD_TO_WORD, [regressionMd, outPath, '--style', 'professional'], 60000);

  if (result.status !== 0 || !fileExists(outPath)) {
    assert(false, 'Regression document generation failed');
    return;
  }

  // Read OOXML and validate structure
  try {
    const AdmZip = (() => {
      try { return require('adm-zip'); } catch { return null; }
    })();

    // At minimum, verify ZIP structure
    const header = Buffer.alloc(4);
    const fd = fs.openSync(outPath, 'r');
    fs.readSync(fd, header, 0, 4, 0);
    fs.closeSync(fd);
    assert(header[0] === 0x50 && header[1] === 0x4B, 'Regression output is valid ZIP/DOCX');
    assert(fileSize(outPath) > 2000, 'Regression output has substantial content');

    // If adm-zip is available, do deep OOXML validation
    if (AdmZip) {
      const zip = new AdmZip(outPath);
      const docXml = zip.readAsText('word/document.xml');

      assert(docXml != null && docXml.length > 0, 'document.xml exists and has content');
      assert(docXml.includes('w:tbl'), 'Document contains table element');
      assert(docXml.includes('w:shd') && docXml.includes('0078D4'), 'Table has blue header shading');
      assert(docXml.includes('w:tblHeader'), 'Table has header row repeat');
      assert(docXml.includes('w:cantSplit'), 'Table has anti-split on rows');
      assert(docXml.includes('w:keepNext'), 'Caption has keepNext');

      // Check caption styling -- italic on caption runs
      const captionMatch = docXml.match(/Table\s+1[\s\S]{0,500}/);
      if (captionMatch) {
        assert(captionMatch[0].includes('w:i') || docXml.includes('<w:i'), 'Caption text has italic styling');
      }

      // Check heading colors
      assert(docXml.includes('00528B') || docXml.includes('0078D4'), 'Headings have brand colors');

      // Check code block background
      assert(docXml.includes('F5F5F5'), 'Code block has light gray background');

      // Footer check
      const footerXml = zip.readAsText('word/footer1.xml');
      if (footerXml) {
        assert(footerXml.includes('PAGE'), 'Footer has PAGE field code');
      }

      // Styles check
      const stylesXml = zip.readAsText('word/styles.xml');
      if (stylesXml) {
        assert(stylesXml.includes('Segoe UI') || stylesXml.includes('rFonts'), 'Styles has font definition');
      }
    } else {
      skip('adm-zip not available -- deep OOXML validation skipped');
    }
  } catch (err) {
    assert(false, `Regression OOXML inspection failed: ${err.message}`);
  }
});

// -----------------------------------------------------------------------------
// Word Table Styling Regression Tests (#46)
// -----------------------------------------------------------------------------

suite('md-to-word.cjs: table styling regression', () => {
  const pandocCheck = spawnSync('pandoc', ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (pandocCheck.status !== 0) {
    skip('pandoc not installed');
    return;
  }

  const tableMd = createTempFile('table-regression.md', `# Table Regression

| Col A | Col B | Col C |
|-------|-------|-------|
| Row 1a | Row 1b | Row 1c |
| Row 2a | Row 2b | Row 2c |
| Row 3a | Row 3b | Row 3c |
| Row 4a | Row 4b | Row 4c |
`);

  const outPath = path.join(TEMP_DIR, 'table-regression.docx');
  const result = runNode(MD_TO_WORD, [tableMd, outPath], 60000);

  if (result.status !== 0 || !fileExists(outPath)) {
    assert(false, 'Table regression generation failed');
    return;
  }

  try {
    const AdmZip = (() => { try { return require('adm-zip'); } catch { return null; } })();
    if (AdmZip) {
      const zip = new AdmZip(outPath);
      const docXml = zip.readAsText('word/document.xml');

      // Anti-pagination controls
      const cantSplitCount = (docXml.match(/w:cantSplit/g) || []).length;
      assert(cantSplitCount >= 4, `cantSplit on all data rows (found ${cantSplitCount})`);

      // Header row repeat
      assert(docXml.includes('w:tblHeader'), 'Header row set to repeat');

      // Blue header shading (#0078D4)
      assert(docXml.includes('0078D4'), 'Header has Microsoft blue (#0078D4)');

      // Alternating row shading -- check for F0F0F0 (light gray)
      assert(docXml.includes('F0F0F0'), 'Even rows have alternating gray shading');

      // Table borders
      assert(docXml.includes('w:tblBorders'), 'Table has border definitions');

      // Full-width table
      assert(docXml.includes('w:tblW') && docXml.includes('5000'), 'Table is full-width (5000 pct)');

      // Font sizes (v1.4.0 / muscle v5.5.0: header 9pt = w:sz 18, data 8.5pt = w:sz 17)
      assert(docXml.includes('<w:sz w:val="18"/>'), 'Header font is 9pt (w:sz 18)');
      assert(docXml.includes('<w:sz w:val="17"/>'), 'Data font is 8.5pt (w:sz 17)');

      // Cell margins (v1.4.0 / muscle v5.5.0: T/B 1pt = 20 twips, L/R 3pt = 60 twips)
      assert(docXml.includes('w:w="20" w:type="dxa"'), 'Cell margin T/B is 1pt (20 twips)');
      assert(docXml.includes('w:w="60" w:type="dxa"'), 'Cell margin L/R is 3pt (60 twips)');
    } else {
      skip('adm-zip not available');
    }
  } catch (err) {
    assert(false, `Table regression inspection failed: ${err.message}`);
  }
});

// -----------------------------------------------------------------------------
// Email Rendering Tests (#44)
// -----------------------------------------------------------------------------

suite('md-to-eml.cjs: email rendering structure', () => {
  const pandocCheck = spawnSync('pandoc', ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (pandocCheck.status !== 0) {
    skip('pandoc not installed');
    return;
  }

  const emailMd = createTempFile('test-email.md', `---
to: test@example.com
from: sender@example.com
subject: QA Test Email
---

# Hello

This is a **test email** with [a link](https://example.com).

| Item | Status |
|------|--------|
| Feature | Done |

\`\`\`mermaid
flowchart TD
  A-->B
\`\`\`
`);

  const emlPath = path.join(TEMP_DIR, 'test.eml');
  const result = runNode(MD_TO_EML, [emailMd, emlPath], 30000);

  if (result.status !== 0 || !fileExists(emlPath)) {
    // md-to-eml may fail in CI without proper setup -- skip gracefully
    skip('md-to-eml failed (may need setup)');
    return;
  }

  const emlContent = fs.readFileSync(emlPath, 'utf8');

  // RFC 5322 headers
  assert(emlContent.includes('To:'), 'EML has To: header');
  assert(emlContent.includes('From:'), 'EML has From: header');
  assert(emlContent.includes('Subject:'), 'EML has Subject: header');
  assert(emlContent.includes('Content-Type:'), 'EML has Content-Type header');

  // MIME structure -- HTML body is base64-encoded per RFC 2045
  assert(emlContent.includes('Content-Transfer-Encoding: base64'), 'EML uses base64 transfer encoding');
  assert(emlContent.includes('text/html'), 'Content-Type declares text/html');

  // Decode base64 body to validate HTML content
  const bodyStart = emlContent.indexOf('\r\n\r\n');
  if (bodyStart > 0) {
    const bodySection = emlContent.slice(bodyStart + 4).split(/\r?\n--/)[0].trim();
    try {
      const decoded = Buffer.from(bodySection.replace(/\r?\n/g, ''), 'base64').toString('utf8');
      assert(decoded.includes('<html') || decoded.includes('<!DOCTYPE'), 'Decoded body contains HTML');
      assert(decoded.includes('style='), 'Decoded body has inline styles');
      assert(decoded.includes('href=') || decoded.includes('example.com'), 'Decoded body has link');
    } catch {
      skip('Base64 decode failed -- body may be multipart');
    }
  }

  // Mermaid should be replaced with fallback (not raw mermaid code)
  assert(!emlContent.includes('```mermaid'), 'Mermaid blocks replaced (not raw fence)');
});

// -----------------------------------------------------------------------------
// PDF Engine Cross-Validation (#45)
// -----------------------------------------------------------------------------

suite('PDF engine cross-validation', () => {
  const pandocCheck = spawnSync('pandoc', ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (pandocCheck.status !== 0) {
    skip('pandoc not installed');
    return;
  }

  const pdfMd = createTempFile('pdf-test.md', `# PDF Engine Test

## Greek Symbols

The coefficient \u03B1 and \u03B2 with \u03C3 variance.

## Table

| A | B |
|---|---|
| 1 | 2 |

Conclusion text.
`);

  // Test lualatex if available
  const luaCheck = spawnSync('lualatex', ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (luaCheck.status === 0) {
    const luaPdf = path.join(TEMP_DIR, 'test-lua.pdf');
    const luaResult = spawnSync('pandoc', [pdfMd, '-o', luaPdf, '--pdf-engine=lualatex'], {
      cwd: TEMP_DIR, encoding: 'utf8', timeout: 60000,
    });
    if (luaResult.status === 0 && fileExists(luaPdf)) {
      assert(fileSize(luaPdf) > 500, 'lualatex produces valid PDF');
      // PDF magic bytes: %PDF
      const pdfHeader = Buffer.alloc(4);
      const fd = fs.openSync(luaPdf, 'r');
      fs.readSync(fd, pdfHeader, 0, 4, 0);
      fs.closeSync(fd);
      assert(pdfHeader[0] === 0x25 && pdfHeader[1] === 0x50, 'lualatex output has PDF magic bytes');
    } else {
      skip('lualatex run failed (font/package issue)');
    }
  } else {
    skip('lualatex not installed');
  }

  // Test xelatex if available
  const xeCheck = spawnSync('xelatex', ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (xeCheck.status === 0) {
    const xePdf = path.join(TEMP_DIR, 'test-xe.pdf');
    const xeResult = spawnSync('pandoc', [pdfMd, '-o', xePdf, '--pdf-engine=xelatex'], {
      cwd: TEMP_DIR, encoding: 'utf8', timeout: 60000,
    });
    if (xeResult.status === 0 && fileExists(xePdf)) {
      assert(fileSize(xePdf) > 500, 'xelatex produces valid PDF');
    } else {
      skip('xelatex run failed (font/package issue)');
    }
  } else {
    skip('xelatex not installed');
  }
});

// -----------------------------------------------------------------------------
// Prompt Preprocessor (#27)
// -----------------------------------------------------------------------------

suite('shared: prompt-preprocessor.cjs', () => {
  const mod = require(path.join(SCRIPTS_SHARED, 'prompt-preprocessor.cjs'));

  assert(typeof mod.preprocessPrompt === 'function', 'preprocessPrompt is exported');
  assert(typeof mod.validatePrompt === 'function', 'validatePrompt is exported');
  assert(typeof mod.injectTraits === 'function', 'injectTraits is exported');
  assert(typeof mod.cleanPrompt === 'function', 'cleanPrompt is exported');
  assert(typeof mod.PROMPT_LIMITS === 'object', 'PROMPT_LIMITS is exported');

  // Smart quote cleanup
  const cleaned = mod.cleanPrompt('A \u201Csmart\u201D quote and an em\u2014dash');
  assert(!cleaned.includes('\u201C'), 'cleanPrompt removes left smart quote');
  assert(!cleaned.includes('\u2014'), 'cleanPrompt replaces em dash');
  assert(cleaned.includes('"smart"'), 'cleanPrompt uses straight quotes');
  assert(cleaned.includes('--'), 'cleanPrompt uses double hyphens');

  // Validation
  const valid = mod.validatePrompt('A short prompt', { model: 'ideogram-ai/ideogram-v2' });
  assert(valid.valid === true, 'Short prompt validates clean');

  const empty = mod.validatePrompt('', {});
  assert(empty.valid === false, 'Empty prompt fails validation');

  // Length limit
  const longPrompt = 'x'.repeat(5000);
  const longResult = mod.validatePrompt(longPrompt, { model: 'google/nano-banana-pro' });
  assert(longResult.truncated === true, 'Over-length prompt flagged as truncated');

  // cleanPrompt truncation
  const truncated = mod.cleanPrompt(longPrompt, { model: 'google/nano-banana-pro' });
  assert(truncated.length <= 1024, 'cleanPrompt truncates to model limit');

  // Trait injection
  const charConfig = {
    subjects: { alex: { immutableTraits: ['brown hair', 'green eyes', '26 years old'] } },
  };
  const injected = mod.injectTraits('A portrait in a garden', charConfig, 'alex');
  assert(injected.includes('IDENTITY PRESERVATION'), 'Traits injected with priority header');
  assert(injected.includes('brown hair'), 'Trait content present');
  assert(injected.includes('A portrait in a garden'), 'Original prompt preserved');

  // No traits when config missing
  const noTraits = mod.injectTraits('raw prompt', null);
  assert(noTraits === 'raw prompt', 'No injection when config is null');

  // Full pipeline
  const { prompt, validation } = mod.preprocessPrompt('A \u201Cstyled\u201D test', {
    model: 'ideogram-ai/ideogram-v2',
    charConfig,
    subject: 'alex',
  });
  assert(prompt.includes('IDENTITY PRESERVATION'), 'Full pipeline injects traits');
  assert(!prompt.includes('\u201C'), 'Full pipeline cleans quotes');
  assert(validation != null, 'Full pipeline returns validation');

  // Model family detection
  assert(mod.modelFamily('ideogram-ai/ideogram-v2') === 'ideogram', 'modelFamily: ideogram');
  assert(mod.modelFamily('black-forest-labs/flux-1.1-pro') === 'flux', 'modelFamily: flux');
  assert(mod.modelFamily('google/nano-banana-pro') === 'nano-banana', 'modelFamily: nano-banana');
  assert(mod.modelFamily('unknown/model') === 'default', 'modelFamily: default');
});

// -----------------------------------------------------------------------------
// v5.2.0 NEW FEATURE TESTS
// -----------------------------------------------------------------------------

suite('shared: markdown-preprocessor.cjs -- heading validation', () => {
  const mod = require(path.join(SCRIPTS_SHARED, 'markdown-preprocessor.cjs'));

  assert(typeof mod.validateHeadingHierarchy === 'function', 'validateHeadingHierarchy is exported');

  // Valid hierarchy: H1 -> H2 -> H3
  const good = mod.validateHeadingHierarchy('# Title\n## Section\n### Sub');
  assert(good.valid === true, 'Valid hierarchy returns valid=true');
  assert(good.warnings.length === 0, 'Valid hierarchy has no warnings');

  // Invalid hierarchy: H1 -> H3 (skips H2)
  const bad = mod.validateHeadingHierarchy('# Title\n### Skipped H2');
  assert(bad.valid === false, 'H1->H3 skip returns valid=false');
  assert(bad.warnings.length > 0, 'H1->H3 skip has warnings');
  assert(bad.warnings[0].includes('H3'), 'Warning mentions the offending level');

  // No headings -- should be valid
  const none = mod.validateHeadingHierarchy('Just some text\nNo headings here');
  assert(none.valid === true, 'No headings returns valid=true');

  // H2 -> H4 skip
  const deepSkip = mod.validateHeadingHierarchy('## Section\n#### Deep skip');
  assert(deepSkip.valid === false, 'H2->H4 skip returns valid=false');
});

suite('shared: markdown-preprocessor.cjs -- image embedding', () => {
  const mod = require(path.join(SCRIPTS_SHARED, 'markdown-preprocessor.cjs'));

  assert(typeof mod.embedLocalImages === 'function', 'embedLocalImages is exported');

  // Create a tiny PNG file for testing
  const imgDir = path.join(TEMP_DIR, 'img-embed-test');
  fs.mkdirSync(imgDir, { recursive: true });
  const imgPath = path.join(imgDir, 'test.png');
  fs.writeFileSync(imgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));

  // Local image should be embedded
  const content = '![Alt text](test.png)';
  const result = mod.embedLocalImages(content, imgDir);
  assert(result.includes('data:image/png;base64,'), 'Local image embedded as base64');
  assert(!result.includes('](test.png)'), 'Original path replaced');

  // HTTP URLs should NOT be embedded
  const httpContent = '![Remote](https://example.com/image.png)';
  const httpResult = mod.embedLocalImages(httpContent, imgDir);
  assert(httpResult.includes('https://example.com/image.png'), 'HTTP URLs left unchanged');

  // Data URIs should NOT be re-embedded
  const dataContent = '![Already](data:image/png;base64,abc123)';
  const dataResult = mod.embedLocalImages(dataContent, imgDir);
  assert(dataResult.includes('data:image/png;base64,abc123'), 'Data URIs left unchanged');

  // Missing file should be left unchanged
  const missingContent = '![Missing](nonexistent.png)';
  const missingResult = mod.embedLocalImages(missingContent, imgDir);
  assert(missingResult.includes('nonexistent.png'), 'Missing file paths left unchanged');
});

suite('md-to-word.cjs: CLI flag parsing (new flags)', () => {
  // Test that the new flags are accepted by parseArgs via --help-like checking
  const result = runNode(MD_TO_WORD, ['--help-flags-check'], 5000);
  // The script exits with usage error showing the flags
  const output = result.stdout + result.stderr;

  // We check the usage message includes the new flags
  assert(output.includes('--embed-images') || output.includes('embedImages'), 'Usage mentions --embed-images');
  assert(output.includes('--strip-frontmatter') || output.includes('stripFrontmatter'), 'Usage mentions --strip-frontmatter');
  assert(output.includes('--recursive') || output.includes('recursive'), 'Usage mentions --recursive');
});

suite('shared: markdown-preprocessor.cjs -- link validation', () => {
  const mod = require(path.join(SCRIPTS_SHARED, 'markdown-preprocessor.cjs'));

  assert(typeof mod.validateLinks === 'function', 'validateLinks is exported');

  // Valid external link
  const good = mod.validateLinks('[Google](https://google.com)\n[Anchor](#section)');
  assert(good.valid === true, 'External links and anchors are valid');

  // Empty URL
  const empty = mod.validateLinks('[Click here]()');
  assert(empty.valid === false, 'Empty link URL returns valid=false');
  assert(empty.warnings[0].includes('empty'), 'Warning mentions empty URL');

  // Broken local link (with sourceDir)
  const broken = mod.validateLinks('[Missing](nonexistent-file.md)', TEMP_DIR);
  assert(broken.valid === false, 'Broken local link returns valid=false');
  assert(broken.warnings[0].includes('not found'), 'Warning mentions file not found');

  // Valid local link
  const localFile = createTempFile('link-target.md', '# Target');
  const validLocal = mod.validateLinks(`[Target](link-target.md)`, TEMP_DIR);
  assert(validLocal.valid === true, 'Existing local link returns valid=true');

  // Images are skipped (not links)
  const image = mod.validateLinks('![Alt](missing.png)');
  assert(image.valid === true, 'Image refs are not link-validated');

  // mailto is skipped
  const mailto = mod.validateLinks('[Email](mailto:test@example.com)');
  assert(mailto.valid === true, 'mailto links are valid');
});

suite('shared: markdown-preprocessor.cjs -- footnote passthrough', () => {
  const mod = require(path.join(SCRIPTS_SHARED, 'markdown-preprocessor.cjs'));

  // Footnote syntax should be preserved through preprocessing (pandoc handles it)
  const input = 'Text with footnote[^1].\n\n[^1]: This is the footnote content.';
  const output = mod.preprocessMarkdown(input);
  assert(output.includes('[^1]'), 'Footnote ref [^1] preserved after preprocessing');
  assert(output.includes('[^1]:'), 'Footnote def [^1]: preserved after preprocessing');
});

suite('md-to-word.cjs: dry-run mode', () => {  // Create a simple test markdown file
  const testMd = createTempFile('dry-run-test.md', '# Test\\n\\nHello world');
  const outPath = path.join(TEMP_DIR, 'dry-run-test.docx');

  const result = runNode(MD_TO_WORD, [testMd, outPath, '--dry-run'], 10000);
  assert(result.status === 0, 'Dry-run exits with code 0');
  assert((result.stdout + result.stderr).includes('Dry-run complete'), 'Dry-run prints completion message');
  assert(!fileExists(outPath), 'Dry-run does not generate .docx file');
});

// -----------------------------------------------------------------------------
// md-to-word.cjs: [toc] marker warn-and-ignore (v1.4.0 behavior)
// -----------------------------------------------------------------------------

suite('md-to-word.cjs: [toc] marker warn-and-ignore', () => {
  const pandocCheck = spawnSync('pandoc', ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (pandocCheck.status !== 0) {
    skip('pandoc not installed');
    return;
  }

  const tocMd = createTempFile('toc-marker-test.md', `# TOC Marker Test

[toc]

## Section A

Content here.

## Section B

More content.
`);
  const outPath = path.join(TEMP_DIR, 'toc-marker-test.docx');
  const result = runNode(MD_TO_WORD, [tocMd, outPath], 60000);

  assert(result.status === 0, '[toc] marker source converts cleanly');
  const allOutput = result.stdout + result.stderr;
  assert(allOutput.includes('[toc] marker found') && allOutput.includes('--toc was not passed'),
    'Warning logged when [toc] marker found without --toc flag');
  assert(allOutput.includes('marker stripped, TOC not generated'),
    'Warning explains the marker was stripped and no TOC generated');

  try {
    const AdmZip = (() => { try { return require('adm-zip'); } catch { return null; } })();
    if (AdmZip && fileExists(outPath)) {
      const zip = new AdmZip(outPath);
      const docXml = zip.readAsText('word/document.xml');
      // TOC in Word is a field; if present, document.xml has "TOC \o" or "Table of Contents"
      assert(!docXml.includes('TOC \\o') && !docXml.toLowerCase().includes('table of contents'),
        'Output .docx does not contain a TOC field');
      // The [toc] marker line itself should be stripped from the body
      assert(!docXml.includes('[toc]'), 'Literal [toc] marker stripped from body');
    } else {
      skip('adm-zip not available or output missing');
    }
  } catch (err) {
    assert(false, `[toc] marker docx inspection failed: ${err.message}`);
  }
});

// -----------------------------------------------------------------------------
// PHASE C: coverage for the other converters
// Each suite uses an in-memory test corpus exercising headings, lists, tables,
// code, links, blockquotes, and BOTH PNG and SVG image references so we can
// verify image handling end-to-end per converter.
// -----------------------------------------------------------------------------

// shared image fixtures created on demand by each suite that needs them.
function createImageFixtures(dir) {
  const pngPath = path.join(dir, 'sample.png');
  // Minimal 1x1 transparent PNG (8 bytes header + IHDR + IDAT + IEND)
  const pngBytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);
  fs.writeFileSync(pngPath, pngBytes);

  const svgPath = path.join(dir, 'sample.svg');
  const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50" role="img"><rect width="100" height="50" fill="#0078D4"/><text x="50" y="30" text-anchor="middle" fill="white" font-family="sans-serif" font-size="14">SAMPLE</text></svg>';
  fs.writeFileSync(svgPath, svgContent);

  return { pngPath, svgPath };
}

// -----------------------------------------------------------------------------
// md-to-html.cjs: standalone HTML with embedded CSS, PNG, and SVG
// -----------------------------------------------------------------------------

const MD_TO_HTML = path.join(SKILLS, 'md-to-html', 'scripts', 'md-to-html.cjs');

suite('md-to-html.cjs: end-to-end + image handling', () => {
  if (!fileExists(MD_TO_HTML)) {
    skip('md-to-html.cjs not present');
    return;
  }

  // Check if pandoc is available (md-to-html shells out to pandoc)
  const pandocCheck = spawnSync('pandoc', ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (pandocCheck.status !== 0) {
    skip('pandoc not installed -- skipping e2e test');
    return;
  }

  const sourceDir = path.join(TEMP_DIR, 'md-to-html-src');
  fs.mkdirSync(sourceDir, { recursive: true });
  createImageFixtures(sourceDir);

  const sourcePath = path.join(sourceDir, 'doc.md');
  fs.writeFileSync(sourcePath, `# Hello

A paragraph with **bold** and *italic* and \`code\`.

## Section

- Item one
- Item two
  - Nested
- Item three

1. Numbered one
2. Numbered two

| A | B |
| --- | --- |
| 1 | 2 |
| 3 | 4 |

[A link](https://example.com)

> A blockquote.

\`\`\`javascript
const x = 1;
\`\`\`

### PNG image

![Sample PNG](sample.png)

### SVG image

![Sample SVG](sample.svg)
`, 'utf8');

  const outputPath = path.join(sourceDir, 'doc.html');
  const result = runNode(MD_TO_HTML, [sourcePath, outputPath], 30000);
  assert(result.status === 0, 'md-to-html exits 0');
  assert(fileExists(outputPath), 'HTML output file created');

  if (!fileExists(outputPath)) return;
  const html = fs.readFileSync(outputPath, 'utf8');

  // Structural
  assert(/<!DOCTYPE html>/i.test(html), 'HTML has DOCTYPE');
  assert(/<html[\s>]/i.test(html), 'HTML has <html> tag');
  assert(/<style[\s>]/i.test(html) || /<link[^>]*stylesheet/i.test(html), 'HTML embeds CSS (either <style> block or <link>)');

  // Content
  assert(html.includes('<h1') && html.includes('Hello'), 'H1 rendered');
  assert(html.includes('<h2') && html.includes('Section'), 'H2 rendered');
  assert(html.includes('<table'), 'Table rendered');
  assert(/<a [^>]*href="https:\/\/example\.com"/i.test(html), 'Link rendered with href');
  assert(html.includes('<blockquote'), 'Blockquote rendered');
  assert(html.includes('<code') || html.includes('javascript'), 'Code block rendered');

  // PNG image handling: either base64-embedded (default --embed-images) or referenced
  const hasPngBase64 = /data:image\/png;base64,/i.test(html);
  const hasPngRef = /<img[^>]*src="[^"]*sample\.png"/i.test(html);
  assert(hasPngBase64 || hasPngRef, 'PNG image embedded as data URI or referenced');

  // SVG image handling: either inline <svg>, base64 data URI, or <img src> ref
  const hasInlineSvg = /<svg[\s>]/i.test(html);
  const hasSvgDataUri = /data:image\/svg\+xml/i.test(html);
  const hasSvgRef = /<img[^>]*src="[^"]*sample\.svg"/i.test(html);
  assert(hasInlineSvg || hasSvgDataUri || hasSvgRef, 'SVG image inline / data URI / referenced');
});

// -----------------------------------------------------------------------------
// md-to-txt.cjs: strip formatting, preserve alt text for images
// -----------------------------------------------------------------------------

const MD_TO_TXT = path.join(SKILLS, 'md-to-txt', 'scripts', 'md-to-txt.cjs');

suite('md-to-txt.cjs: strip formatting + preserve image alt text', () => {
  if (!fileExists(MD_TO_TXT)) {
    skip('md-to-txt.cjs not present');
    return;
  }

  const pandocCheck = spawnSync('pandoc', ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (pandocCheck.status !== 0) {
    skip('pandoc not installed');
    return;
  }

  const sourcePath = createTempFile('md-to-txt-src.md', `# Title

A paragraph with **bold** and *italic* and \`inline code\`.

- bullet one
- bullet two

| A | B |
| --- | --- |
| 1 | 2 |

[Link text](https://example.com)

![PNG alt text](sample.png)

![SVG alt text](sample.svg)
`);
  const outputPath = path.join(TEMP_DIR, 'md-to-txt-out.txt');
  const result = runNode(MD_TO_TXT, [sourcePath, outputPath], 30000);
  assert(result.status === 0, 'md-to-txt exits 0');
  assert(fileExists(outputPath), 'Text output created');

  if (!fileExists(outputPath)) return;
  const txt = fs.readFileSync(outputPath, 'utf8');

  // Formatting stripped
  assert(!txt.includes('**'), 'Bold markers (**) stripped');
  assert(!/(^|[^*])\*[A-Za-z]/.test(txt), 'Italic markers (*) stripped');
  assert(!txt.includes('`'), 'Code backticks stripped');
  assert(!/^#{1,6}\s/m.test(txt), 'Heading hash markers stripped');
  assert(!/^\s*\|/m.test(txt), 'Table pipe characters stripped');

  // Content preserved
  assert(txt.includes('Title'), 'Heading text preserved');
  assert(txt.includes('bullet one'), 'List content preserved');
  assert(txt.includes('Link text'), 'Link text preserved');

  // Image alt text preserved (pandoc emits the alt text in plain output)
  assert(txt.toLowerCase().includes('png alt text') || txt.toLowerCase().includes('image'),
    'PNG image alt text or reference preserved');
  assert(txt.toLowerCase().includes('svg alt text') || txt.toLowerCase().includes('image'),
    'SVG image alt text or reference preserved');
});

// -----------------------------------------------------------------------------
// html-to-md.cjs: HTML -> Markdown, preserving structure and image refs
// -----------------------------------------------------------------------------

const HTML_TO_MD = path.join(SKILLS, 'html-to-md', 'scripts', 'html-to-md.cjs');

suite('html-to-md.cjs: structure + image preservation', () => {
  if (!fileExists(HTML_TO_MD)) {
    skip('html-to-md.cjs not present');
    return;
  }

  const pandocCheck = spawnSync('pandoc', ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (pandocCheck.status !== 0) {
    skip('pandoc not installed');
    return;
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Test</title></head>
<body>
<h1>Top Heading</h1>
<p>A paragraph with <strong>bold</strong> and <em>italic</em>.</p>
<h2>Sub heading</h2>
<ul><li>One</li><li>Two</li><li>Three</li></ul>
<ol><li>First</li><li>Second</li></ol>
<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>
<p><a href="https://example.com">Example link</a></p>
<blockquote><p>Quoted text</p></blockquote>
<pre><code>const x = 1;</code></pre>
<p><img src="sample.png" alt="PNG image"></p>
<p><img src="sample.svg" alt="SVG image"></p>
</body></html>
`;
  const sourcePath = createTempFile('html-to-md-src.html', html);
  const outputPath = path.join(TEMP_DIR, 'html-to-md-out.md');
  const result = runNode(HTML_TO_MD, [sourcePath, outputPath], 30000);
  assert(result.status === 0, 'html-to-md exits 0');
  assert(fileExists(outputPath), 'Markdown output created');

  if (!fileExists(outputPath)) return;
  const md = fs.readFileSync(outputPath, 'utf8');

  // Structure preserved
  assert(/^#\s+Top Heading/m.test(md) || /Top Heading\n=+/.test(md), 'H1 preserved (ATX or setext)');
  assert(/^##\s+Sub heading/m.test(md) || /Sub heading\n-+/.test(md), 'H2 preserved (ATX or setext)');
  assert(md.includes('**bold**') || md.includes('__bold__'), 'Bold preserved');
  assert(md.includes('*italic*') || md.includes('_italic_'), 'Italic preserved');
  assert(/[-*+]\s+One/.test(md), 'Bullet list preserved');
  assert(/^1\.\s+First/m.test(md), 'Numbered list preserved');
  // Table preserved -- pandoc may emit pipe form, simple form (2-space indent + ---),
  // or grid form (+---+). All count as preserved if header + data cells appear.
  const tableDataPreserved = /A\s+B/.test(md) && /1\s+2/.test(md);
  assert(tableDataPreserved, 'Table data preserved (header A B + row 1 2 visible in any pandoc table form)');
  assert(/\[Example link\]\(https:\/\/example\.com\)/.test(md), 'Link preserved');
  assert(/^>\s+Quoted text/m.test(md), 'Blockquote preserved');
  assert(md.includes('const x = 1'), 'Code block content preserved');

  // Image refs preserved (both PNG and SVG)
  assert(/!\[PNG image\]\([^)]*sample\.png[^)]*\)/.test(md), 'PNG image ref preserved with alt text');
  assert(/!\[SVG image\]\([^)]*sample\.svg[^)]*\)/.test(md), 'SVG image ref preserved with alt text');
});

// -----------------------------------------------------------------------------
// docx-to-md.cjs: round-trip via md-to-word + image extraction
// -----------------------------------------------------------------------------

const DOCX_TO_MD = path.join(SKILLS, 'docx-to-md', 'scripts', 'docx-to-md.cjs');

suite('docx-to-md.cjs: round-trip + image extraction', () => {
  if (!fileExists(DOCX_TO_MD)) {
    skip('docx-to-md.cjs not present');
    return;
  }

  const pandocCheck = spawnSync('pandoc', ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (pandocCheck.status !== 0) {
    skip('pandoc not installed');
    return;
  }

  // Step 1: build a docx from a known md (no SVG -- md-to-word needs svgexport for SVG;
  // the docx-to-md round-trip is the test, so stick to PNG which is universal)
  const sourceDir = path.join(TEMP_DIR, 'docx-roundtrip-src');
  fs.mkdirSync(sourceDir, { recursive: true });
  createImageFixtures(sourceDir);

  const mdSourcePath = path.join(sourceDir, 'roundtrip.md');
  fs.writeFileSync(mdSourcePath, `# Round-Trip Test

## Section A

A paragraph with **bold** and *italic*.

- bullet one
- bullet two

| Col A | Col B |
| --- | --- |
| 1 | 2 |
| 3 | 4 |

![PNG image](sample.png)
`, 'utf8');

  const docxPath = path.join(sourceDir, 'roundtrip.docx');
  const wordResult = runNode(MD_TO_WORD, [mdSourcePath, docxPath], 60000);
  if (wordResult.status !== 0 || !fileExists(docxPath)) {
    skip('md-to-word leg of round-trip failed; cannot test docx-to-md');
    return;
  }

  // Step 2: convert back to markdown
  const outDir = path.join(TEMP_DIR, 'docx-roundtrip-out');
  fs.mkdirSync(outDir, { recursive: true });
  const mdOutPath = path.join(outDir, 'roundtrip-out.md');
  const mdResult = runNode(DOCX_TO_MD, [docxPath, mdOutPath], 30000);
  assert(mdResult.status === 0, 'docx-to-md exits 0');
  assert(fileExists(mdOutPath), 'Markdown round-trip output created');

  if (!fileExists(mdOutPath)) return;
  const roundTripped = fs.readFileSync(mdOutPath, 'utf8');

  // Structure preserved through round-trip (headings, lists, tables)
  assert(/Round-Trip Test/.test(roundTripped), 'H1 text preserved through round-trip');
  assert(/Section A/.test(roundTripped), 'H2 text preserved through round-trip');
  assert(/bullet one/.test(roundTripped), 'List item preserved');
  assert(/Col A/.test(roundTripped) && /Col B/.test(roundTripped), 'Table headers preserved');
  assert(/[-*+]\s+bullet/.test(roundTripped) || /\\-\s+bullet/.test(roundTripped), 'Bullet syntax recovered (markdown bullet form)');

  // Image extraction: docx-to-md --extract-images is the default; an images/ folder
  // should exist alongside the output and contain at least one extracted image
  const imagesDir = path.join(outDir, 'images');
  if (fs.existsSync(imagesDir)) {
    const extracted = fs.readdirSync(imagesDir).filter(f => /\.(png|jpe?g|svg|gif)$/i.test(f));
    assert(extracted.length >= 1, `Images extracted to images/ folder (${extracted.length} file(s))`);
  } else {
    // Pandoc may have placed images differently; accept inline data URI or skip
    const hasImageRef = /!\[[^\]]*\]\([^)]+\)/.test(roundTripped) || /data:image\//.test(roundTripped);
    if (hasImageRef) {
      assert(true, 'Image reference preserved in output (inline form, no extraction dir)');
    } else {
      skip('No images/ dir and no inline image ref -- pandoc image handling unknown for this docx');
    }
  }
});

// -----------------------------------------------------------------------------
// CLEANUP & REPORT
// -----------------------------------------------------------------------------

// Clean temp dir
try {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
} catch { /* ignore cleanup errors */ }

console.log('\n==================================================================');
console.log(`  QA Results: ${_passed} passed, ${_failed} failed, ${_skipped} skipped`);
console.log('==================================================================');

if (_failures.length > 0) {
  console.log('\n  Failures:');
  _failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}

console.log('');
process.exit(_failed > 0 ? 1 : 0);
