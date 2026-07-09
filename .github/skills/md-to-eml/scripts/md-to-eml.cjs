#!/usr/bin/env node
/**
 * @type muscle
 * @lifecycle stable
 * @muscle md-to-eml
 * @lifecycle stable
 * @inheritance inheritable
 * @description Convert Markdown to RFC 5322 email-safe .eml files
 * @version 1.0.0
 * @skill md-to-eml
 * @reviewed 2026-04-15
 * @platform windows,macos,linux
 * @requires node,pandoc
 *
 * Produces RFC 5322-compliant .eml files from Markdown with YAML frontmatter.
 * Designed for newsletter/governance communication workflows.
 *
 * Features:
 *   - YAML frontmatter -> RFC 5322 email headers (To, From, Subject, etc.)
 *   - Markdown -> email-safe HTML (inline CSS, table-based layout)
 *   - Mermaid diagrams -> static table fallback (email clients can't render JS)
 *   - Image references -> base64 CID embeds (inline images in email)
 *   - Emoji preservation in subject and body
 *   - --test flag for test-send variants (overrides recipients)
 *
 * Usage:
 *   node md-to-eml.cjs newsletter.md [output.eml] [options]
 *
 * Options:
 *   --test                Override recipients with test address
 *   --test-to ADDRESS     Custom test recipient (default: user from frontmatter)
 *   --inline-images       Embed images as base64 CID attachments
 *   --debug               Save intermediate HTML for inspection
 *
 * Frontmatter format:
 *   ---
 *   to: team@example.com
 *   from: sender@example.com
 *   subject: Weekly Update
 *   cc: manager@example.com
 *   reply-to: sender@example.com
 *   ---
 *
 * Requirements:
 *   - Node.js 24+
 *   - pandoc (for markdown -> HTML conversion)
 * @currency 2026-04-20
 */

process.on("uncaughtException", (err) => {
  console.error(`\x1b[31m[FATAL] ${err.message}\x1b[0m`);
  process.exit(1);
});

const fs = require('fs');
const path = require('path');
const os = require('os');
const { runTool } = require(path.join(__dirname, '..', '..', '..', 'scripts', 'shared', 'tool-runner.cjs'));

// Try to load shared modules
let sharedPreprocessor, sharedMermaid;
try {
  sharedPreprocessor = require(path.join(__dirname, '..', '..', '..', 'scripts', 'shared', 'markdown-preprocessor.cjs'));
  sharedMermaid = require(path.join(__dirname, '..', '..', '..', 'scripts', 'shared', 'mermaid-pipeline.cjs'));
} catch {
  // Fallback: resolve from same directory structure
  const sharedDir = path.join(__dirname, '..', '..', '..', 'scripts', 'shared');
  if (fs.existsSync(path.join(sharedDir, 'markdown-preprocessor.cjs'))) {
    sharedPreprocessor = require(path.join(sharedDir, 'markdown-preprocessor.cjs'));
    sharedMermaid = require(path.join(sharedDir, 'mermaid-pipeline.cjs'));
  }
}

// ---------------------------------------------------------------------------
// Email-safe inline CSS (email clients strip <link> and <style> blocks)
// ---------------------------------------------------------------------------
const EMAIL_STYLES = {
  body: 'font-family: Segoe UI, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #1F2328; max-width: 640px; margin: 0 auto; padding: 20px;',
  h1: 'color: #0078D4; font-size: 24px; font-weight: 600; margin-top: 24px; margin-bottom: 12px; border-bottom: 2px solid #0078D4; padding-bottom: 8px;',
  h2: 'color: #2B579A; font-size: 20px; font-weight: 600; margin-top: 20px; margin-bottom: 10px;',
  h3: 'color: #3B3B3B; font-size: 16px; font-weight: 600; margin-top: 16px; margin-bottom: 8px;',
  p: 'margin: 8px 0;',
  a: 'color: #0563C1; text-decoration: underline;',
  code: 'font-family: Consolas, monospace; font-size: 13px; background: #F0F0F0; padding: 2px 4px; border-radius: 3px;',
  pre: 'font-family: Consolas, monospace; font-size: 13px; background: #F6F8FA; padding: 12px; border-radius: 6px; border: 1px solid #E1E4E8; overflow-x: auto; white-space: pre-wrap;',
  table: 'border-collapse: collapse; width: 100%; margin: 12px 0;',
  th: 'background: #0078D4; color: white; padding: 8px 12px; text-align: left; border: 1px solid #D0D7DE; font-weight: 600;',
  td: 'padding: 8px 12px; border: 1px solid #D0D7DE;',
  trEven: 'background: #F6F8FA;',
  blockquote: 'border-left: 4px solid #0078D4; margin: 12px 0; padding: 8px 16px; background: #F0F7FF; color: #24292F;',
  hr: 'border: none; border-top: 1px solid #D0D7DE; margin: 20px 0;',
  img: 'max-width: 100%; height: auto;',
  ul: 'margin: 8px 0; padding-left: 24px;',
  ol: 'margin: 8px 0; padding-left: 24px;',
  li: 'margin: 4px 0;',
};

// ---------------------------------------------------------------------------
// YAML Frontmatter Parser (lightweight, no external deps)
// ---------------------------------------------------------------------------
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return { headers: {}, body: content };

  const yaml = match[1];
  const headers = {};
  for (const line of yaml.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim().toLowerCase();
      const value = line.slice(colonIdx + 1).trim();
      headers[key] = value;
    }
  }

  return {
    headers,
    body: content.slice(match[0].length),
  };
}

// ---------------------------------------------------------------------------
// Markdown -> Email-safe HTML
// ---------------------------------------------------------------------------
function markdownToEmailHtml(markdown, options = {}) {
  // Preprocess markdown using shared module if available
  if (sharedPreprocessor) {
    markdown = sharedPreprocessor.preprocessMarkdown(markdown, { format: 'email', stripFrontmatter: false });
  }

  // Replace Mermaid blocks with table fallbacks
  if (sharedMermaid) {
    const blocks = sharedMermaid.findMermaidBlocks(markdown);
    for (const block of blocks) {
      const fallback = sharedMermaid.mermaidToTableFallback(block.content);
      markdown = markdown.replace(block.raw, fallback);
    }
  } else {
    // Basic Mermaid removal if shared module not available
    markdown = markdown.replace(/```mermaid\r?\n[\s\S]*?```/g, '*[Diagram -- view in browser]*');
  }

  // Convert to HTML via pandoc
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-to-eml-'));
  process.on('exit', () => { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ } });
  const tempMd = path.join(tempDir, 'email.md');
  const tempHtml = path.join(tempDir, 'email.html');

  try {
    fs.writeFileSync(tempMd, markdown, 'utf8');

    runTool('pandoc', [tempMd, '-o', tempHtml, '--from', 'markdown', '--to', 'html5', '--standalone=false'], { stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });

    let html = fs.readFileSync(tempHtml, 'utf8');

    // Apply inline CSS to all elements (email clients strip <style> blocks)
    html = applyInlineStyles(html);

    if (options.debug) {
      const debugPath = path.join(path.dirname(options.source || '.'), '_debug_email.html');
      fs.writeFileSync(debugPath, html, 'utf8');
      console.log(`  \u{1F50D} Debug: saved intermediate HTML to ${debugPath}`);
    }

    return html;
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/**
 * Apply inline CSS styles to HTML elements for email compatibility.
 */
function applyInlineStyles(html) {
  // Headers
  html = html.replace(/<h1([^>]*)>/g, `<h1$1 style="${EMAIL_STYLES.h1}">`);
  html = html.replace(/<h2([^>]*)>/g, `<h2$1 style="${EMAIL_STYLES.h2}">`);
  html = html.replace(/<h3([^>]*)>/g, `<h3$1 style="${EMAIL_STYLES.h3}">`);

  // Paragraphs
  html = html.replace(/<p([^>]*)>/g, `<p$1 style="${EMAIL_STYLES.p}">`);

  // Links
  html = html.replace(/<a ([^>]*)>/g, (match, attrs) => {
    if (attrs.includes('style=')) return match;
    return `<a ${attrs} style="${EMAIL_STYLES.a}">`;
  });

  // Code
  html = html.replace(/<code([^>]*)>/g, `<code$1 style="${EMAIL_STYLES.code}">`);
  html = html.replace(/<pre([^>]*)>/g, `<pre$1 style="${EMAIL_STYLES.pre}">`);

  // Tables
  html = html.replace(/<table([^>]*)>/g, `<table$1 style="${EMAIL_STYLES.table}">`);
  html = html.replace(/<th([^>]*)>/g, `<th$1 style="${EMAIL_STYLES.th}">`);
  html = html.replace(/<td([^>]*)>/g, `<td$1 style="${EMAIL_STYLES.td}">`);

  // Alternating row shading
  html = html.replace(/<tbody>([\s\S]*?)<\/tbody>/g, (_match, inner) => {
    let rowIdx = 0;
    const styled = inner.replace(/<tr([^>]*)>/g, (trMatch, attrs) => {
      rowIdx++;
      if (rowIdx % 2 === 0) {
        return `<tr${attrs} style="${EMAIL_STYLES.trEven}">`;
      }
      return trMatch;
    });
    return `<tbody>${styled}</tbody>`;
  });

  // Blockquotes
  html = html.replace(/<blockquote([^>]*)>/g, `<blockquote$1 style="${EMAIL_STYLES.blockquote}">`);

  // Lists
  html = html.replace(/<ul([^>]*)>/g, `<ul$1 style="${EMAIL_STYLES.ul}">`);
  html = html.replace(/<ol([^>]*)>/g, `<ol$1 style="${EMAIL_STYLES.ol}">`);
  html = html.replace(/<li([^>]*)>/g, `<li$1 style="${EMAIL_STYLES.li}">`);

  // Images
  html = html.replace(/<img ([^>]*)>/g, (match, attrs) => {
    if (attrs.includes('style=')) return match;
    return `<img ${attrs} style="${EMAIL_STYLES.img}">`;
  });

  // Horizontal rules
  html = html.replace(/<hr\s*\/?>/g, `<hr style="${EMAIL_STYLES.hr}">`);

  return html;
}

// ---------------------------------------------------------------------------
// Image -> Base64 CID embedding
// ---------------------------------------------------------------------------
function embedImagesAsCid(html, sourceDir) {
  const attachments = [];
  let cidCounter = 0;

  html = html.replace(/<img\s+([^>]*?)src=["']([^"']+)["']([^>]*)>/g, (match, pre, src, post) => {
    // Skip external URLs and data URIs
    if (src.startsWith('http') || src.startsWith('data:')) return match;

    const imagePath = path.resolve(sourceDir, src);
    if (!fs.existsSync(imagePath)) return match;

    const ext = path.extname(imagePath).toLowerCase();
    const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
    const mime = mimeMap[ext];
    if (!mime) return match;

    cidCounter++;
    const cid = `image${cidCounter}@md-to-eml`;
    const base64 = fs.readFileSync(imagePath).toString('base64');

    attachments.push({
      cid,
      mime,
      base64,
      filename: path.basename(imagePath),
    });

    return `<img ${pre}src="cid:${cid}"${post}>`;
  });

  return { html, attachments };
}

// ---------------------------------------------------------------------------
// RFC 5322 .eml Generation
// ---------------------------------------------------------------------------
function generateEml(headers, htmlBody, attachments = []) {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const date = new Date().toUTCString();
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@md-to-eml>`;

  const emlLines = [
    `From: ${headers.from || 'sender@example.com'}`,
    `To: ${headers.to || 'recipient@example.com'}`,
    `Subject: ${headers.subject || 'No Subject'}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
  ];

  if (headers.cc) emlLines.push(`Cc: ${headers.cc}`);
  if (headers['reply-to']) emlLines.push(`Reply-To: ${headers['reply-to']}`);

  if (attachments.length > 0) {
    // Multipart/related for inline images
    emlLines.push(`Content-Type: multipart/related; boundary="${boundary}"`);
    emlLines.push('');
    emlLines.push(`--${boundary}`);
    emlLines.push('Content-Type: text/html; charset=UTF-8');
    emlLines.push('Content-Transfer-Encoding: base64');
    emlLines.push('');

    // Base64-encode the HTML body
    const htmlBase64 = Buffer.from(wrapInEmailTemplate(htmlBody), 'utf8').toString('base64');
    // Split into 76-char lines per RFC 2045
    const lines76 = htmlBase64.match(/.{1,76}/g) || [];
    emlLines.push(...lines76);

    // Add inline image attachments
    for (const att of attachments) {
      emlLines.push(`--${boundary}`);
      emlLines.push(`Content-Type: ${att.mime}; name="${att.filename}"`);
      emlLines.push(`Content-Transfer-Encoding: base64`);
      emlLines.push(`Content-ID: <${att.cid}>`);
      emlLines.push(`Content-Disposition: inline; filename="${att.filename}"`);
      emlLines.push('');
      const attLines = att.base64.match(/.{1,76}/g) || [];
      emlLines.push(...attLines);
    }

    emlLines.push(`--${boundary}--`);
  } else {
    // Simple HTML email
    emlLines.push('Content-Type: text/html; charset=UTF-8');
    emlLines.push('Content-Transfer-Encoding: base64');
    emlLines.push('');
    const htmlBase64 = Buffer.from(wrapInEmailTemplate(htmlBody), 'utf8').toString('base64');
    const lines76 = htmlBase64.match(/.{1,76}/g) || [];
    emlLines.push(...lines76);
  }

  return emlLines.join('\r\n');
}

/**
 * Wrap HTML body in a minimal email-safe HTML template.
 */
function wrapInEmailTemplate(bodyHtml) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="${EMAIL_STYLES.body}">
${bodyHtml}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// CLI Argument Parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = argv.slice(2);
  const result = {
    source: null,
    output: null,
    test: false,
    testTo: null,
    inlineImages: false,
    debug: false,
  };

  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--test') {
      result.test = true;
    } else if (args[i] === '--test-to' && i + 1 < args.length) {
      result.testTo = args[++i];
      result.test = true;
    } else if (args[i] === '--inline-images') {
      result.inlineImages = true;
    } else if (args[i] === '--debug') {
      result.debug = true;
    } else if (!args[i].startsWith('--')) {
      positional.push(args[i]);
    }
  }

  if (positional.length === 0) {
    console.error('Usage: node md-to-eml.cjs SOURCE.md [OUTPUT.eml] [options]');
    console.error('  Options: --test --test-to ADDRESS --inline-images --debug');
    process.exit(1);
  }

  result.source = positional[0];
  result.output = positional[1] || positional[0].replace(/\.md$/i, '.eml');
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv);

  const sourcePath = path.resolve(args.source);
  if (!fs.existsSync(sourcePath)) {
    console.error(`ERROR: Source file not found: ${sourcePath}`);
    process.exit(1);
  }

  const outputPath = path.resolve(args.output);
  const sourceDir = path.dirname(sourcePath);

  console.log(`\u{1F4E7} Converting ${sourcePath} \u2192 ${outputPath}`);

  // Read and parse content
  const rawContent = fs.readFileSync(sourcePath, 'utf8');
  const { headers, body } = parseFrontmatter(rawContent);

  // Override recipients in test mode
  if (args.test) {
    const originalTo = headers.to || '(none)';
    headers.to = args.testTo || headers.from || 'test@example.com';
    delete headers.cc;
    headers.subject = `[TEST] ${headers.subject || 'No Subject'}`;
    console.log(`  \u{1F9EA} Test mode: ${originalTo} \u2192 ${headers.to}`);
  }

  console.log(`  From: ${headers.from || '(not set)'}`);
  console.log(`  To: ${headers.to || '(not set)'}`);
  console.log(`  Subject: ${headers.subject || '(not set)'}`);

  // Convert markdown to email HTML
  console.log('  \u{1F527} Converting markdown to email HTML...');
  let html = markdownToEmailHtml(body, {
    source: sourcePath,
    debug: args.debug,
  });

  // Embed images as CID attachments
  let attachments = [];
  if (args.inlineImages) {
    console.log('  \u{1F5BC}\uFE0F  Embedding images as CID attachments...');
    const result = embedImagesAsCid(html, sourceDir);
    html = result.html;
    attachments = result.attachments;
    console.log(`  \u{1F4CE} ${attachments.length} images embedded`);
  }

  // Generate .eml file
  console.log('  \u{1F4DD} Generating .eml file...');
  const emlContent = generateEml(headers, html, attachments);

  fs.writeFileSync(outputPath, emlContent, 'utf8');

  const stats = fs.statSync(outputPath);
  console.log(`\u2705 Done! Output: ${outputPath}`);
  console.log(`  Size: ${(stats.size / 1024).toFixed(1)} KB`);
  if (attachments.length > 0) {
    console.log(`  \u{1F4CE} ${attachments.length} inline image(s)`);
  }
  if (args.test) {
    console.log('  \u{1F9EA} This is a TEST variant -- do not distribute');
  }
}

main().catch(err => {
  console.error(`FATAL: ${err.message || err}`);
  process.exit(1);
});
