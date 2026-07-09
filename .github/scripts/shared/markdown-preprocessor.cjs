/**
 * shared/markdown-preprocessor.cjs - Unified markdown preprocessing pipeline
 *
 * Merges proven transforms from:
 * - md-to-word.cjs (BOM, checkboxes, list spacing, heading spacing)
 * - VT build-pdf.js (callouts, highlights, kbd, sub/sup, definitions)
 * - AlexBooks build-epub.js (page-break directives, landscape sections)
 * - AIRS preprocess_latex_tables.py (LaTeX math -> Unicode)
 *
 * Usage:
 *   const { preprocessMarkdown, convertLatexMath } = require('./shared/markdown-preprocessor.cjs');
 *   const processed = preprocessMarkdown(rawContent, { format: 'docx' });
 * @inheritance inheritable
 */

const LATEX_MATH_MAP = [
  [/\\alpha/g, '\u03B1'], [/\\beta/g, '\u03B2'], [/\\gamma/g, '\u03B3'],
  [/\\delta/g, '\u03B4'], [/\\epsilon/g, '\u03B5'], [/\\zeta/g, '\u03B6'],
  [/\\eta/g, '\u03B7'], [/\\theta/g, '\u03B8'], [/\\iota/g, '\u03B9'],
  [/\\kappa/g, '\u03BA'], [/\\lambda/g, '\u03BB'], [/\\mu/g, '\u03BC'],
  [/\\nu/g, '\u03BD'], [/\\xi/g, '\u03BE'], [/\\pi/g, '\u03C0'],
  [/\\rho/g, '\u03C1'], [/\\sigma/g, '\u03C3'], [/\\tau/g, '\u03C4'],
  [/\\phi/g, '\u03C6'], [/\\chi/g, '\u03C7'], [/\\psi/g, '\u03C8'],
  [/\\omega/g, '\u03C9'],
  [/\\Delta/g, '\u0394'], [/\\Sigma/g, '\u03A3'], [/\\Omega/g, '\u03A9'],
  [/\\times/g, '\u00D7'], [/\\div/g, '\u00F7'], [/\\pm/g, '\u00B1'],
  [/\\leq/g, '\u2264'], [/\\geq/g, '\u2265'], [/\\neq/g, '\u2260'],
  [/\\approx/g, '\u2248'], [/\\infty/g, '\u221E'], [/\\sum/g, '\u2211'],
  [/\\prod/g, '\u220F'], [/\\rightarrow/g, '\u2192'], [/\\leftarrow/g, '\u2190'],
  [/\\Rightarrow/g, '\u21D2'], [/\\Leftarrow/g, '\u21D0'],
  [/\\partial/g, '\u2202'], [/\\nabla/g, '\u2207'],
  [/\\sqrt\{([^}]+)\}/g, '\u221A($1)'],
];

const SUPERSCRIPT_MAP = {
  '0': '\u2070', '1': '\u00B9', '2': '\u00B2', '3': '\u00B3',
  '4': '\u2074', '5': '\u2075', '6': '\u2076', '7': '\u2077',
  '8': '\u2078', '9': '\u2079', 'n': '\u207F', 'i': '\u2071',
  '+': '\u207A', '-': '\u207B', '=': '\u207C',
};

/**
 * Convert inline LaTeX math to Unicode symbols.
 * Handles $..$ and common LaTeX commands outside math mode.
 */
function convertLatexMath(content) {
  // Convert $inline math$ (but not $$display math$$)
  content = content.replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, (_match, math) => {
    let result = math;
    for (const [pattern, replacement] of LATEX_MATH_MAP) {
      result = result.replace(pattern, replacement);
    }
    // Superscripts: ^{2} ->  or ^2 ->
    result = result.replace(/\^{([^}]+)}/g, (_m, exp) =>
      exp.split('').map(c => SUPERSCRIPT_MAP[c] || c).join('')
    );
    result = result.replace(/\^([0-9ni])/g, (_m, c) => SUPERSCRIPT_MAP[c] || c);
    // Strip \text{}, \mathrm{}, \mathit{}, \mathbf{} wrappers
    result = result.replace(/\\(?:text|mathrm|mathit|mathbf)\{([^}]*)\}/g, '$1');
    return result;
  });

  // Also convert common LaTeX symbols outside math mode
  for (const [pattern, replacement] of LATEX_MATH_MAP) {
    content = content.replace(pattern, replacement);
  }

  return content;
}

/**
 * Strip YAML frontmatter from markdown content.
 * Returns { frontmatter: string|null, content: string }
 */
function extractFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return { frontmatter: null, content };
  return {
    frontmatter: match[1],
    content: content.slice(match[0].length),
  };
}

/**
 * Apply a per-line transform to all lines OUTSIDE fenced code blocks.
 * Fence detection supports both backtick (```) and tilde (~~~) fences
 * with matching length and indentation tolerance.
 * @param {string} content
 * @param {(line: string) => string} transformer
 * @returns {string}
 */
function applyOutsideFences(content, transformer) {
  const lines = content.split('\n');
  let inFence = false;
  let fenceMarker = null;
  const out = [];
  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!inFence) { inFence = true; fenceMarker = marker[0].repeat(3); }
      else if (line.trim().startsWith(fenceMarker)) { inFence = false; fenceMarker = null; }
      out.push(line);
      continue;
    }
    if (inFence) { out.push(line); continue; }
    out.push(transformer(line));
  }
  return out.join('\n');
}

/**
 * Replace U+2014 (em-dash) with proper punctuation. Skips inline code spans
 * and fenced code blocks. Conservative: only touches the literal em-dash
 * character, not typed `--` (which pandoc smart-converts intentionally).
 *
 *   word\u2014word  -> word, word
 *   word \u2014 word -> word, word
 *
 * Defeats the AI-tell pattern of LLMs auto-inserting em-dashes.
 * @param {string} content
 * @returns {string}
 */
function replaceEmDashes(content) {
  return applyOutsideFences(content, (line) => {
    // Preserve inline code spans (single backticks).
    const parts = line.split(/(`[^`\n]*`)/g);
    return parts.map((p, idx) => {
      if (idx % 2 === 1) return p; // inside `code`
      // " \u2014 " or "\u2014" between letters -> ", "
      return p
        .replace(/\s*\u2014\s*/g, ', ')
        .replace(/,\s+,\s+/g, ', '); // collapse accidental ", , "
    }).join('');
  });
}

/**
 * Strip decorative thematic-break lines (`---`, `***`, `___` on their own line).
 * Preserves:
 *   - YAML frontmatter delimiters (only at top of file, handled by extractFrontmatter caller)
 *   - Setext H2 underlines (`---` immediately under a non-blank text line)
 *   - Fenced code-block content
 * @param {string} content
 * @returns {string}
 */
function stripDecorativeRules(content) {
  const lines = content.split('\n');
  let inFence = false;
  let fenceMarker = null;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!inFence) { inFence = true; fenceMarker = marker[0].repeat(3); }
      else if (line.trim().startsWith(fenceMarker)) { inFence = false; fenceMarker = null; }
      out.push(line);
      continue;
    }
    if (inFence) { out.push(line); continue; }

    const isHr = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
    if (!isHr) { out.push(line); continue; }

    // Setext H2 check: previous line is non-blank text and not itself a heading/HR/list/blockquote.
    const prev = i > 0 ? lines[i - 1] : '';
    const prevTrim = prev.trim();
    const prevIsTextLine =
      prevTrim.length > 0 &&
      !/^#{1,6}\s/.test(prevTrim) &&
      !/^(?:-{3,}|\*{3,}|_{3,})$/.test(prevTrim) &&
      !/^[-*+]\s/.test(prevTrim) &&
      !/^\d+\.\s/.test(prevTrim) &&
      !/^>/.test(prevTrim);
    // Only treat `---` as setext underline (not `***` or `___`).
    if (prevIsTextLine && /^\s*-{3,}\s*$/.test(line)) {
      out.push(line);
      continue;
    }
    // Decorative HR -- drop the line.
  }
  return out.join('\n');
}

/**
 * Detect a standalone `[toc]` marker (case-insensitive) on its own line,
 * outside fenced code blocks. If present, strip the marker line(s) and
 * return hasTocMarker=true so the caller can flip its TOC flag.
 *
 *   [toc]   -> stripped, returns true
 *   [TOC]   -> stripped, returns true
 *   `[toc]` -> preserved literally
 *   ```\n[toc]\n``` (in fence) -> preserved literally
 *
 * @param {string} content
 * @returns {{ content: string, hasTocMarker: boolean }}
 */
function detectTocMarker(content) {
  const lines = content.split('\n');
  let inFence = false;
  let fenceMarker = null;
  let hasTocMarker = false;
  const out = [];
  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!inFence) { inFence = true; fenceMarker = marker[0].repeat(3); }
      else if (line.trim().startsWith(fenceMarker)) { inFence = false; fenceMarker = null; }
      out.push(line);
      continue;
    }
    if (inFence) { out.push(line); continue; }
    if (/^\s*\[toc\]\s*$/i.test(line)) {
      hasTocMarker = true;
      continue; // strip the marker line
    }
    out.push(line);
  }
  return { content: out.join('\n'), hasTocMarker };
}

/**
 * Format-aware defaults for the new prose-cleanup transforms.
 */
const FORMAT_DEFAULTS = {
  docx: { replaceEmDashes: true, stripDecorativeRules: true },
  email: { replaceEmDashes: true, stripDecorativeRules: true },
  html: { replaceEmDashes: true, stripDecorativeRules: false },
  txt: { replaceEmDashes: true, stripDecorativeRules: false },
  pdf: { replaceEmDashes: false, stripDecorativeRules: false },
  epub: { replaceEmDashes: false, stripDecorativeRules: false },
};

/**
 * Full preprocessing pipeline. Options control which transforms run.
 *
 * @param {string} content - Raw markdown
 * @param {object} options - { format: 'docx'|'pdf'|'epub'|'email', stripFrontmatter: bool }
 * @returns {string} Preprocessed markdown
 */
function preprocessMarkdown(content, options = {}) {
  const format = options.format || 'docx';
  const fmtDefaults = FORMAT_DEFAULTS[format] || FORMAT_DEFAULTS.docx;

  // Strip UTF-8 BOM
  content = content.replace(/^\uFEFF/, '');

  // Optionally strip frontmatter
  if (options.stripFrontmatter) {
    const { content: body } = extractFrontmatter(content);
    content = body;
  }

  // Em-dash cleanup -- defeats the AI-tell pattern. Format-aware default,
  // explicit option overrides.
  const doEmDashes = options.replaceEmDashes !== undefined
    ? options.replaceEmDashes
    : fmtDefaults.replaceEmDashes;
  if (doEmDashes) {
    content = replaceEmDashes(content);
  }

  // Decorative thematic-break cleanup -- removes unnecessary `---` HRs that
  // clutter docx/email output. Setext H2 underlines and frontmatter are preserved.
  const doStripHrs = options.stripDecorativeRules !== undefined
    ? options.stripDecorativeRules
    : fmtDefaults.stripDecorativeRules;
  if (doStripHrs) {
    content = stripDecorativeRules(content);
  }

  content = transformOutsideCodeFences(content, transformProseSyntax);

  // Line-level transforms
  const lines = content.split('\n');
  const result = [];
  let prevWasList = false;
  let prevWasBlank = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const stripped = line.trim();
    const isList = /^[-*+]\s|^\d+\.\s|^[-*+]\s*\[[ xX]\]/.test(stripped);
    const isBlank = !stripped;

    // Add blank line before lists
    if (isList && !prevWasList && !prevWasBlank && result.length > 0) {
      result.push('');
    }

    // Add blank line after heading
    if (i > 0 && result.length > 0) {
      const prevLine = lines[i - 1].trim();
      if (prevLine.startsWith('#') && !isBlank) {
        if (result[result.length - 1] !== '') {
          result.push('');
        }
      }
    }

    // Convert checkbox markers for pandoc compatibility.
    // Pandoc strips leading bullet markers it sees as "list-style" characters
    // when every item in the list starts with the same one (☐, ☑, ☒).
    // Prefix with a zero-width space (U+200B) to defeat that heuristic so
    // the checkbox glyph survives into the docx output.
    if (/^[-*+]\s*\[ \]/.test(stripped)) {
      line = line.replace(/^([-*+])\s*\[ \]/, '$1 \u200B\u2610');
    } else if (/^[-*+]\s*\[[xX]\]/.test(stripped)) {
      line = line.replace(/^([-*+])\s*\[[xX]\]/, '$1 \u200B\u2611');
    }

    result.push(line);
    prevWasList = isList;
    prevWasBlank = isBlank;
  }

  // Add blank line after lists before non-list content
  const final = [];
  for (let i = 0; i < result.length; i++) {
    final.push(result[i]);
    const stripped = result[i].trim();
    const isList = /^[-*+]\s|^\d+\.\s|^[-*+]\s*\u200B?[\u2610\u2611]/.test(stripped);
    if (isList && i + 1 < result.length) {
      const nextStripped = result[i + 1].trim();
      const nextIsList = /^[-*+]\s|^\d+\.\s|^[-*+]\s*\u200B?[\u2610\u2611]/.test(nextStripped);
      if (!nextIsList && nextStripped) {
        final.push('');
      }
    }
  }
  return final.join('\n');
}

function transformOutsideCodeFences(content, transform) {
  const lines = content.split('\n');
  const chunks = [];
  let prose = [];
  let fence = [];
  let inFence = false;
  let fenceMarker = null;

  function flushProse() {
    if (prose.length > 0) {
      chunks.push(transform(prose.join('\n')));
      prose = [];
    }
  }
  function flushFence() {
    if (fence.length > 0) {
      chunks.push(fence.join('\n'));
      fence = [];
    }
  }

  for (const line of lines) {
    const markerMatch = line.match(/^\s*(```+|~~~+)/);
    if (markerMatch) {
      const marker = markerMatch[1][0];
      if (!inFence) {
        flushProse();
        inFence = true;
        fenceMarker = marker;
        fence.push(line);
      } else if (marker === fenceMarker) {
        fence.push(line);
        inFence = false;
        fenceMarker = null;
        flushFence();
      } else {
        fence.push(line);
      }
      continue;
    }

    if (inFence) fence.push(line);
    else prose.push(line);
  }

  if (inFence) flushFence();
  else flushProse();
  return chunks.join('\n');
}

function transformProseSyntax(content) {
  // LaTeX math -> Unicode
  content = convertLatexMath(content);

  // Page-break directives
  content = content.replace(/<!--\s*pagebreak\s*-->/gi, '\\newpage');
  content = content.replace(/<div\s+class\s*=\s*["']page-break["']\s*(?:\/\s*)?>/gi, '\\newpage');
  content = content.replace(/<div\s+style\s*=\s*["']page-break-(?:before|after)\s*:\s*always;?["']\s*(?:\/\s*)?>/gi, '\\newpage');

  // Landscape section markers
  content = content.replace(/<!--\s*landscape\s*-->/gi,
    '\\newpage\n\n::: {custom-style="LandscapeSection"}\n');
  content = content.replace(/<!--\s*portrait\s*-->/gi,
    '\n:::\n\n\\newpage');

  // Callout blocks: ::: tip / ::: warning / ::: note / ::: important / ::: caution
  content = content.replace(/^:::\s*(tip|warning|note|important|caution)\s*$/gim, (_, type) => {
    const icons = { tip: '\u{1F4A1}', warning: '\u26A0\uFE0F', note: '\u{1F4DD}', important: '\u2757', caution: '\u{1F525}' };
    const icon = icons[type.toLowerCase()] || '\u{1F4CC}';
    return `> **${icon} ${type.charAt(0).toUpperCase() + type.slice(1)}**\n>`;
  });
  content = content.replace(/^:::\s*$/gm, '');

  // GitHub-style callout syntax
  content = content.replace(/^>\s*\[!(TIP|WARNING|NOTE|IMPORTANT|CAUTION)\]\s*$/gim, (_, type) => {
    const icons = { TIP: '\u{1F4A1}', WARNING: '\u26A0\uFE0F', NOTE: '\u{1F4DD}', IMPORTANT: '\u2757', CAUTION: '\u{1F525}' };
    const icon = icons[type.toUpperCase()] || '\u{1F4CC}';
    return `> **${icon} ${type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()}**`;
  });

  // Keyboard shortcuts: [[Ctrl+S]]
  content = content.replace(/\[\[([^\]]+)\]\]/g, (_match, keys) => {
    return keys.split('+').map(k => `<kbd>${k.trim()}</kbd>`).join('+');
  });

  // Highlights: ==text==
  content = content.replace(/==([^=]+)==/g, '<mark>$1</mark>');

  // Subscript and superscript (must not span newlines or match footnote syntax [^N])
  content = content.replace(/(?<![~\\])~([^~\s][^~\n]*)~(?!~)/g, '<sub>$1</sub>');
  content = content.replace(/(?<![\\[\\]])\^([^^\s][^^\n]*)\^/g, '<sup>$1</sup>');

  // Definition lists
  content = content.replace(/^([^\n:>*#-][^\n]*)\n:\s+(.+)$/gm, '\n**$1**\n:   $2\n');
  return content;
}

/**
 * Validate heading hierarchy -- detect jumps (e.g., H1->H3 skipping H2).
 * Returns warnings for each violation found.
 * @param {string} content - Markdown content
 * @returns {{ valid: boolean, warnings: string[] }}
 */
function validateHeadingHierarchy(content) {
  const warnings = [];
  let lastLevel = 0;
  let lineNum = 0;

  for (const line of content.split('\n')) {
    lineNum++;
    const match = line.match(/^(#{1,6})\s+/);
    if (!match) continue;
    const level = match[1].length;

    if (lastLevel > 0 && level > lastLevel + 1) {
      warnings.push(`Line ${lineNum}: heading level jumps from H${lastLevel} to H${level} (skips H${lastLevel + 1})`);
    }
    lastLevel = level;
  }

  return { valid: warnings.length === 0, warnings };
}

/**
 * Embed local image references as base64 data URIs in markdown.
 * Resolves relative image paths against sourceDir.
 * @param {string} content - Markdown content
 * @param {string} sourceDir - Directory to resolve relative paths against
 * @returns {string} Content with embedded images
 */
function embedLocalImages(content, sourceDir) {
  if (!sourceDir) return content;
  const path = require('path');
  const fs = require('fs');

  const MIME_MAP = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  };

  // Match markdown image syntax: ![alt](path)
  return content.replace(/!\[([^\]]*)\]\(([^)]+)\)(\{[^}]*\})?/g, (full, alt, imgPath, attrs) => {
    // Skip URLs and data URIs
    if (imgPath.startsWith('http://') || imgPath.startsWith('https://') || imgPath.startsWith('data:')) {
      return full;
    }
    const absPath = path.resolve(sourceDir, imgPath);
    if (!fs.existsSync(absPath)) return full;

    const ext = path.extname(absPath).toLowerCase();
    const mime = MIME_MAP[ext];
    if (!mime) return full;

    try {
      const buf = fs.readFileSync(absPath);
      const b64 = buf.toString('base64');
      const dataUri = `data:${mime};base64,${b64}`;
      return `![${alt}](${dataUri})${attrs || ''}`;
    } catch {
      return full;
    }
  });
}

/**
 * Validate markdown links -- detect broken local refs, empty URLs, and malformed syntax.
 * @param {string} content - Markdown content
 * @param {string} [sourceDir] - Directory to resolve relative link paths against
 * @returns {{ valid: boolean, warnings: string[] }}
 */
function validateLinks(content, sourceDir) {
  const warnings = [];
  const lines = content.split('\n');
  const fs = require('fs');
  const path = require('path');

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];

    // Match markdown links: [text](url) -- skip images ![text](url)
    const linkPattern = /(?<!!)\[([^\]]*)\]\(([^)]*)\)/g;
    let match;
    while ((match = linkPattern.exec(line)) !== null) {
      const linkText = match[1];
      const linkUrl = match[2].trim();

      // Empty URL
      if (!linkUrl) {
        warnings.push(`Line ${lineNum}: empty link URL for "${linkText}"`);
        continue;
      }

      // Skip external URLs, anchors, and mailto
      if (linkUrl.startsWith('http://') || linkUrl.startsWith('https://') ||
        linkUrl.startsWith('#') || linkUrl.startsWith('mailto:')) {
        continue;
      }

      // Check local file references (only if sourceDir provided)
      if (sourceDir) {
        const urlPath = linkUrl.split('#')[0]; // strip anchor
        if (urlPath) {
          const absPath = path.resolve(sourceDir, urlPath);
          if (!fs.existsSync(absPath)) {
            warnings.push(`Line ${lineNum}: broken local link "${urlPath}" (file not found)`);
          }
        }
      }
    }
  }

  return { valid: warnings.length === 0, warnings };
}

/**
 * Format markdown source for professional appearance — whitespace and structure
 * cleanup ONLY. Does NOT transform syntax (no LaTeX, callouts, or semantic
 * changes). Safe to apply to source .md files in place.
 *
 * Rules (all on by default, individually opt-out via options):
 *  - Strip UTF-8 BOM and normalize line endings to LF (always)
 *  - Trim trailing whitespace, preserving ` \` and `  ` hard breaks
 *  - Blockquote continuity: append ` \` to non-empty `>` lines whose next line
 *    is also a non-empty `>` line (forces visible breaks instead of reflow)
 *  - Collapse 3+ consecutive blank lines to 2
 *  - Ensure single blank line before and after ATX headings
 *  - Ensure file ends with exactly one trailing newline
 *  - Code fences (```` ``` ```` or `~~~`) are passed through untouched
 *
 * @param {string} content - Raw markdown source
 * @param {object} [options]
 * @param {boolean} [options.trimTrailing=true]
 * @param {boolean} [options.blockquoteBreaks=true]
 * @param {boolean} [options.collapseBlanks=true]
 * @param {boolean} [options.normalizeHeadings=true]
 * @returns {string} Formatted markdown
 */
function formatMarkdown(content, options = {}) {
  const opts = {
    trimTrailing: options.trimTrailing !== false,
    blockquoteBreaks: options.blockquoteBreaks !== false,
    collapseBlanks: options.collapseBlanks !== false,
    normalizeHeadings: options.normalizeHeadings !== false,
  };

  content = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  let lines = content.split('\n');

  const buildFenceMap = (arr) => {
    const map = new Array(arr.length).fill(false);
    let fence = false, marker = null;
    for (let i = 0; i < arr.length; i++) {
      const m = arr[i].match(/^(\s{0,3})(`{3,}|~{3,})/);
      if (m) {
        if (!fence) { fence = true; marker = m[2][0]; map[i] = false; continue; }
        if (m[2][0] === marker) { fence = false; marker = null; map[i] = false; continue; }
      }
      map[i] = fence;
    }
    return map;
  };

  let inFence = buildFenceMap(lines);

  if (opts.trimTrailing) {
    for (let i = 0; i < lines.length; i++) {
      if (inFence[i]) continue;
      const line = lines[i];
      const hadTwoSpace = /\S  +$/.test(line);
      const hadBackslash = /\S \\\s*$/.test(line);
      let trimmed = line.replace(/[ \t]+$/, '');
      if (hadBackslash) trimmed += ' \\';
      else if (hadTwoSpace) trimmed += '  ';
      lines[i] = trimmed;
    }
  }

  if (opts.blockquoteBreaks) {
    for (let i = 0; i < lines.length - 1; i++) {
      if (inFence[i] || inFence[i + 1]) continue;
      const cur = lines[i];
      const nxt = lines[i + 1];
      const curBQ = /^\s{0,3}>\s*\S/.test(cur);
      const nxtBQ = /^\s{0,3}>\s*\S/.test(nxt);
      if (curBQ && nxtBQ && !/  $/.test(cur) && !/ \\$/.test(cur)) {
        lines[i] = cur.replace(/[ \t]*$/, '') + ' \\';
      }
    }
  }

  if (opts.collapseBlanks) {
    const out = [];
    const newFence = [];
    let blankRun = 0;
    for (let i = 0; i < lines.length; i++) {
      if (inFence[i]) {
        out.push(lines[i]); newFence.push(true); blankRun = 0; continue;
      }
      if (lines[i].trim() === '') {
        blankRun++;
        if (blankRun <= 2) { out.push(lines[i]); newFence.push(false); }
      } else {
        blankRun = 0;
        out.push(lines[i]); newFence.push(false);
      }
    }
    lines = out;
    inFence = newFence;
  }

  if (opts.normalizeHeadings) {
    const out = [];
    const newFence = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isHeading = !inFence[i] && /^#{1,6}\s+\S/.test(line);
      if (isHeading) {
        if (out.length > 0 && out[out.length - 1].trim() !== '') {
          out.push(''); newFence.push(false);
        }
        out.push(line); newFence.push(false);
        if (i + 1 < lines.length && lines[i + 1].trim() !== '') {
          out.push(''); newFence.push(false);
        }
      } else {
        out.push(line); newFence.push(inFence[i]);
      }
    }
    lines = out;
    inFence = newFence;
  }

  return lines.join('\n').replace(/\n+$/, '') + '\n';
}

module.exports = {
  preprocessMarkdown,
  formatMarkdown,
  convertLatexMath,
  extractFrontmatter,
  applyOutsideFences,
  replaceEmDashes,
  stripDecorativeRules,
  detectTocMarker,
  validateHeadingHierarchy,
  embedLocalImages,
  validateLinks,
  FORMAT_DEFAULTS,
  LATEX_MATH_MAP,
  SUPERSCRIPT_MAP,
};
