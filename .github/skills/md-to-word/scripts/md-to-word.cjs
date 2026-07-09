/**
 * @type muscle
 * @lifecycle stable
 * @muscle md-to-word
 * @lifecycle stable
 * @inheritance inheritable
 * @description Convert Markdown to production-quality Word documents
 * @version 5.5.0
 * @skill md-to-word
 * @reviewed 2026-04-28
 * @platform windows,macos,linux
 * @requires pandoc, mermaid-cli, svgexport (optional)
 *
 * md-to-word.cjs - Produces professional, visually complete Word output on the first run.
 * Harvests proven fixes from AlexBooks, VT_AIPOWERBI, AlexVideos,
 * FishbowlGovernance, and AIRS_Data_Analysis projects.
 *
 * Usage:
 *   node md-to-word.cjs SOURCE.md [OUTPUT.docx] [options]
 *
 * Options:
 *   --no-format-tables   Skip table styling (borders, shading, headers)
 *   --keep-temp          Keep temporary files for debugging
 *   --toc                Generate Table of Contents (also auto-detected from `[toc]` marker line)
 *   --no-replace-em-dashes  Disable em-dash --> comma replacement (default: enabled)
 *   --no-strip-decorative-rules  Disable removal of decorative `---` thematic breaks (default: enabled)
 *   --cover              Generate cover page from H1 + metadata
 *   --no-cover           Skip cover page (default)
 *   --page-size SIZE     Page size: letter (default), a4, 6x9
 *   --style PRESET       Style preset: professional (default), academic, course, creative
 *   --reference-doc PATH Use a custom Word template (.dotx or .docx)
 *   --watch              Watch source file for changes and auto-rebuild
 *   --debug              Save preprocessed markdown as _debug_combined.md
 *   --images-dir DIR     Image output directory (default: images)
 *   --lua-filter PATH    Custom pandoc Lua filter to apply
 *   --embed-images       Embed local images as base64 data URIs (prevents broken refs)
 *   --strip-frontmatter  Remove YAML frontmatter before conversion
 *   --recursive          Process all .md files in a directory tree
 *   --dry-run            Run preprocessing + validation only, no .docx output
 *   --no-default-palette Skip auto-injection of pastel palette into unstyled Mermaid blocks
 *
 * Examples:
 *   node md-to-word.cjs README.md
 *   node md-to-word.cjs docs/spec.md spec.docx --toc --cover
 *   node md-to-word.cjs thesis.md --page-size a4 --style academic --debug
 *   node md-to-word.cjs report.md --reference-doc corporate-template.docx
 *   node md-to-word.cjs draft.md --watch
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

// ---------------------------------------------------------------------------
// JSZip loading -- try multiple resolution paths
// ---------------------------------------------------------------------------
let JSZip;
try {
  JSZip = require('jszip');
} catch {
  // Fallback: search common locations relative to the heir repo
  const fallbackPaths = [
    path.join(__dirname, '..', '..', 'node_modules', 'jszip'),       // heir/node_modules
    path.join(__dirname, 'node_modules', 'jszip'),                   // skill/node_modules
    path.join(process.cwd(), 'node_modules', 'jszip'),               // cwd/node_modules
  ];
  for (const p of fallbackPaths) {
    try { JSZip = require(p); break; } catch { /* continue */ }
  }
  if (!JSZip) {
    console.error('WARNING: jszip not found. Post-processing (formatting, centering) will be limited.');
    console.error('  Install in your heir: npm install jszip');
  }
}

// ---------------------------------------------------------------------------
// Shared module imports
// ---------------------------------------------------------------------------
const { preprocessMarkdown, detectTocMarker, validateHeadingHierarchy, embedLocalImages, validateLinks } = require(path.join(__dirname, '..', '..', '..', 'scripts', 'shared', 'markdown-preprocessor.cjs'));
const { findMermaidBlocks, analyzeMermaid, injectPalette } = require(path.join(__dirname, '..', '..', '..', 'scripts', 'shared', 'mermaid-pipeline.cjs'));

// ---------------------------------------------------------------------------
// Page Layout Constants (Letter: 8.5"  11", 1" margins)
// ---------------------------------------------------------------------------
const PAGE_WIDTH_INCHES = 6.5;
const PAGE_HEIGHT_INCHES = 9.0;
const MAX_IMAGE_WIDTH_RATIO = 0.90;  // 90% of printable width
const MAX_IMAGE_HEIGHT_RATIO = 0.60; // 60% of printable height
const MAX_IMAGE_WIDTH = PAGE_WIDTH_INCHES * MAX_IMAGE_WIDTH_RATIO;   // 5.85"
const MAX_IMAGE_HEIGHT = PAGE_HEIGHT_INCHES * MAX_IMAGE_HEIGHT_RATIO; // 5.4"
const PNG_DPI = 96;

// ---------------------------------------------------------------------------
// Built-in Lua filter for centering images in docx output
// Pandoc's default reference.docx "Figure" style is center-aligned.
// This wraps lone-image paragraphs in a Figure-styled Div.
// ---------------------------------------------------------------------------
const CENTER_IMAGES_LUA = `
function Para(el)
  for _, item in ipairs(el.content) do
    if item.t == "Image" then
      return pandoc.Div(el, pandoc.Attr("", {}, {{"custom-style", "Figure"}}))
    end
  end
end
`;

// ---------------------------------------------------------------------------
// OOXML namespace
// ---------------------------------------------------------------------------
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';

// ---------------------------------------------------------------------------
// PNG dimensions reader (no dependencies)
// ---------------------------------------------------------------------------
function getPngDimensions(pngPath) {
  try {
    const buf = Buffer.alloc(24);
    const fd = fs.openSync(pngPath, 'r');
    fs.readSync(fd, buf, 0, 24, 0);
    fs.closeSync(fd);
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      return { width, height };
    }
  } catch { /* ignore */ }
  return { width: 0, height: 0 };
}

// ---------------------------------------------------------------------------
// Image sizing
// ---------------------------------------------------------------------------
function calculateOptimalSize(pngPath, mmdContent) {
  const { width: widthPx, height: heightPx } = getPngDimensions(pngPath);
  if (widthPx === 0 || heightPx === 0) {
    return determineImageSizeHeuristic(mmdContent);
  }
  const widthIn = widthPx / PNG_DPI;
  const heightIn = heightPx / PNG_DPI;
  const widthScale = widthIn > 0 ? MAX_IMAGE_WIDTH / widthIn : 1;
  const heightScale = heightIn > 0 ? MAX_IMAGE_HEIGHT / heightIn : 1;
  const scale = Math.min(widthScale, heightScale, 1.0);
  const targetWidth = widthIn * scale;
  const targetHeight = heightIn * scale;
  const aspectRatio = heightIn > 0 ? widthIn / heightIn : 1;
  if (aspectRatio >= 1.0) {
    return `{width=${targetWidth.toFixed(1)}in}`;
  }
  return `{height=${targetHeight.toFixed(1)}in}`;
}

function determineImageSizeHeuristic(mmdContent) {
  const lower = mmdContent.toLowerCase();
  const subgraphCount = (lower.match(/subgraph/g) || []).length;
  const wTag = `{width=${MAX_IMAGE_WIDTH.toFixed(1)}in}`;
  if (lower.includes('gantt')) return wTag;
  if (subgraphCount >= 3) return wTag;
  if (lower.includes('flowchart lr') || lower.includes('graph lr')) return wTag;
  if (lower.includes('flowchart td') || lower.includes('graph td') ||
    lower.includes('flowchart tb') || lower.includes('graph tb')) {
    if (subgraphCount >= 2) return `{height=${MAX_IMAGE_HEIGHT.toFixed(1)}in}`;
    return wTag;
  }
  return wTag;
}

// ---------------------------------------------------------------------------
// Mermaid / SVG conversion
// ---------------------------------------------------------------------------

function convertMermaidToPng(mmdContent, outputPath) {
  const tmpFile = path.join(os.tmpdir(), `alex-mmd-${Date.now()}-${Math.random().toString(36).slice(2)}.mmd`);
  try {
    fs.writeFileSync(tmpFile, mmdContent, 'utf8');
    // High-res render: 4x scale, 4800px viewport (was 8x/2400px).
    // Wider viewport prevents clipping on wide architecture diagrams;
    // 4 × 4800 = 19200px effective output — same fidelity, more horizontal room.
    runTool('npx', ['mmdc', '-i', tmpFile, '-o', outputPath, '-b', 'white', '-s', '4', '-w', '4800', '-H', '2400'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120000
    });
    return true;
  } catch (err) {
    return false;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

function convertSvgToPng(svgPath, pngPath) {
  try {
    runTool('npx', ['svgexport', svgPath, pngPath, '800:'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000
    });
    return true;
  } catch {
    console.log(`WARNING: svgexport not available, skipping ${svgPath}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// OOXML Post-Processing Helpers
// ---------------------------------------------------------------------------

/**
 * Insert a child element snippet right after the opening tag of a parent.
 * If `existingTag` is already present inside parent, replaces it.
 */
function ensureChildElement(parentXml, childTag, childSnippet) {
  const existingPattern = new RegExp(`<${childTag}[\\s>][\\s\\S]*?<\\/${childTag}>|<${childTag}[^/]*\\/>`, 'g');
  let cleaned = parentXml.replace(existingPattern, '');
  // Insert after the opening tag of the parent
  const openTagEnd = cleaned.indexOf('>');
  if (openTagEnd === -1) return parentXml;
  return cleaned.slice(0, openTagEnd + 1) + childSnippet + cleaned.slice(openTagEnd + 1);
}

/**
 * Format all tables in document.xml with professional styling.
 */
function formatTables(xml) {
  // Borders XML snippet
  const bordersXml =
    '<w:tblBorders xmlns:w="' + W_NS + '">' +
    '<w:top w:val="single" w:sz="6" w:space="0" w:color="666666"/>' +
    '<w:left w:val="single" w:sz="6" w:space="0" w:color="666666"/>' +
    '<w:bottom w:val="single" w:sz="6" w:space="0" w:color="666666"/>' +
    '<w:right w:val="single" w:sz="6" w:space="0" w:color="666666"/>' +
    '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="AAAAAA"/>' +
    '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="AAAAAA"/>' +
    '</w:tblBorders>';

  // Cell margins (top/bottom 20twips ~1pt, left/right 60twips ~3pt) -- tightened in v5.5.0
  const cellMarginsXml =
    '<w:tblCellMar xmlns:w="' + W_NS + '">' +
    '<w:top w:w="20" w:type="dxa"/>' +
    '<w:left w:w="60" w:type="dxa"/>' +
    '<w:bottom w:w="20" w:type="dxa"/>' +
    '<w:right w:w="60" w:type="dxa"/>' +
    '</w:tblCellMar>';

  // Full-width table
  const autoWidthXml =
    '<w:tblW xmlns:w="' + W_NS + '" w:type="pct" w:w="5000"/>';
  const autoLayoutXml =
    '<w:tblLayout xmlns:w="' + W_NS + '" w:type="autofit"/>';

  // Process each table
  xml = xml.replace(/<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g, (tableMatch) => {
    // --- Table properties ---
    tableMatch = tableMatch.replace(/<w:tblPr\b[^>]*>([\s\S]*?)<\/w:tblPr>/g, (tblPrMatch, inner) => {
      // Remove existing borders, width, layout
      let cleaned = inner
        .replace(/<w:tblBorders[\s\S]*?<\/w:tblBorders>/g, '')
        .replace(/<w:tblW[^/]*\/>/g, '')
        .replace(/<w:tblLayout[^/]*\/>/g, '')
        .replace(/<w:tblCellMar[\s\S]*?<\/w:tblCellMar>/g, '');
      return `<w:tblPr>${cleaned}${bordersXml}${cellMarginsXml}${autoWidthXml}${autoLayoutXml}</w:tblPr>`;
    });

    // --- Row formatting ---
    let rowIndex = 0;
    tableMatch = tableMatch.replace(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g, (rowMatch, rowInner) => {
      const currentRow = rowIndex++;
      const isHeader = currentRow === 0;
      const isEvenData = currentRow > 0 && currentRow % 2 === 0;

      // Cell shading color
      let shadingColor = 'FFFFFF';
      if (isHeader) shadingColor = '0078D4';
      else if (isEvenData) shadingColor = 'F0F0F0';

      const shadingXml = `<w:shd xmlns:w="${W_NS}" w:fill="${shadingColor}" w:val="clear"/>`;

      // Can't-split row property
      const cantSplitXml = `<w:cantSplit xmlns:w="${W_NS}"/>`;
      // Header row repeat across pages (harvested from AIRS format_word_tables.py)
      const tblHeaderXml = isHeader ? `<w:tblHeader xmlns:w="${W_NS}"/>` : '';

      // Add cantSplit (+ tblHeader for row 0) to row properties
      if (rowMatch.includes('<w:trPr>')) {
        rowMatch = rowMatch.replace(/<w:trPr>([\s\S]*?)<\/w:trPr>/, (m, trInner) => {
          let c = trInner.replace(/<w:cantSplit[^/]*\/>/g, '').replace(/<w:tblHeader[^/]*\/>/g, '');
          return `<w:trPr>${c}${cantSplitXml}${tblHeaderXml}</w:trPr>`;
        });
      } else {
        // Insert trPr after <w:tr...>
        rowMatch = rowMatch.replace(/(<w:tr\b[^>]*>)/, `$1<w:trPr>${cantSplitXml}${tblHeaderXml}</w:trPr>`);
      }

      // Format each cell
      rowMatch = rowMatch.replace(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g, (cellMatch) => {
        // Add/replace cell shading in tcPr
        if (cellMatch.includes('<w:tcPr>')) {
          cellMatch = cellMatch.replace(/<w:tcPr>([\s\S]*?)<\/w:tcPr>/, (m, tcInner) => {
            let c = tcInner.replace(/<w:shd[^/]*\/>/g, '');
            return `<w:tcPr>${c}${shadingXml}</w:tcPr>`;
          });
        } else {
          cellMatch = cellMatch.replace(/(<w:tc\b[^>]*>)/, `$1<w:tcPr>${shadingXml}</w:tcPr>`);
        }

        // Header row: bold white text (9pt; w:sz half-points -- tightened in v5.5.0)
        if (isHeader) {
          cellMatch = cellMatch.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/g, (rprMatch, rprInner) => {
            let c = rprInner
              .replace(/<w:b[^/]*\/>/g, '')
              .replace(/<w:color[^/]*\/>/g, '')
              .replace(/<w:sz[^/]*\/>/g, '');
            return `<w:rPr>${c}<w:b/><w:color w:val="FFFFFF"/><w:sz w:val="18"/></w:rPr>`;
          });
          // Runs without rPr -- add one
          cellMatch = cellMatch.replace(/<w:r>((?:(?!<w:rPr)[\s\S])*?<w:t)/g,
            `<w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="18"/></w:rPr><w:t`);
        } else {
          // Data rows: 8.5pt black text (w:sz 17 half-points -- tightened in v5.5.0)
          cellMatch = cellMatch.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/g, (rprMatch, rprInner) => {
            let c = rprInner
              .replace(/<w:sz[^/]*\/>/g, '')
              .replace(/<w:color[^/]*\/>/g, '');
            return `<w:rPr>${c}<w:sz w:val="17"/><w:color w:val="000000"/></w:rPr>`;
          });
        }

        return cellMatch;
      });

      return rowMatch;
    });

    return tableMatch;
  });

  return xml;
}

/**
 * Center all paragraphs that contain images.
 */
function centerImages(xml) {
  // Find paragraphs containing <wp:inline (image)
  return xml.replace(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g, (pMatch, pInner) => {
    if (!pInner.includes('<wp:inline') && !pInner.includes('wp:inline')) return pMatch;
    const jcCenter = `<w:jc w:val="center"/>`;
    // Add center alignment to pPr
    if (pMatch.includes('<w:pPr>')) {
      return pMatch.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/, (m, pprInner) => {
        let c = pprInner.replace(/<w:jc[^/]*\/>/g, '');
        return `<w:pPr>${c}${jcCenter}</w:pPr>`;
      });
    }
    // Insert pPr after <w:p...>
    return pMatch.replace(/(<w:p\b[^>]*>)/, `$1<w:pPr>${jcCenter}</w:pPr>`);
  });
}

/**
 * Apply heading colors and spacing, driven by style preset.
 */
function formatHeadings(xml, style) {
  const preset = STYLE_PRESETS[style] || STYLE_PRESETS.professional;
  const headingStyles = {
    'Heading1': { color: preset.h1Color, spaceBefore: 360, spaceAfter: 120 },
    'Heading2': { color: preset.h2Color, spaceBefore: 280, spaceAfter: 80 },
    'Heading3': { color: preset.h3Color, spaceBefore: 240, spaceAfter: 80 },
    'Heading4': { color: preset.h4Color, spaceBefore: 200, spaceAfter: 60 },
  };

  return xml.replace(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g, (pMatch, pInner) => {
    // Detect heading style
    const styleMatch = pInner.match(/<w:pStyle\s+w:val="(Heading\d)"/);
    if (!styleMatch) return pMatch;
    const styleName = styleMatch[1];
    const cfg = headingStyles[styleName];
    if (!cfg) return pMatch;

    // Add keepNext, keepLines, spacing to pPr
    const spacingXml = `<w:spacing w:before="${cfg.spaceBefore}" w:after="${cfg.spaceAfter}"/>`;
    const keepNextXml = '<w:keepNext/>';
    const keepLinesXml = '<w:keepLines/>';

    if (pMatch.includes('<w:pPr>')) {
      pMatch = pMatch.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/, (m, pprInner) => {
        let c = pprInner
          .replace(/<w:spacing[^/]*\/>/g, '')
          .replace(/<w:keepNext[^/]*\/>/g, '')
          .replace(/<w:keepLines[^/]*\/>/g, '');
        return `<w:pPr>${c}${spacingXml}${keepNextXml}${keepLinesXml}</w:pPr>`;
      });
    }

    // Set heading color on runs
    pMatch = pMatch.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/g, (rprMatch, rprInner) => {
      let c = rprInner.replace(/<w:color[^/]*\/>/g, '');
      return `<w:rPr>${c}<w:color w:val="${cfg.color}"/></w:rPr>`;
    });

    return pMatch;
  });
}

/**
 * Format code blocks with Consolas font, gray background, border.
 */
function formatCodeBlocks(xml) {
  const codeStyles = ['SourceCode', 'VerbatimChar', 'Code'];

  return xml.replace(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g, (pMatch, pInner) => {
    // Detect code style
    const styleMatch = pInner.match(/<w:pStyle\s+w:val="([^"]+)"/);
    if (!styleMatch) return pMatch;
    const styleName = styleMatch[1];
    const isCode = codeStyles.some(s => styleName.includes(s)) ||
      styleName.toLowerCase().includes('code') ||
      styleName.toLowerCase().includes('verbatim');
    if (!isCode) return pMatch;

    // Paragraph-level: spacing, keep-together, shading, border
    const pShadingXml = `<w:shd w:fill="F5F5F5" w:val="clear"/>`;
    const pBorderXml =
      '<w:pBdr>' +
      '<w:left w:val="single" w:sz="24" w:space="4" w:color="CCCCCC"/>' +
      '<w:top w:val="single" w:sz="4" w:space="1" w:color="E0E0E0"/>' +
      '<w:bottom w:val="single" w:sz="4" w:space="1" w:color="E0E0E0"/>' +
      '<w:right w:val="single" w:sz="4" w:space="1" w:color="E0E0E0"/>' +
      '</w:pBdr>';
    const codeSpacingXml = '<w:spacing w:before="60" w:after="60"/>';
    const keepTogetherXml = '<w:keepLines/>';

    if (pMatch.includes('<w:pPr>')) {
      pMatch = pMatch.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/, (m, pprInner) => {
        let c = pprInner
          .replace(/<w:shd[^/]*\/>/g, '')
          .replace(/<w:pBdr>[\s\S]*?<\/w:pBdr>/g, '')
          .replace(/<w:spacing[^/]*\/>/g, '')
          .replace(/<w:keepLines[^/]*\/>/g, '');
        return `<w:pPr>${c}${pShadingXml}${pBorderXml}${codeSpacingXml}${keepTogetherXml}</w:pPr>`;
      });
    }

    // Run-level: Consolas 9pt dark gray
    pMatch = pMatch.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/g, (rprMatch, rprInner) => {
      let c = rprInner
        .replace(/<w:rFonts[^/]*\/>/g, '')
        .replace(/<w:sz[^/]*\/>/g, '')
        .replace(/<w:color[^/]*\/>/g, '');
      return `<w:rPr>${c}<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/><w:color w:val="1E1E1E"/></w:rPr>`;
    });

    return pMatch;
  });
}

/**
 * Style hyperlinks blue with underline (harvested from first-run failures).
 */
function formatHyperlinks(xml) {
  return xml.replace(/<w:hyperlink[^>]*>[\s\S]*?<\/w:hyperlink>/g, (hlMatch) => {
    // Add blue + underline to existing run properties
    hlMatch = hlMatch.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/g, (_rprMatch, rprInner) => {
      let c = rprInner
        .replace(/<w:color[^/]*\/>/g, '')
        .replace(/<w:u[^/]*\/>/g, '');
      return `<w:rPr>${c}<w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr>`;
    });
    // Runs without rPr inside hyperlinks get styling added
    hlMatch = hlMatch.replace(/<w:r>((?:(?!<w:rPr)[\s\S])*?<w:t)/g,
      '<w:r><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr><w:t');
    return hlMatch;
  });
}

/**
 * Keep table/figure captions attached to the content that follows.
 * Detects paragraphs starting with "Table N" or "Figure N" and adds:
 * - keepNext (prevent caption orphans)
 * - Centered alignment
 * - Italic 9pt styling on run properties
 */
function keepCaptionsWithContent(xml) {
  return xml.replace(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g, (pMatch, pInner) => {
    // Extract text content from runs
    const textParts = [];
    pInner.replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, (_m, t) => { textParts.push(t); });
    const textContent = textParts.join('').trim();
    if (!/^(Table|Figure)\s+\d/.test(textContent)) return pMatch;

    // Paragraph properties: keepNext + centered + italic 9pt
    const captionPPr = [
      `<w:keepNext xmlns:w="${W_NS}"/>`,
      `<w:jc xmlns:w="${W_NS}" w:val="center"/>`,
      `<w:rPr><w:i xmlns:w="${W_NS}"/><w:sz xmlns:w="${W_NS}" w:val="18"/><w:color xmlns:w="${W_NS}" w:val="595959"/></w:rPr>`,
    ].join('');

    // Inject paragraph-level caption styling
    let result = pMatch;
    if (result.includes('<w:pPr>')) {
      result = result.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/, (_m, inner) => {
        let props = inner;
        if (!props.includes('<w:keepNext')) props += `<w:keepNext xmlns:w="${W_NS}"/>`;
        if (!props.includes('<w:jc')) props += `<w:jc xmlns:w="${W_NS}" w:val="center"/>`;
        return `<w:pPr>${props}</w:pPr>`;
      });
    } else {
      result = result.replace(/(<w:p\b[^>]*>)/, `$1<w:pPr>${captionPPr}</w:pPr>`);
    }

    // Apply italic + 9pt + gray to every run in the caption
    result = result.replace(/<w:r>([\s\S]*?)<\/w:r>/g, (rMatch, rInner) => {
      if (rInner.includes('<w:rPr>')) {
        return rMatch.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/, (_m, rprInner) => {
          let rpr = rprInner;
          if (!rpr.includes('<w:i')) rpr += `<w:i xmlns:w="${W_NS}"/>`;
          if (!rpr.includes('<w:sz')) rpr += `<w:sz xmlns:w="${W_NS}" w:val="18"/>`;
          if (!rpr.includes('<w:color')) rpr += `<w:color xmlns:w="${W_NS}" w:val="595959"/>`;
          return `<w:rPr>${rpr}</w:rPr>`;
        });
      }
      const captionRPr = `<w:rPr><w:i xmlns:w="${W_NS}"/><w:sz xmlns:w="${W_NS}" w:val="18"/><w:color xmlns:w="${W_NS}" w:val="595959"/></w:rPr>`;
      return rMatch.replace(/<w:r>/, `<w:r>${captionRPr}`);
    });

    return result;
  });
}

/**
 * Fix paragraph spacing -- widow/orphan control, list spacing.
 */
function fixParagraphSpacing(xml, style) {
  const preset = STYLE_PRESETS[style] || STYLE_PRESETS.professional;
  return xml.replace(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g, (pMatch, pInner) => {
    const styleMatch = pInner.match(/<w:pStyle\s+w:val="([^"]+)"/);
    const styleName = styleMatch ? styleMatch[1] : '';

    // Skip empty paragraphs
    if (!pInner.includes('<w:t')) return pMatch;

    // Determine spacing
    let widowControlXml = '<w:widowControl/>';
    let spacingXml = '';

    const lineSpacing = `w:line="${preset.lineHeight}" w:lineRule="auto"`;

    if (styleName.includes('List')) {
      spacingXml = `<w:spacing w:before="40" w:after="40" ${lineSpacing}/>`;
    } else if (styleName === 'Normal' || styleName === 'BodyText' || styleName === '') {
      spacingXml = `<w:spacing w:before="120" w:after="120" ${lineSpacing}/>`;
    }

    // Skip headings and code (already handled)
    if (styleName.startsWith('Heading') || styleName.includes('Code') ||
      styleName.includes('Source') || styleName.includes('Verbatim')) {
      return pMatch;
    }

    if (pMatch.includes('<w:pPr>')) {
      pMatch = pMatch.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/, (m, pprInner) => {
        let c = pprInner.replace(/<w:widowControl[^/]*\/>/g, '');
        if (spacingXml && !pprInner.includes('<w:spacing')) {
          c += spacingXml;
        }
        return `<w:pPr>${c}${widowControlXml}</w:pPr>`;
      });
    }

    return pMatch;
  });
}

/**
 * Set default body font and spacing in document defaults, driven by style preset.
 */
function setDocumentDefaults(xml, style) {
  const preset = STYLE_PRESETS[style] || STYLE_PRESETS.professional;
  const rPrDefault =
    '<w:rPrDefault><w:rPr xmlns:w="' + W_NS + '">' +
    `<w:rFonts w:ascii="${preset.bodyFont}" w:hAnsi="${preset.bodyFont}" w:cs="${preset.bodyFont}"/>` +
    `<w:sz w:val="${preset.bodySize}"/><w:szCs w:val="${preset.bodySize}"/>` +
    `<w:color w:val="${preset.bodyColor}"/>` +
    '</w:rPr></w:rPrDefault>';
  const pPrDefault =
    '<w:pPrDefault><w:pPr xmlns:w="' + W_NS + '">' +
    `<w:spacing w:after="120" w:line="${preset.lineHeight}" w:lineRule="auto"/>` +
    '</w:pPr></w:pPrDefault>';
  const defaults = `<w:docDefaults>${rPrDefault}${pPrDefault}</w:docDefaults>`;

  // Replace existing docDefaults or insert into w:styles
  if (xml.includes('<w:docDefaults>')) {
    xml = xml.replace(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/, defaults);
  } else if (xml.includes('<w:styles')) {
    xml = xml.replace(/(<w:styles[^>]*>)/, `$1${defaults}`);
  }
  return xml;
}

/**
 * Prevent tables from splitting across pages when they fit on one page.
 * Adds keepNext to all rows except the last, so the table stays together.
 */
function keepTablesIntact(xml) {
  return xml.replace(/<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g, (tableMatch) => {
    // Count rows
    const rows = tableMatch.match(/<w:tr\b/g) || [];
    if (rows.length <= 1) return tableMatch;

    // Add keepNext to all rows except the last to keep table together
    let rowIdx = 0;
    const totalRows = rows.length;
    tableMatch = tableMatch.replace(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g, (rowMatch) => {
      const isLast = ++rowIdx === totalRows;
      if (isLast) return rowMatch;

      const keepNextXml = `<w:keepNext xmlns:w="${W_NS}"/>`;
      // Add to trPr > first paragraph pPr, or to each paragraph pPr
      rowMatch = rowMatch.replace(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g, (pMatch) => {
        if (pMatch.includes('<w:pPr>')) {
          return pMatch.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/, (m, inner) => {
            if (inner.includes('<w:keepNext')) return m;
            return `<w:pPr>${inner}${keepNextXml}</w:pPr>`;
          });
        }
        return pMatch.replace(/(<w:p\b[^>]*>)/, `$1<w:pPr>${keepNextXml}</w:pPr>`);
      });
      return rowMatch;
    });
    return tableMatch;
  });
}

/**
 * Apply all OOXML formatting passes to document.xml content.
 */
function applyAllFormatting(xml, options) {
  const style = options.style || 'professional';
  if (!options.noFormatTables) {
    xml = formatTables(xml);
    xml = keepTablesIntact(xml);
  }
  xml = centerImages(xml);
  xml = formatHeadings(xml, style);
  xml = formatCodeBlocks(xml);
  xml = formatHyperlinks(xml);
  xml = keepCaptionsWithContent(xml);
  xml = fixParagraphSpacing(xml, style);
  return xml;
}

// ---------------------------------------------------------------------------
// Page Number Footer (harvested from AIRS defence/exports pipeline)
// ---------------------------------------------------------------------------

/**
 * Add centered page number footer to docx package.
 * Creates footer1.xml, adds relationship, updates content types,
 * and injects footer reference into the document section properties.
 */
async function addPageNumberFooter(zip) {
  // 1. Create footer1.xml
  const footerXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
    '       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    '  <w:p>',
    '    <w:pPr>',
    '      <w:jc w:val="center"/>',
    '    </w:pPr>',
    '    <w:r>',
    '      <w:rPr><w:sz w:val="18"/><w:color w:val="888888"/></w:rPr>',
    '      <w:fldChar w:fldCharType="begin"/>',
    '    </w:r>',
    '    <w:r>',
    '      <w:rPr><w:sz w:val="18"/><w:color w:val="888888"/></w:rPr>',
    '      <w:instrText xml:space="preserve"> PAGE </w:instrText>',
    '    </w:r>',
    '    <w:r>',
    '      <w:rPr><w:sz w:val="18"/><w:color w:val="888888"/></w:rPr>',
    '      <w:fldChar w:fldCharType="end"/>',
    '    </w:r>',
    '  </w:p>',
    '</w:ftr>'
  ].join('\n');
  zip.file('word/footer1.xml', footerXml);

  // 2. Add relationship to document.xml.rels
  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (!relsFile) return null;

  let relsXml = await relsFile.async('string');
  const rIdMatches = relsXml.match(/Id="rId(\d+)"/g) || [];
  const maxId = rIdMatches.reduce((max, m) => {
    const n = parseInt(m.match(/\d+/)[0], 10);
    return n > max ? n : max;
  }, 0);
  const footerRId = `rId${maxId + 1}`;

  relsXml = relsXml.replace('</Relationships>',
    `<Relationship Id="${footerRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>\n</Relationships>`);
  zip.file('word/_rels/document.xml.rels', relsXml);

  // 3. Update [Content_Types].xml
  const ctFile = zip.file('[Content_Types].xml');
  if (ctFile) {
    let ctXml = await ctFile.async('string');
    if (!ctXml.includes('footer1.xml')) {
      ctXml = ctXml.replace('</Types>',
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>\n</Types>');
      zip.file('[Content_Types].xml', ctXml);
    }
  }

  return footerRId;
}

/**
 * Insert footer reference into the document's section properties.
 */
function addFooterRefToSectionProps(docXml, footerRId) {
  const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const footerRef = `<w:footerReference xmlns:w="${W_NS}" xmlns:r="${R_NS}" w:type="default" r:id="${footerRId}"/>`;

  // Find sectPr (section properties) -- usually near the end of body
  if (docXml.includes('<w:sectPr')) {
    docXml = docXml.replace(/<w:sectPr([^>]*)>/, (m, attrs) => {
      return `<w:sectPr${attrs}>${footerRef}`;
    });
  }
  return docXml;
}

// ---------------------------------------------------------------------------
// DOCX Post-Processing via JSZip
// ---------------------------------------------------------------------------
async function postProcessDocx(docxPath, options) {
  if (!JSZip) {
    console.log('[WARN] Skipping post-processing (jszip not available)');
    return;
  }

  const data = fs.readFileSync(docxPath);
  const zip = await JSZip.loadAsync(data);

  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) {
    console.log('[WARN] No word/document.xml found in docx -- skipping post-processing');
    return;
  }

  let docXml = await docXmlFile.async('string');
  docXml = applyAllFormatting(docXml, options);

  // Add page number footer
  const footerRId = await addPageNumberFooter(zip);
  if (footerRId) {
    docXml = addFooterRefToSectionProps(docXml, footerRId);
  }

  zip.file('word/document.xml', docXml);

  // Apply document defaults (font, line spacing) to styles.xml
  const stylesFile = zip.file('word/styles.xml');
  if (stylesFile) {
    let stylesXml = await stylesFile.async('string');
    stylesXml = setDocumentDefaults(stylesXml, options.style || 'professional');
    zip.file('word/styles.xml', stylesXml);
  }

  const result = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
  fs.writeFileSync(docxPath, result);
}

// ---------------------------------------------------------------------------
// Style Presets (harvested from VT build-pdf.js + AlexBooks + AIRS)
// ---------------------------------------------------------------------------
const STYLE_PRESETS = {
  professional: {
    bodyFont: 'Segoe UI', bodySize: '21', headingColor: '0078D4',
    lineHeight: '312', bodyColor: '1F2328',
    h1Color: '0078D4', h2Color: '2B579A', h3Color: '3B3B3B', h4Color: '555555',
    margins: { top: '1440', right: '1440', bottom: '1440', left: '1440' }
  },
  academic: {
    bodyFont: 'Times New Roman', bodySize: '24', headingColor: '1A1A2E',
    lineHeight: '480', bodyColor: '000000',
    h1Color: '1A1A2E', h2Color: '2D2D44', h3Color: '3B3B3B', h4Color: '555555',
    margins: { top: '1440', right: '1440', bottom: '1440', left: '1440' }
  },
  course: {
    bodyFont: 'Calibri', bodySize: '22', headingColor: '861F41',
    lineHeight: '360', bodyColor: '333333',
    h1Color: '861F41', h2Color: 'E87722', h3Color: '3B3B3B', h4Color: '555555',
    margins: { top: '1296', right: '1152', bottom: '1296', left: '1152' }
  },
  creative: {
    bodyFont: 'Georgia', bodySize: '22', headingColor: '2C3E50',
    lineHeight: '336', bodyColor: '2C3E50',
    h1Color: '2C3E50', h2Color: '8E44AD', h3Color: '2980B9', h4Color: '555555',
    margins: { top: '1440', right: '1584', bottom: '1440', left: '1584' }
  }
};

// ---------------------------------------------------------------------------
// CLI Argument Parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = argv.slice(2);
  const result = {
    source: null,
    output: null,
    imagesDir: 'images',
    noFormatTables: false,
    keepTemp: false,
    toc: false,
    cover: false,
    pageSize: 'letter',
    style: 'professional',
    referenceDoc: null,
    watch: false,
    luaFilter: null,
    debug: false,
    embedImages: false,
    stripFrontmatter: false,
    recursive: false,
    dryRun: false,
    noDefaultPalette: false,
    replaceEmDashes: true,
    stripDecorativeRules: true
  };

  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--no-format-tables') {
      result.noFormatTables = true;
    } else if (args[i] === '--keep-temp') {
      result.keepTemp = true;
    } else if (args[i] === '--toc') {
      result.toc = true;
    } else if (args[i] === '--no-replace-em-dashes') {
      result.replaceEmDashes = false;
    } else if (args[i] === '--no-strip-decorative-rules') {
      result.stripDecorativeRules = false;
    } else if (args[i] === '--cover') {
      result.cover = true;
    } else if (args[i] === '--no-cover') {
      result.cover = false;
    } else if (args[i] === '--page-size' && i + 1 < args.length) {
      const size = args[++i].toLowerCase();
      if (['letter', 'a4', '6x9'].includes(size)) {
        result.pageSize = size;
      } else {
        console.warn(`[!]  Unknown page size "${size}" -- using letter`);
      }
    } else if (args[i] === '--style' && i + 1 < args.length) {
      const style = args[++i].toLowerCase();
      if (STYLE_PRESETS[style]) {
        result.style = style;
      } else {
        console.warn(`[!]  Unknown style "${style}" -- using professional. Available: ${Object.keys(STYLE_PRESETS).join(', ')}`);
      }
    } else if (args[i] === '--reference-doc' && i + 1 < args.length) {
      result.referenceDoc = args[++i];
    } else if (args[i] === '--watch') {
      result.watch = true;
    } else if (args[i] === '--lua-filter' && i + 1 < args.length) {
      result.luaFilter = args[++i];
    } else if (args[i] === '--debug') {
      result.debug = true;
    } else if (args[i] === '--images-dir' && i + 1 < args.length) {
      result.imagesDir = args[++i];
    } else if (args[i] === '--embed-images') {
      result.embedImages = true;
    } else if (args[i] === '--strip-frontmatter') {
      result.stripFrontmatter = true;
    } else if (args[i] === '--recursive') {
      result.recursive = true;
    } else if (args[i] === '--dry-run') {
      result.dryRun = true;
    } else if (args[i] === '--no-default-palette') {
      result.noDefaultPalette = true;
    } else if (!args[i].startsWith('--')) {
      positional.push(args[i]);
    }
  }

  if (positional.length === 0) {
    console.error('Usage: node md-to-word.cjs SOURCE.md [OUTPUT.docx] [options]');
    console.error('  Options: --toc --cover --page-size letter|a4|6x9 --style professional|academic|course|creative');
    console.error('           --reference-doc PATH --watch --lua-filter PATH --debug --no-format-tables --keep-temp');
    console.error('           --embed-images --strip-frontmatter --recursive --dry-run --no-default-palette');
    process.exit(1);
  }

  result.source = positional[0];
  result.output = positional[1] || positional[0].replace(/\.md$/i, '.docx');
  return result;
}

// ---------------------------------------------------------------------------
// Build (single conversion run)
// ---------------------------------------------------------------------------
async function build(args) {
  const sourcePath = path.resolve(args.source);
  if (!fs.existsSync(sourcePath)) {
    console.error(`ERROR: Source file not found: ${sourcePath}`);
    process.exit(1);
  }

  const outputPath = path.resolve(args.output);
  const sourceDir = path.dirname(sourcePath);
  const imagesDir = path.join(sourceDir, args.imagesDir);

  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }

  // Use os.tmpdir for temp files (proper cleanup)
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-to-word-'));
  process.on('exit', () => { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  console.log(`\u{1f4c4} Converting ${sourcePath} \u2192 ${outputPath}`);
  if (args.toc) console.log('   \u{1f4d1} Table of Contents: enabled');
  if (args.cover) console.log('   \u{1f4d8} Cover page: enabled');
  if (args.style !== 'professional') console.log(`   \u{1f3a8} Style: ${args.style}`);
  if (args.pageSize !== 'letter') console.log(`   \u{1f4cf} Page size: ${args.pageSize}`);
  if (args.referenceDoc) console.log(`   \u{1f4c4} Reference doc: ${args.referenceDoc}`);

  try {
    // Phase 0: Preprocess markdown
    let content = fs.readFileSync(sourcePath, 'utf8');
    console.log('\u{1f527} Preprocessing markdown...');

    // Strip YAML frontmatter if requested
    if (args.stripFrontmatter) {
      const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
      if (fmMatch) {
        content = content.slice(fmMatch[0].length);
        console.log('   \u{1f4cb} YAML frontmatter stripped');
      }
    }

    content = preprocessMarkdown(content, {
      format: 'docx',
      replaceEmDashes: args.replaceEmDashes,
      stripDecorativeRules: args.stripDecorativeRules
    });

    // [toc] marker handling (v5.5.0): strip the marker line, but DO NOT auto-enable TOC.
    // The documented default is `--toc off`; respecting [toc] silently as auto-on contradicts
    // that contract. Warn the heir so they can either add --toc explicitly or remove the marker.
    const tocResult = detectTocMarker(content);
    content = tocResult.content;
    if (tocResult.hasTocMarker && !args.toc) {
      console.warn(`   \u26a0\ufe0f  [toc] marker found in ${path.basename(sourcePath)} but --toc was not passed; marker stripped, TOC not generated. Pass --toc to enable.`);
    } else if (tocResult.hasTocMarker && args.toc) {
      console.log('   \u{1f4d1} [toc] marker detected and --toc set -- generating Table of Contents');
    }

    // Validate heading hierarchy
    const headingResult = validateHeadingHierarchy(content);
    if (!headingResult.valid) {
      console.log('   \u{1f4da} Heading hierarchy warnings:');
      headingResult.warnings.forEach(w => console.log(`   \u26a0\ufe0f  ${w}`));
    }

    // Embed local images as base64 data URIs (prevents broken image references)
    if (args.embedImages) {
      const beforeLen = content.length;
      content = embedLocalImages(content, sourceDir);
      if (content.length !== beforeLen) {
        console.log(`   \u{1f5bc}\ufe0f  Embedded image(s) as base64`);
      }
    }

    // Validate links (check for broken local file references)
    const linkResult = validateLinks(content, sourceDir);
    if (!linkResult.valid) {
      console.log('   \u{1f517} Link warnings:');
      linkResult.warnings.forEach(w => console.log(`   \u26a0\ufe0f  ${w}`));
    }

    // Dry-run mode: report preprocessing results and exit without generating .docx
    if (args.dryRun) {
      console.log('\n\u{1f50d} Dry-run complete (no .docx generated)');
      console.log(`   Source: ${sourcePath} (${(fs.statSync(sourcePath).size / 1024).toFixed(1)} KB)`);
      console.log(`   Output would be: ${outputPath}`);
      return;
    }

    // Phase 0.5: Generate cover page from H1 + metadata
    if (args.cover) {
      const h1Match = content.match(/^#\s+(.+)$/m);
      const title = h1Match ? h1Match[1].trim() : path.basename(sourcePath, '.md');
      const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      const coverMd = [
        '',
        '<div style="text-align: center; padding-top: 3in;">',
        '',
        `# ${title}`,
        '',
        `*${dateStr}*`,
        '',
        '</div>',
        '',
        '\\newpage',
        '',
      ].join('\n');
      content = coverMd + content;
      console.log('   \u{1f4d8} Cover page generated');
    }

    // Phase 1: Find and convert Mermaid diagrams
    const mermaidBlocks = findMermaidBlocks(content);
    console.log(`\u{1f4ca} Found ${mermaidBlocks.length} Mermaid diagrams`);

    // Pre-validate Mermaid syntax before expensive rendering
    const validTypes = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|sankey|xychart|block|C4Context|C4Container|C4Deployment|C4Dynamic|C4Component|zenuml|packet|architecture|kanban)/;
    for (const block of mermaidBlocks) {
      // Skip %%{init}%% directives, comments, and blank lines to find the actual diagram type
      const lines = block.content.trim().split(/\r?\n/);
      const typeLine = lines.find(l => {
        const t = l.trim();
        return t && !t.startsWith('%%') && !t.startsWith('%% ');
      }) || '';
      if (!validTypes.test(typeLine.trim())) {
        console.warn(`   \u26a0\ufe0f  Diagram ${block.index + 1}: unrecognized diagram type: "${typeLine.trim().slice(0, 40)}"`);
      }
    }

    // Phase 1b: Analyze each block for styling, emit lint warnings, and
    // inject a default pastel palette when the author has not styled the
    // diagram. Sequence and stateDiagram-v2 always benefit (classDef does
    // not apply); flowcharts only get injection when classDef is absent.
    let injectedCount = 0;
    let lintCount = 0;
    for (const block of mermaidBlocks) {
      const analysis = analyzeMermaid(block.content);

      // Lint: flowchart with no classDef and no init -> will render flat
      if (analysis.diagramType === 'flowchart' &&
        !analysis.hasClassDef &&
        !analysis.hasInitDirective &&
        !analysis.hasExplicitTheme) {
        if (args.noDefaultPalette) {
          console.warn(`   \u26a0\ufe0f  Diagram ${block.index + 1} has no classDef and --no-default-palette is set; will render with neutral palette.`);
        } else {
          console.warn(`   \u{1f4a1} Diagram ${block.index + 1} (flowchart) has no classDef; injecting default pastel palette. Author classDef to override, or pass --no-default-palette to disable.`);
        }
        lintCount++;
      }

      // Lint: sequence/state without explicit theme -> would default to neutral
      if ((analysis.diagramType === 'sequence' || analysis.diagramType === 'state') &&
        !analysis.hasInitDirective &&
        !analysis.hasExplicitTheme &&
        args.noDefaultPalette) {
        console.warn(`   \u26a0\ufe0f  Diagram ${block.index + 1} (${analysis.diagramType}) has no theme variables and --no-default-palette is set; will render with default theme.`);
        lintCount++;
      }

      // Inject default palette unless opted out
      if (!args.noDefaultPalette) {
        const before = block.content;
        block.content = injectPalette(block.content, { analysis });
        if (block.content !== before) injectedCount++;
      }
    }
    if (injectedCount > 0) {
      console.log(`   \u{1f3a8} Injected default pastel palette into ${injectedCount} of ${mermaidBlocks.length} diagram(s)`);
    }
    if (lintCount > 0 && !args.noDefaultPalette) {
      // Already nudged inline; no roll-up warning needed beyond the count.
    }

    const replacements = [];
    for (const block of mermaidBlocks) {
      const pngName = `diagram-${block.index + 1}.png`;
      const pngPath = path.join(imagesDir, pngName);
      process.stdout.write(`   Converting diagram ${block.index + 1}... `);

      if (convertMermaidToPng(block.content, pngPath)) {
        const size = calculateOptimalSize(pngPath, block.content);
        replacements.push(`![Diagram ${block.index + 1}](${args.imagesDir}/${pngName})${size}`);
        console.log(`\u2713 ${size}`);
      } else {
        console.log('\u2717 (failed)');
        replacements.push(`![Diagram ${block.index + 1}](${args.imagesDir}/${pngName})`);
      }
    }

    // Phase 2: Convert SVG references to PNG
    const svgPattern = /!\[([^\]]*)\]\(([^)]+\.svg)\)/g;
    let svgMatch;
    while ((svgMatch = svgPattern.exec(content)) !== null) {
      const [fullMatch, altText, svgRelPath] = svgMatch;
      const svgPath = path.join(sourceDir, svgRelPath);

      if (fs.existsSync(svgPath)) {
        const pngName = path.basename(svgPath, '.svg') + '.png';
        const pngPath = path.join(imagesDir, pngName);

        if (!fs.existsSync(pngPath)) {
          process.stdout.write(`\u{1f5bc}\ufe0f  Converting SVG: ${path.basename(svgPath)}... `);
          if (convertSvgToPng(svgPath, pngPath)) {
            console.log('\u2713');
          } else {
            console.log('\u2717');
          }
        }

        const svgSize = fs.existsSync(pngPath) ? calculateOptimalSize(pngPath, '') : `{width=${MAX_IMAGE_WIDTH.toFixed(1)}in}`;
        const newRef = `![${altText}](${args.imagesDir}/${pngName})${svgSize}`;
        content = content.replace(fullMatch, newRef);
      }
    }

    // Phase 2b: Convert HTML <img src="...svg"> tags to PNG
    const htmlImgSvgPattern = /<img\s+[^>]*src=["']([^"']+\.svg)["'][^>]*\/?>/gi;
    let htmlSvgMatch;
    while ((htmlSvgMatch = htmlImgSvgPattern.exec(content)) !== null) {
      const [fullTag, svgRelPath] = htmlSvgMatch;
      const svgPath = path.join(sourceDir, svgRelPath);

      if (fs.existsSync(svgPath)) {
        const pngName = path.basename(svgPath, '.svg') + '.png';
        const pngPath = path.join(imagesDir, pngName);

        if (!fs.existsSync(pngPath)) {
          process.stdout.write(`\u{1f5bc}\ufe0f  Converting SVG (HTML img): ${path.basename(svgPath)}... `);
          if (convertSvgToPng(svgPath, pngPath)) {
            console.log('\u2713');
          } else {
            console.log('\u2717');
          }
        }

        // Extract alt text from tag if present
        const altMatch = fullTag.match(/alt=["']([^"']*)["']/i);
        const altText = altMatch ? altMatch[1] : path.basename(svgPath, '.svg');
        const imgSize = fs.existsSync(pngPath) ? calculateOptimalSize(pngPath, '') : `{width=${MAX_IMAGE_WIDTH.toFixed(1)}in}`;
        const newRef = `![${altText}](${args.imagesDir}/${pngName})${imgSize}`;
        content = content.replace(fullTag, newRef);
      }
    }

    // Phase 3: Replace mermaid blocks with image references
    const mermaidPattern = /```mermaid\r?\n[\s\S]*?```/;
    for (const replacement of replacements) {
      content = content.replace(mermaidPattern, replacement);
    }

    // Save debug output (combined preprocessed markdown)
    if (args.debug) {
      const debugPath = path.join(sourceDir, '_debug_combined.md');
      fs.writeFileSync(debugPath, content, 'utf8');
      console.log(`\u{1f50d} Debug: saved preprocessed markdown to ${debugPath}`);
    }

    // Write temporary markdown to temp dir
    const tempMd = path.join(tempDir, '_temp_word.md');
    fs.writeFileSync(tempMd, content, 'utf8');

    // Phase 4: Convert to Word with pandoc
    console.log('\u{1f4dd} Generating Word document...');
    const resourcePath = path.resolve(sourceDir);

    // Build pandoc command with options
    const pandocArgs = [
      tempMd,
      '-o', outputPath,
      '--from', 'markdown',
      '--to', 'docx',
      '--dpi=300',
      '--resource-path', resourcePath
    ];
    if (args.toc) pandocArgs.push('--toc', '--toc-depth=3');
    if (args.referenceDoc) {
      const refDocPath = path.resolve(args.referenceDoc);
      if (fs.existsSync(refDocPath)) {
        pandocArgs.push('--reference-doc', refDocPath);
      } else {
        console.warn(`[!]  Reference doc not found: ${refDocPath} -- using default`);
      }
    }
    if (args.luaFilter) {
      const filterPath = path.resolve(args.luaFilter);
      if (fs.existsSync(filterPath)) {
        pandocArgs.push('--lua-filter', filterPath);
      } else {
        console.warn(`[!]  Lua filter not found: ${filterPath} -- skipping`);
      }
    }

    // NOTE: Page size is applied via OOXML post-processing, not pandoc variables.
    // The -V geometry:* flags only work for LaTeX output, not docx.

    // Write built-in centering Lua filter to temp
    const centerLuaPath = path.join(tempDir, '_center-images.lua');
    fs.writeFileSync(centerLuaPath, CENTER_IMAGES_LUA, 'utf8');
    pandocArgs.push('--lua-filter', centerLuaPath);

    try {
      runTool('pandoc', pandocArgs, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 120000 });
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString() : String(err);
      console.error(`ERROR: pandoc failed: ${stderr}`);
      process.exit(1);
    }

    // Phase 5: Apply OOXML formatting
    console.log('\u{1f3a8} Applying formatting...');
    await postProcessDocx(outputPath, {
      noFormatTables: args.noFormatTables,
      pageSize: args.pageSize,
      style: args.style
    });

    // Phase 6: Output validation
    const stats = fs.statSync(outputPath);
    const sizeKB = stats.size / 1024;
    if (sizeKB < 5) {
      console.warn(`\u26a0\ufe0f  Output file is only ${sizeKB.toFixed(1)} KB -- may be corrupt or empty`);
    }
    console.log(`\u2705 Done! Output: ${outputPath}`);
    console.log(`   Size: ${sizeKB.toFixed(1)} KB`);
    if (args.toc) console.log('   \u{1f4d1} Update TOC: Open in Word \u2192 right-click TOC \u2192 Update Field');
  } finally {
    // Cleanup temp directory
    if (!args.keepTemp) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    } else {
      console.log(`   \u{1f4c2} Temp files kept at: ${tempDir}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main (with watch mode support)
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv);

  // Recursive batch mode: find all .md files in a directory tree
  if (args.recursive) {
    const sourceDir = path.resolve(args.source);
    if (!fs.statSync(sourceDir).isDirectory()) {
      console.error('--recursive requires source to be a directory');
      process.exit(1);
    }
    const mdFiles = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          mdFiles.push(full);
        }
      }
    };
    walk(sourceDir);
    console.log(`\u{1f4c2} Recursive mode: found ${mdFiles.length} markdown files in ${sourceDir}`);
    let succeeded = 0, failed = 0;
    for (const mdFile of mdFiles) {
      const relPath = path.relative(sourceDir, mdFile);
      const outFile = mdFile.replace(/\.md$/i, '.docx');
      const batchArgs = { ...args, source: mdFile, output: outFile, recursive: false };
      console.log(`\n--- [${succeeded + failed + 1}/${mdFiles.length}] ${relPath} ---`);
      try {
        await build(batchArgs);
        succeeded++;
      } catch (err) {
        console.error(`\u274c Failed: ${err.message || err}`);
        failed++;
      }
    }
    console.log(`\n\u{1f4ca} Batch complete: ${succeeded} succeeded, ${failed} failed out of ${mdFiles.length}`);
    return;
  }

  // Run initial build
  await build(args);

  // Watch mode: monitor source for changes and auto-rebuild
  if (args.watch) {
    const sourcePath = path.resolve(args.source);
    console.log(`\n\u{1f440} Watching ${sourcePath} for changes... (Ctrl+C to stop)`);
    let debounceTimer = null;
    let building = false;

    fs.watch(sourcePath, { persistent: true }, (_eventType) => {
      if (building) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        building = true;
        console.log(`\n\u{1f504} Change detected, rebuilding...`);
        try {
          await build(args);
        } catch (err) {
          console.error(`\u274c Rebuild failed: ${err.message || err}`);
        }
        building = false;
      }, 500);
    });

    // Keep process alive
    process.on('SIGINT', () => {
      console.log('\n\u{1f44b} Watch mode stopped.');
      process.exit(0);
    });
  }
}

main().catch(err => {
  console.error(`FATAL: ${err.message || err}`);
  process.exit(1);
});
