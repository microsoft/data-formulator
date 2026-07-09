#!/usr/bin/env node
/**
 * @type muscle
 * @lifecycle stable
 * @muscle docx-to-md
 * @lifecycle stable
 * @inheritance inheritable
 * @description Convert Word documents to clean Markdown with image extraction
 * @version 1.2.0
 * @skill docx-to-md
 * @reviewed 2026-04-30
 * @platform windows,macos,linux
 * @requires node,pandoc
 *
 * Uses pandoc to convert .docx to .md with intelligent post-processing:
 * - Extracts embedded images to a sibling images/ folder
 * - Cleans pandoc quirks (escaped brackets, trailing backslashes, etc.)
 * - Normalizes heading hierarchy
 * - Optionally generates YAML frontmatter
 * - Fixes table formatting
 *
 * Usage:
 *   node docx-to-md.cjs SOURCE.docx [OUTPUT.md] [options]
 *
 * Options:
 *   --extract-images      Extract images to images/ folder (default: true)
 *   --no-extract-images   Keep images as raw base64 in markdown
 *   --add-frontmatter     Generate YAML frontmatter with title/date
 *   --clean-tables        Normalize table column widths (default: true)
 *   --no-clean-tables     Keep pandoc raw table output
 *   --fix-headings        Normalize heading hierarchy to start at H1
 *   --wrap N              Wrap lines at N characters (0 = no wrap, default: 0)
 *   --strip-comments      Remove Word comment annotations
 *   --debug               Keep intermediate pandoc output as _debug_raw.md
 *
 * Requirements:
 *   - Node.js 24+
 *   - pandoc (Windows: winget install pandoc | macOS: brew install pandoc | Linux: apt install pandoc)
 * @currency 2026-04-20
 */

"use strict";

process.on("uncaughtException", (err) => {
  console.error(`\x1b[31m[FATAL] ${err.message}\x1b[0m`);
  process.exit(1);
});

const fs = require("fs");
const path = require("path");
const os = require("os");
const { runTool } = require(path.join(__dirname, '..', '..', '..', 'scripts', 'shared', 'tool-runner.cjs'));

// ---------------------------------------------------------------------------
// Post-processing transforms
// ---------------------------------------------------------------------------

/** Remove pandoc escape quirks */
function cleanPandocQuirks(md) {
  // Remove escaped brackets \[ \] that pandoc adds
  md = md.replace(/\\\[/g, "[").replace(/\\\]/g, "]");
  // Remove trailing backslashes pandoc uses for hard line breaks
  md = md.replace(/\\\s*$/gm, "");
  // Clean up excessive blank lines (3+ -> 2)
  md = md.replace(/\n{3,}/g, "\n\n");
  // Remove {width="..."} image attributes pandoc adds
  md = md.replace(/\{width="[^"]*"(?:\s+height="[^"]*")?\}/g, "");
  // Remove {.underline} and similar pandoc span classes
  md = md.replace(/\{\.underline\}/g, "");
  md = md.replace(/\{\.[a-z-]+\}/g, "");
  // Clean up empty heading anchors {#section-n}
  md = md.replace(/\s*\{#[a-zA-Z0-9_-]+\}/g, "");
  return md;
}

/** Normalize heading hierarchy so the first heading is H1 */
function normalizeHeadings(md) {
  const headingMatch = md.match(/^(#{1,6})\s/m);
  if (!headingMatch) return md;

  const firstLevel = headingMatch[1].length;
  if (firstLevel === 1) return md;

  const shift = firstLevel - 1;
  return md.replace(/^(#{1,6})\s/gm, (match, hashes) => {
    const newLevel = Math.max(1, hashes.length - shift);
    return "#".repeat(newLevel) + " ";
  });
}

/** Clean up pandoc table output for readable alignment */
function cleanTables(md) {
  const lines = md.split(/\r?\n/);
  const result = [];
  let inTable = false;
  let tableLines = [];

  for (const line of lines) {
    const isTableLine = /^\|/.test(line) || /^[+:-]+$/.test(line);

    if (isTableLine) {
      inTable = true;
      tableLines.push(line);
    } else {
      if (inTable) {
        result.push(...formatTable(tableLines));
        tableLines = [];
        inTable = false;
      }
      result.push(line);
    }
  }
  if (inTable) result.push(...formatTable(tableLines));

  return result.join("\n");
}

function formatTable(lines) {
  if (lines.length < 2) return lines;

  // Parse cells
  const rows = lines
    .filter((l) => l.startsWith("|"))
    .map((l) =>
      l
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim()),
    );

  if (rows.length === 0) return lines;

  const colCount = Math.max(...rows.map((r) => r.length));

  // Calculate max widths
  const widths = Array(colCount).fill(3);
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      widths[i] = Math.max(widths[i], (row[i] || "").length);
    }
  }

  // Rebuild
  const formatted = [];
  for (let r = 0; r < rows.length; r++) {
    const cells = [];
    for (let c = 0; c < colCount; c++) {
      cells.push(` ${(rows[r][c] || "").padEnd(widths[c])} `);
    }
    formatted.push("|" + cells.join("|") + "|");

    // Add separator after header row
    if (r === 0) {
      const sep = widths.map((w) => "-".repeat(w + 2));
      formatted.push("|" + sep.join("|") + "|");
    }
  }

  return formatted;
}

/** Extract inline images from markdown, save to images/ folder */
function extractImages(md, outputDir, imageDirName, mediaRoot = outputDir) {
  const imageDir = path.join(outputDir, imageDirName);
  let imageCount = 0;

  // Handle base64 data URI images from pandoc
  md = md.replace(
    /!\[([^\]]*)\]\(data:image\/([a-z+]+);base64,([A-Za-z0-9+/=\s]+)\)/g,
    (match, alt, ext, base64) => {
      imageCount++;
      const cleanExt = ext === "svg+xml" ? "svg" : ext;
      const filename = `image-${String(imageCount).padStart(3, "0")}.${cleanExt}`;
      const imagePath = path.join(imageDir, filename);

      if (!fs.existsSync(imageDir)) fs.mkdirSync(imageDir, { recursive: true });
      fs.writeFileSync(
        imagePath,
        Buffer.from(base64.replace(/\s/g, ""), "base64"),
      );

      return `![${alt}](${imageDirName}/${filename})`;
    },
  );

  // Handle pandoc media/ references
  md = md.replace(
    /!\[([^\]]*)\]\(media\/([^)]+)\)/g,
    (match, alt, filename) => {
      imageCount++;
      const ext = path.extname(filename);
      const newName = `image-${String(imageCount).padStart(3, "0")}${ext}`;

      // Try to copy from pandoc media dir if it exists
      const mediaPath = path.join(mediaRoot, "media", filename);
      if (fs.existsSync(mediaPath)) {
        if (!fs.existsSync(imageDir))
          fs.mkdirSync(imageDir, { recursive: true });
        fs.copyFileSync(mediaPath, path.join(imageDir, newName));
      }

      return `![${alt}](${imageDirName}/${newName})`;
    },
  );

  if (imageCount > 0) {
    console.log(
      `  \u{1F5BC}\uFE0F  Extracted ${imageCount} image(s) to ${imageDirName}/`,
    );
  }

  return md;
}

/** Strip Word comment annotations */
function stripComments(md) {
  // Remove comment markers like [GD1], [FC1], etc.
  md = md.replace(/\[([A-Z]{1,4}\d+)\]/g, "");
  // Remove comment text blocks pandoc sometimes inserts
  md = md.replace(/> \*\*Comment \[.*?\]\*\*.*?(?=\n[^>]|\n\n|\z)/gs, "");
  return md;
}

/** Generate YAML frontmatter from document properties */
function generateFrontmatter(sourcePath) {
  const basename = path.basename(sourcePath, ".docx");
  const title = basename
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const date = new Date().toISOString().split("T")[0];

  return `---\ntitle: "${title}"\ndate: ${date}\nsource: "${path.basename(sourcePath)}"\n---\n\n`;
}

// ---------------------------------------------------------------------------
// Main conversion
// ---------------------------------------------------------------------------
function convertDocxToMarkdown(sourcePath, outputPath, options = {}) {
  const doExtractImages = options.extractImages !== false;
  const doCleanTables = options.cleanTables !== false;
  const doFixHeadings = !!options.fixHeadings;
  const doAddFrontmatter = !!options.addFrontmatter;
  const doStripComments = !!options.stripComments;
  const wrapWidth = options.wrap || 0;

  if (!fs.existsSync(sourcePath)) {
    console.error(`ERROR: File not found: ${sourcePath}`);
    process.exit(1);
  }

  const outputDir = path.dirname(path.resolve(outputPath));
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  let mediaRoot = outputDir;

  // Pandoc conversion
  const mediaTempDir = doExtractImages ? fs.mkdtempSync(path.join(os.tmpdir(), "docx-to-md-media-")) : null;
  if (mediaTempDir) mediaRoot = mediaTempDir;
  const pandocArgs = [sourcePath, '-o', outputPath, '--from', 'docx', '--to', 'markdown'];
  if (wrapWidth > 0) pandocArgs.push('--wrap=auto', `--columns=${wrapWidth}`);
  else pandocArgs.push('--wrap=none');
  if (doExtractImages) pandocArgs.push('--extract-media', mediaRoot);

  try {
    runTool('pandoc', pandocArgs, { stdio: ["pipe", "pipe", "pipe"], timeout: 60000 });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : "";
    console.error(`ERROR: pandoc conversion failed: ${stderr || err.message}`);
    process.exit(1);
  }

  let md = fs.readFileSync(outputPath, "utf8");

  if (options.debug) {
    fs.writeFileSync(outputPath.replace(/\.md$/, "_debug_raw.md"), md, "utf8");
    console.log(`  \u{1F50D} Debug: saved raw pandoc output to _debug_raw.md`);
  }

  // Post-processing pipeline
  md = cleanPandocQuirks(md);

  if (doStripComments) md = stripComments(md);
  if (doFixHeadings) md = normalizeHeadings(md);
  if (doCleanTables) md = cleanTables(md);

  if (doExtractImages) {
    const imagesDirName = "images";
    md = extractImages(md, outputDir, imagesDirName, mediaRoot);

    if (mediaTempDir && fs.existsSync(mediaTempDir)) {
      try {
        fs.rmSync(mediaTempDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  if (doAddFrontmatter) {
    md = generateFrontmatter(sourcePath) + md;
  }

  // Final cleanup: ensure single trailing newline
  md = md.trimEnd() + "\n";

  fs.writeFileSync(outputPath, md, "utf8");

  const sizeKb = (fs.statSync(outputPath).size / 1024).toFixed(1);
  const lineCount = md.split("\n").length;
  console.log(
    `\u2705 Converted: ${path.basename(outputPath)} (${sizeKb} KB, ${lineCount} lines)`,
  );
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
    if (arg === "--extract-images") {
      options.extractImages = true;
    } else if (arg === "--no-extract-images") {
      options.extractImages = false;
    } else if (arg === "--add-frontmatter") {
      options.addFrontmatter = true;
    } else if (arg === "--clean-tables") {
      options.cleanTables = true;
    } else if (arg === "--no-clean-tables") {
      options.cleanTables = false;
    } else if (arg === "--fix-headings") {
      options.fixHeadings = true;
    } else if (arg === "--strip-comments") {
      options.stripComments = true;
    } else if (arg === "--wrap" && args[i + 1]) {
      options.wrap = parseInt(args[++i], 10);
    } else if (arg === "--debug") {
      options.debug = true;
    } else if (!arg.startsWith("--")) {
      positional.push(arg);
    }
  }

  return { positional, options };
}

function main() {
  const { positional, options } = parseCliArgs();

  if (positional.length === 0) {
    console.log("Usage: node docx-to-md.cjs SOURCE.docx [OUTPUT.md] [options]");
    console.log("");
    console.log("Options:");
    console.log("  --extract-images      Extract images to images/ (default)");
    console.log("  --no-extract-images   Keep images inline");
    console.log("  --add-frontmatter     Generate YAML frontmatter");
    console.log("  --clean-tables        Normalize table formatting (default)");
    console.log("  --no-clean-tables     Keep raw pandoc tables");
    console.log(
      "  --fix-headings        Normalize heading levels to start at H1",
    );
    console.log("  --strip-comments      Remove Word comment annotations");
    console.log(
      "  --wrap N              Wrap lines at N characters (0 = none)",
    );
    console.log("  --debug               Save raw pandoc output");
    process.exit(1);
  }

  const sourcePath = path.resolve(positional[0]);
  if (!fs.existsSync(sourcePath)) {
    console.error(`ERROR: File not found: ${sourcePath}`);
    process.exit(1);
  }

  const outputPath = positional[1]
    ? path.resolve(positional[1])
    : sourcePath.replace(/\.docx$/i, ".md");

  convertDocxToMarkdown(sourcePath, outputPath, options);
}

if (require.main === module) {
  main();
}

module.exports = {
  convertDocxToMarkdown,
  extractImages,
  cleanPandocQuirks,
  normalizeHeadings,
  cleanTables,
};
