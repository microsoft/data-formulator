#!/usr/bin/env node
/**
 * @type muscle
 * @lifecycle stable
 * @muscle markdown-lint
 * @lifecycle stable
 * @inheritance inheritable
 * @description Pre-conversion markdown validator for converters
 * @version 1.0.0
 * @skill lint-clean-markdown
 * @reviewed 2026-04-15
 * @platform windows,macos,linux
 * @requires node
 *
 * Catches issues that cause conversion failures or degraded output BEFORE
 * running converters. Validates markdown, Mermaid, SVG, and frontmatter
 * against converter requirements.
 *
 * Usage:
 *   node markdown-lint.cjs FILE.md                    # Validate one file
 *   node markdown-lint.cjs *.md                       # Validate multiple files
 *   node markdown-lint.cjs FILE.md --target word      # Validate for Word conversion
 *   node markdown-lint.cjs FILE.md --target email     # Validate for email conversion
 *   node markdown-lint.cjs FILE.md --fix              # Auto-fix what we can
 *   node markdown-lint.cjs FILE.md --json             # JSON output
 * @currency 2026-04-20
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { findMermaidBlocks: _sharedFindMermaid } = require(path.join(__dirname, '..', '..', '..', 'scripts', 'shared', 'mermaid-pipeline.cjs'));
// Note: glob patterns handled manually via fs + path

// -----------------------------------------------------------------------------
// RULES
// -----------------------------------------------------------------------------

const RULES = [
  // Structure
  {
    id: 'MD001',
    name: 'has-h1',
    severity: 'error',
    targets: ['word', 'email', 'pdf', 'slides'],
    check: (content) => {
      if (!/^# /m.test(content)) return 'Document has no H1 heading';
    },
  },
  {
    id: 'MD002',
    name: 'heading-hierarchy',
    severity: 'warning',
    targets: ['word', 'pdf'],
    check: (content) => {
      const headings = content.match(/^#{1,6} /gm) || [];
      let prev = 0;
      for (const h of headings) {
        const level = h.trim().split(' ')[0].length;
        if (level > prev + 1 && prev > 0) {
          return `Skipped heading level: H${prev} -> H${level} (may look broken in Word TOC)`;
        }
        prev = level;
      }
    },
  },
  {
    id: 'MD003',
    name: 'bom-present',
    severity: 'warning',
    targets: ['word', 'email', 'pdf'],
    check: (content) => {
      if (content.charCodeAt(0) === 0xFEFF) return 'File has UTF-8 BOM -- may cause pandoc issues';
    },
    fix: (content) => content.replace(/^\uFEFF/, ''),
  },

  // Tables
  {
    id: 'TBL001',
    name: 'table-alignment',
    severity: 'error',
    targets: ['word', 'email', 'pdf'],
    check: (content) => {
      const tablePattern = /^\|[^\n]+\|$/gm;
      const tables = content.match(tablePattern) || [];
      for (let i = 0; i < tables.length - 1; i++) {
        const cols1 = tables[i].split('|').length;
        const cols2 = tables[i + 1].split('|').length;
        if (cols1 !== cols2 && !tables[i + 1].match(/^[\s|:-]+$/)) {
          return `Table column count mismatch (${cols1} vs ${cols2}) -- will break in Word`;
        }
      }
    },
  },
  {
    id: 'TBL002',
    name: 'table-separator',
    severity: 'error',
    targets: ['word', 'email', 'pdf'],
    check: (content) => {
      // Find table headers (lines with |) not followed by separator line
      const lines = content.split('\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (lines[i].match(/^\|.+\|$/) && lines[i + 1].match(/^\|.+\|$/)) {
          if (!lines[i + 1].match(/^[\s|:-]+$/)) {
            // Could be data rows, check if the next row after that is a separator
            if (i > 0 && !lines[i - 1].match(/^[\s|:-]+$/) && !lines[i - 1].match(/^\|/)) {
              return `Table at line ${i + 1} may be missing header separator row (|---|)`;
            }
          }
        }
      }
    },
  },

  // Mermaid
  {
    id: 'MMD001',
    name: 'mermaid-type',
    severity: 'error',
    targets: ['word', 'email', 'pdf'],
    check: (content) => {
      const blocks = _findMermaidBlocks(content);
      for (const block of blocks) {
        const firstLine = block.trim().split('\n')[0].trim();
        const validTypes = ['flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
          'erDiagram', 'journey', 'gantt', 'pie', 'quadrantChart', 'requirementDiagram',
          'gitgraph', 'mindmap', 'timeline', 'sankey-beta', 'xychart-beta', 'block-beta',
          'packet-beta', 'kanban', 'architecture-beta', 'graph'];
        const type = firstLine.split(/[\s{(]/)[0];
        if (!validTypes.includes(type)) {
          return `Mermaid block starts with "${type}" -- not a recognized diagram type`;
        }
      }
    },
  },
  {
    id: 'MMD002',
    name: 'mermaid-quotes',
    severity: 'warning',
    targets: ['word', 'email', 'pdf'],
    check: (content) => {
      const blocks = _findMermaidBlocks(content);
      for (const block of blocks) {
        if (block.includes('\u201C') || block.includes('\u201D') || block.includes('\u2018') || block.includes('\u2019')) {
          return 'Mermaid block contains smart quotes (\u201C\u201D) -- use straight quotes ("") instead';
        }
      }
    },
    fix: (content) => {
      return content.replace(/(```mermaid\r?\n)([\s\S]*?)(```)/g, (m, open, code, close) => {
        const fixed = code.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
        return open + fixed + close;
      });
    },
  },
  {
    id: 'MMD003',
    name: 'mermaid-br-tags',
    severity: 'info',
    targets: ['word', 'email'],
    check: (content) => {
      const blocks = _findMermaidBlocks(content);
      for (const block of blocks) {
        if (block.includes('\\n') && !block.includes('<br')) {
          return 'Mermaid block uses \\n for line breaks -- use <br/> instead (\\n is unreliable)';
        }
      }
    },
  },
  {
    id: 'MMD004',
    name: 'mermaid-empty-block',
    severity: 'error',
    targets: ['word', 'email', 'pdf'],
    check: (content) => {
      const blocks = _findMermaidBlocks(content);
      for (const block of blocks) {
        if (block.trim().length === 0) return 'Empty Mermaid code block -- will cause rendering error';
      }
    },
  },

  // Images
  {
    id: 'IMG001',
    name: 'image-exists',
    severity: 'warning',
    targets: ['word', 'email', 'pdf'],
    check: (content, filePath) => {
      if (!filePath) return;
      const dir = path.dirname(filePath);
      const imgPattern = /!\[[^\]]*\]\(([^)]+)\)/g;
      let match;
      while ((match = imgPattern.exec(content)) !== null) {
        const src = match[1].split(/[?#]/)[0]; // strip query/hash
        if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) continue;
        const imgPath = path.resolve(dir, src);
        if (!fs.existsSync(imgPath)) {
          return `Image not found: ${src} -- will be missing in output`;
        }
      }
    },
  },
  {
    id: 'IMG002',
    name: 'image-alt-text',
    severity: 'info',
    targets: ['word', 'email', 'pdf'],
    check: (content) => {
      const emptyAlts = content.match(/!\[\]\(/g) || [];
      if (emptyAlts.length > 0) {
        return `${emptyAlts.length} image(s) without alt text -- bad for accessibility and Word captions`;
      }
    },
  },

  // SVG inline
  {
    id: 'SVG001',
    name: 'svg-inline-xmlns',
    severity: 'error',
    targets: ['word', 'email'],
    check: (content) => {
      if (content.includes('<svg') && !content.includes('xmlns="http://www.w3.org/2000/svg"')) {
        return 'Inline SVG missing xmlns attribute -- will not render in Word or email';
      }
    },
  },
  {
    id: 'SVG002',
    name: 'svg-viewbox',
    severity: 'warning',
    targets: ['word', 'email', 'pdf'],
    check: (content) => {
      if (content.includes('<svg') && !content.includes('viewBox')) {
        return 'Inline SVG missing viewBox -- will not scale correctly';
      }
    },
  },

  // Extended syntax awareness
  {
    id: 'EXT001',
    name: 'latex-unconverted',
    severity: 'info',
    targets: ['word', 'email'],
    check: (content) => {
      // Check for LaTeX that won't convert well in Word/email
      if (/\$[^$\n]+\$/.test(content) && !content.includes('\\alpha')) {
        // Has $ delimiters but maybe not LaTeX
      }
      if (/\\(frac|sqrt|sum|int|prod)\{/.test(content)) {
        return 'Contains LaTeX math commands -- will be converted to Unicode approximations for Word/email';
      }
    },
  },
  {
    id: 'EXT002',
    name: 'callout-syntax',
    severity: 'warning',
    targets: ['word', 'pdf'],
    check: (content) => {
      // Check for malformed callouts
      const badCallout = content.match(/^:::\s*$/m);
      if (badCallout) return 'Empty callout block (::: without type) -- use ::: tip, ::: warning, ::: note';
    },
  },

  // Frontmatter
  {
    id: 'FM001',
    name: 'email-frontmatter',
    severity: 'error',
    targets: ['email'],
    check: (content) => {
      if (!content.startsWith('---')) return 'Email markdown needs YAML frontmatter with to/from/subject fields';
      const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fm) return 'Malformed YAML frontmatter';
      if (!fm[1].includes('to:')) return 'Email frontmatter missing "to:" field';
      if (!fm[1].includes('subject:')) return 'Email frontmatter missing "subject:" field';
    },
  },
  {
    id: 'FM002',
    name: 'slides-h2-breaks',
    severity: 'warning',
    targets: ['slides'],
    check: (content) => {
      const h2Count = (content.match(/^## /gm) || []).length;
      if (h2Count < 3) return `Only ${h2Count} H2 headings found -- Gamma uses H2 as slide breaks (need 3+ for a useful deck)`;
    },
  },

  // Em dash (project convention)
  {
    id: 'CONV001',
    name: 'em-dash',
    severity: 'info',
    targets: ['word', 'email', 'pdf', 'slides'],
    check: (content) => {
      const emDashes = content.match(/\u2014/g) || [];
      if (emDashes.length > 0) return `${emDashes.length} em dash(es) found -- project convention: use -- instead of \u2014`;
    },
    fix: (content) => content.replace(/\u2014/g, '--'),
  },
];

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

function _findMermaidBlocks(content) {
  return _sharedFindMermaid(content).map(b => b.content);
}

// -----------------------------------------------------------------------------
// LINTER ENGINE
// -----------------------------------------------------------------------------

/**
 * Lint a markdown string.
 *
 * @param {string} content - Markdown content
 * @param {object} [options]
 * @param {string} [options.target] - Target format: 'word', 'email', 'pdf', 'slides'
 * @param {string} [options.filePath] - File path (for image resolution)
 * @returns {{ errors: Array, warnings: Array, info: Array, summary: string }}
 */
function lint(content, options = {}) {
  const target = options.target || 'word';
  const results = { errors: [], warnings: [], info: [] };

  for (const rule of RULES) {
    if (!rule.targets.includes(target)) continue;
    try {
      const message = rule.check(content, options.filePath);
      if (message) {
        const item = { id: rule.id, name: rule.name, message, fixable: !!rule.fix };
        if (rule.severity === 'error') results.errors.push(item);
        else if (rule.severity === 'warning') results.warnings.push(item);
        else results.info.push(item);
      }
    } catch { /* rule threw -- skip */ }
  }

  const total = results.errors.length + results.warnings.length + results.info.length;
  results.summary = total === 0
    ? `\u2705 Clean -- ready for ${target} conversion`
    : `${results.errors.length} error(s), ${results.warnings.length} warning(s), ${results.info.length} info`;

  return results;
}

/**
 * Auto-fix what we can.
 *
 * @param {string} content - Markdown content
 * @param {object} [options]
 * @param {string} [options.target] - Target format
 * @returns {{ content: string, fixed: string[] }}
 */
function autofix(content, options = {}) {
  const target = options.target || 'word';
  const fixed = [];

  for (const rule of RULES) {
    if (!rule.fix) continue;
    if (!rule.targets.includes(target)) continue;
    try {
      const message = rule.check(content, options.filePath);
      if (message) {
        content = rule.fix(content);
        fixed.push(`${rule.id}: ${rule.name}`);
      }
    } catch { /* skip */ }
  }

  return { content, fixed };
}

module.exports = { lint, autofix, RULES };

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  const files = [];
  let target = 'word';
  let doFix = false;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' && i + 1 < args.length) target = args[++i];
    else if (args[i] === '--fix') doFix = true;
    else if (args[i] === '--json') jsonOutput = true;
    else if (!args[i].startsWith('--')) files.push(args[i]);
  }

  if (files.length === 0) {
    console.error('Usage: node markdown-lint.cjs FILE.md [--target word|email|pdf|slides] [--fix] [--json]');
    process.exit(1);
  }

  let totalErrors = 0;
  const allResults = [];

  for (const file of files) {
    const filePath = path.resolve(file);
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${file}`);
      continue;
    }

    let content = fs.readFileSync(filePath, 'utf8');

    if (doFix) {
      const { content: fixed, fixed: fixedRules } = autofix(content, { target, filePath });
      if (fixedRules.length > 0) {
        fs.writeFileSync(filePath, fixed, 'utf8');
        if (!jsonOutput) {
          console.log(`\u{1F527} Fixed ${fixedRules.length} issue(s) in ${file}: ${fixedRules.join(', ')}`);
        }
        content = fixed;
      }
    }

    const results = lint(content, { target, filePath });
    totalErrors += results.errors.length;

    if (jsonOutput) {
      allResults.push({ file, ...results });
    } else {
      console.log(`\n\u{1F4C4} ${file} (target: ${target})`);
      if (results.errors.length + results.warnings.length + results.info.length === 0) {
        console.log(`  ${results.summary}`);
      } else {
        for (const e of results.errors) console.log(`  \u274C ${e.id}: ${e.message}${e.fixable ? ' [fixable]' : ''}`);
        for (const w of results.warnings) console.log(`  \u26A0\uFE0F  ${w.id}: ${w.message}${w.fixable ? ' [fixable]' : ''}`);
        for (const i of results.info) console.log(`  \u{1F4A1} ${i.id}: ${i.message}${i.fixable ? ' [fixable]' : ''}`);
        console.log(`  ${results.summary}`);
      }
    }
  }

  if (jsonOutput) {
    console.log(JSON.stringify(allResults, null, 2));
  }

  process.exit(totalErrors > 0 ? 1 : 0);
}
