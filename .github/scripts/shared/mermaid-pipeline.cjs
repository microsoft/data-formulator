/**
 * shared/mermaid-pipeline.cjs - Shared Mermaid diagram rendering pipeline
 *
 * Extracted from md-to-word.cjs and designed for reuse across all converters.
 * Supports format-aware scaling, palette injection, and syntax validation.
 *
 * Usage:
 *   const { findMermaidBlocks, renderMermaid, injectPalette } = require('./shared/mermaid-pipeline.cjs');
 *   const blocks = findMermaidBlocks(markdownContent);
 *   for (const block of blocks) {
 *     await renderMermaid(block.content, 'output.png', { scale: 8, width: 2400 });
 *   }
 * @inheritance inheritable
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { runTool } = require('./tool-runner.cjs');

// Default scale per output format (harvested from AlexBooks/AIRS patterns)
const FORMAT_SCALES = {
  docx: { scale: 8, width: 2400 },
  pdf: { scale: 8, width: 2400 },
  epub: { scale: 2, width: 800 },
  html: { scale: 3, width: 1200 },
  email: { scale: 2, width: 600 },
};

// GitHub Pastel v2 palette (aligned with markdown-mermaid skill)
const BRAND_PALETTE = {
  blue: '#ddf4ff',       // Primary - trust, reliability
  green: '#d3f5db',      // Success, growth
  purple: '#d8b9ff',     // Consciousness, identity
  gold: '#fff8c5',       // Warnings, attention
  bronze: '#fff1e5',     // Connection, memory
  red: '#ffebe9',        // Errors, critical
  neutral: '#eaeef2',    // Muted, secondary
  textDark: '#1f2328',   // Primary text
  lineColor: '#57606a',  // Arrows, edges
  edgeLabelBg: '#ffffff' // CRITICAL: white background for edge labels
};

/**
 * Find all fenced Mermaid code blocks in markdown content.
 * Returns: [{ index, content, raw }]
 */
function findMermaidBlocks(content) {
  const pattern = /```mermaid\r?\n([\s\S]*?)```/g;
  const blocks = [];
  let m;
  while ((m = pattern.exec(content)) !== null) {
    blocks.push({ index: blocks.length, content: m[1], raw: m[0] });
  }
  return blocks;
}

/**
 * Analyze a Mermaid block: diagram type, presence of classDef, init directive,
 * explicit theme overrides. Used to decide whether to inject defaults and to
 * emit lint warnings for unstyled diagrams.
 *
 * Returns: { diagramType, hasClassDef, hasInitDirective, hasExplicitTheme, supportsClassDef }
 */
function analyzeMermaid(mmdContent) {
  const hasInitDirective = /%%\{\s*init/.test(mmdContent);
  const hasClassDef = /^[ \t]*classDef\s+/m.test(mmdContent);
  // Detect any common per-type theme variable that would indicate the author
  // already styled the diagram explicitly (don't override).
  const hasExplicitTheme = /\b(actorBkg|actorTextColor|noteBkgColor|signalColor|labelBoxBkgColor|primaryColor|secondaryColor|tertiaryColor)\b/.test(mmdContent);

  // First non-comment, non-init line is the diagram type
  const lines = mmdContent.trim().split(/\r?\n/);
  const typeLine = lines.find(l => {
    const t = l.trim();
    return t && !t.startsWith('%%');
  }) || '';
  const lower = typeLine.trim().toLowerCase();

  let diagramType = 'unknown';
  if (lower.startsWith('flowchart') || lower.startsWith('graph')) diagramType = 'flowchart';
  else if (lower.startsWith('sequencediagram')) diagramType = 'sequence';
  else if (lower.startsWith('statediagram-v2')) diagramType = 'state';
  else if (lower.startsWith('statediagram')) diagramType = 'state';
  else if (lower.startsWith('classdiagram')) diagramType = 'class';
  else if (lower.startsWith('erdiagram')) diagramType = 'er';
  else if (lower.startsWith('gantt')) diagramType = 'gantt';
  else if (lower.startsWith('pie')) diagramType = 'pie';
  else if (lower.startsWith('journey')) diagramType = 'journey';
  else if (lower.startsWith('gitgraph')) diagramType = 'gitgraph';
  else if (lower.startsWith('mindmap')) diagramType = 'mindmap';
  else if (lower.startsWith('timeline')) diagramType = 'timeline';
  else if (lower.startsWith('quadrantchart')) diagramType = 'quadrant';

  // classDef applies cleanly only to flowchart/graph and (partially) classDiagram.
  // sequence and state diagrams ignore classDef -- they need themeVariables.
  const supportsClassDef = diagramType === 'flowchart' || diagramType === 'class';

  return { diagramType, hasClassDef, hasInitDirective, hasExplicitTheme, supportsClassDef };
}

/**
 * Build a per-diagram-type themeVariables object from a palette.
 * Sequence and stateDiagram-v2 ignore classDef, so theme variables are
 * the only path to consistent colors for those types.
 */
function _buildThemeVars(diagramType, palette) {
  const text = palette.textDark;
  const line = palette.lineColor || palette.textDark;
  const edgeBg = palette.edgeLabelBg || '#ffffff';

  switch (diagramType) {
    case 'sequence':
      return {
        primaryColor: palette.blue,
        primaryTextColor: text,
        primaryBorderColor: line,
        lineColor: line,
        actorBkg: palette.blue,
        actorTextColor: text,
        actorLineColor: line,
        signalColor: line,
        signalTextColor: text,
        noteBkgColor: palette.gold,
        noteTextColor: text,
        noteBorderColor: line,
        labelBoxBkgColor: palette.neutral || palette.blue,
        labelBoxBorderColor: line,
        labelTextColor: text,
        loopTextColor: text,
        activationBkgColor: palette.green,
        activationBorderColor: line,
      };
    case 'state':
      return {
        primaryColor: palette.blue,
        primaryTextColor: text,
        primaryBorderColor: line,
        secondaryColor: palette.green,
        tertiaryColor: palette.gold,
        lineColor: line,
        background: '#ffffff',
        mainBkg: palette.blue,
        edgeLabelBackground: edgeBg,
        labelBoxBkgColor: palette.neutral || palette.blue,
        labelBoxBorderColor: line,
      };
    case 'er':
      return {
        primaryColor: palette.blue,
        primaryTextColor: text,
        primaryBorderColor: line,
        lineColor: line,
        edgeLabelBackground: edgeBg,
      };
    case 'gantt':
    case 'pie':
    case 'journey':
    case 'gitgraph':
    case 'mindmap':
    case 'timeline':
    case 'quadrant':
      // For chart-like types, set a neutral light background; mermaid base
      // theme will derive series colors. Avoids dark-theme defaults.
      return {
        primaryColor: palette.blue,
        secondaryColor: palette.green,
        tertiaryColor: palette.gold,
        primaryTextColor: text,
        lineColor: line,
      };
    case 'flowchart':
    case 'class':
    default:
      return {
        primaryColor: palette.blue,
        secondaryColor: palette.green,
        tertiaryColor: palette.purple || palette.green,
        primaryTextColor: text,
        lineColor: line,
        edgeLabelBackground: edgeBg,
      };
  }
}

/**
 * Inject %%{init}%% directive with diagram-type-aware theme config.
 *
 * Skipped when:
 *   - block already contains a %%{init}%% directive, OR
 *   - block contains explicit theme variable references, OR
 *   - block is a flowchart/class diagram with classDef AND options.respectClassDef !== false
 *
 * Sequence and stateDiagram-v2 always receive injection (when no init/explicit
 * theme is present) because classDef does not apply to those types.
 */
function injectPalette(mmdContent, options = {}) {
  const analysis = options.analysis || analyzeMermaid(mmdContent);

  // Already styled — respect author's intent
  if (analysis.hasInitDirective) return mmdContent;
  if (analysis.hasExplicitTheme) return mmdContent;

  // For diagram types that support classDef, defer to the author's classDef
  // unless explicitly told to override.
  if (analysis.supportsClassDef && analysis.hasClassDef && options.respectClassDef !== false) {
    return mmdContent;
  }

  const palette = options.palette || BRAND_PALETTE;
  const theme = options.theme || 'base';
  const themeVars = _buildThemeVars(analysis.diagramType, palette);

  const varsStr = Object.entries(themeVars)
    .map(([k, v]) => `'${k}': '${v}'`)
    .join(', ');

  const initDirective = `%%{init: {'theme': '${theme}', 'themeVariables': {${varsStr}}}}%%\n`;
  return initDirective + mmdContent;
}

/**
 * Validate Mermaid syntax by attempting a dry-run render.
 * Returns { valid: boolean, error?: string }
 */
function validateSyntax(mmdContent) {
  const tmpFile = path.join(os.tmpdir(), `mmd-validate-${Date.now()}.mmd`);
  const tmpOut = tmpFile.replace('.mmd', '.svg');
  try {
    fs.writeFileSync(tmpFile, mmdContent, 'utf8');
    runTool('npx', ['mmdc', '-i', tmpFile, '-o', tmpOut, '-b', 'white'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000
    });
    return { valid: true };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : String(err);
    return { valid: false, error: stderr.slice(0, 500) };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    try { fs.unlinkSync(tmpOut); } catch { /* ignore */ }
  }
}

/**
 * Render a Mermaid diagram to PNG.
 *
 * @param {string} mmdContent - Raw Mermaid diagram source
 * @param {string} outputPath - Destination PNG file path
 * @param {object} options - { scale, width, format, injectPalette, background }
 * @returns {boolean} true if render succeeded
 */
function renderMermaid(mmdContent, outputPath, options = {}) {
  const format = options.format || 'docx';
  const defaults = FORMAT_SCALES[format] || FORMAT_SCALES.docx;
  const scale = options.scale || defaults.scale;
  const width = options.width || defaults.width;
  const bg = options.background || 'white';
  const safeScale = Number(scale);
  const safeWidth = Number(width);
  if (!Number.isFinite(safeScale) || safeScale <= 0) return false;
  if (!Number.isFinite(safeWidth) || safeWidth <= 0) return false;
  if (!/^[a-zA-Z0-9#_-]+$/.test(String(bg))) return false;

  // Optional palette injection
  if (options.injectPalette) {
    mmdContent = injectPalette(mmdContent, options);
  }

  const tmpFile = path.join(os.tmpdir(), `mmd-render-${Date.now()}-${Math.random().toString(36).slice(2)}.mmd`);
  try {
    fs.writeFileSync(tmpFile, mmdContent, 'utf8');

    // Ensure output directory exists
    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    runTool('npx', ['mmdc', '-i', tmpFile, '-o', outputPath, '-b', String(bg), '-s', String(safeScale), '-w', String(safeWidth)], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60000
    });
    return true;
  } catch {
    return false;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

/**
 * Convert SVG to PNG using svgexport.
 */
function convertSvgToPng(svgPath, pngPath, width = 800) {
  try {
    const safeWidth = Number(width);
    if (!Number.isFinite(safeWidth) || safeWidth <= 0) return false;
    runTool('npx', ['svgexport', svgPath, pngPath, `${safeWidth}:`], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a Mermaid diagram to a static markdown table fallback.
 * Useful for contexts like email where Mermaid can't render (e.g. .eml output).
 * Handles flowchart nodes and simple connections.
 */
function mermaidToTableFallback(mmdContent) {
  const lines = mmdContent.trim().split('\n');
  const nodes = [];
  const connections = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip directives and empty lines
    if (!trimmed || trimmed.startsWith('%%') || trimmed.startsWith('graph') ||
      trimmed.startsWith('flowchart') || trimmed.startsWith('sequenceDiagram') ||
      trimmed.startsWith('gantt') || trimmed.startsWith('pie') ||
      trimmed.startsWith('classDiagram') || trimmed.startsWith('stateDiagram') ||
      trimmed.startsWith('erDiagram') || trimmed.startsWith('journey') ||
      trimmed.startsWith('gitGraph') || trimmed.startsWith('mindmap') ||
      trimmed.startsWith('timeline') || trimmed.startsWith('title') ||
      trimmed.startsWith('section') || trimmed.startsWith('end')) continue;

    // Node definitions: A[Label] or A(Label) or A{Label}
    const nodeMatch = trimmed.match(/^\s*(\w+)\s*[\[\({](.+?)[\]\)}]/);
    if (nodeMatch) {
      const [, id, label] = nodeMatch;
      if (!nodes.find(n => n.id === id)) {
        nodes.push({ id, label: label.replace(/<br\/>/g, ' ').trim() });
      }
    }

    // Connections: A --> B or A -->|label| B
    const connMatch = trimmed.match(/(\w+)\s*--[->|]+\s*(?:\|([^|]+)\|\s*)?(\w+)/);
    if (connMatch) {
      connections.push({
        from: connMatch[1],
        label: connMatch[2] || '',
        to: connMatch[3]
      });
    }
  }

  if (nodes.length === 0) return '*[Diagram]*';

  // Build a simple markdown table
  const rows = ['| Step | Description |', '|------|-------------|'];
  for (let i = 0; i < nodes.length; i++) {
    rows.push(`| ${i + 1} | ${nodes[i].label} |`);
  }

  if (connections.length > 0) {
    rows.push('', '| From | To | Relation |', '|------|-----|----------|');
    for (const conn of connections) {
      const fromNode = nodes.find(n => n.id === conn.from);
      const toNode = nodes.find(n => n.id === conn.to);
      rows.push(`| ${fromNode ? fromNode.label : conn.from} | ${toNode ? toNode.label : conn.to} | ${conn.label} |`);
    }
  }

  return rows.join('\n');
}

// -----------------------------------------------------------------------------
// CREATION HELPERS -- scaffold correct, brand-aware Mermaid on first attempt
// -----------------------------------------------------------------------------

/**
 * Wrap mermaid code in a markdown fenced code block.
 * Optionally injects brand palette init directive.
 */
function wrapInFence(mermaidCode, options = {}) {
  const code = options.brandPalette !== false ? injectPalette(mermaidCode, options) : mermaidCode;
  return '```mermaid\n' + code.trim() + '\n```';
}

/**
 * Create a flowchart from structured data.
 *
 * @param {object} options
 * @param {string} [options.direction='TD'] - TD, LR, BT, RL
 * @param {Array<{id: string, label: string, shape?: string, style?: string}>} options.nodes
 * @param {Array<{from: string, to: string, label?: string, style?: string}>} options.edges
 * @param {Array<{name: string, nodes: string[], style?: string}>} [options.groups] - subgraphs
 * @param {boolean} [options.brandPalette=true] - inject brand palette
 * @returns {string} Complete mermaid code block (fenced)
 *
 * @example
 *   createFlowchart({
 *     direction: 'TD',
 *     nodes: [
 *       { id: 'A', label: 'Start', shape: 'round' },
 *       { id: 'B', label: 'Process' },
 *       { id: 'C', label: 'End', shape: 'round' },
 *     ],
 *     edges: [
 *       { from: 'A', to: 'B', label: 'step 1' },
 *       { from: 'B', to: 'C' },
 *     ],
 *   })
 */
function createFlowchart(options = {}) {
  const dir = options.direction || (options.nodes && options.nodes.length > 3 ? 'TD' : 'LR');
  const lines = [`flowchart ${dir}`];

  // Subgraphs
  if (options.groups) {
    for (const group of options.groups) {
      lines.push(`    subgraph ${group.name}`);
      if (group.direction) lines.push(`        direction ${group.direction}`);
      for (const nodeId of group.nodes) {
        const node = (options.nodes || []).find(n => n.id === nodeId);
        if (node) lines.push(`        ${_formatNode(node)}`);
      }
      lines.push('    end');
      if (group.style) {
        lines.push(`    style ${group.name} ${group.style}`);
      }
    }
  }

  // Standalone nodes (not in any group)
  const groupedIds = new Set((options.groups || []).flatMap(g => g.nodes));
  for (const node of options.nodes || []) {
    if (!groupedIds.has(node.id)) {
      lines.push(`    ${_formatNode(node)}`);
    }
  }

  // Edges
  for (const edge of options.edges || []) {
    const arrow = edge.style === 'dotted' ? '-.->' : edge.style === 'thick' ? '==>' : '-->';
    const label = edge.label ? `|${edge.label}|` : '';
    lines.push(`    ${edge.from} ${arrow}${label} ${edge.to}`);
  }

  // Node styles
  for (const node of options.nodes || []) {
    if (node.style) {
      lines.push(`    style ${node.id} ${node.style}`);
    }
  }

  // Class definitions for brand colors
  if (options.classDefs) {
    for (const [name, def] of Object.entries(options.classDefs)) {
      lines.push(`    classDef ${name} ${def}`);
    }
  }

  return wrapInFence(lines.join('\n'), options);
}

function _formatNode(node) {
  const shapes = {
    round: ['(', ')'],
    stadium: ['([', '])'],
    subroutine: ['[[', ']]'],
    cylinder: ['[(', ')]'],
    circle: ['((', '))'],
    diamond: ['{', '}'],
    hexagon: ['{{', '}}'],
    default: ['["', '"]'],
  };
  const [open, close] = shapes[node.shape] || shapes.default;
  const label = node.label.includes('<br') ? node.label : node.label;
  return `${node.id}${open}${label}${close}`;
}

/**
 * Create a sequence diagram from structured data.
 *
 * @param {object} options
 * @param {string[]} options.participants - participant names
 * @param {Array<{from: string, to: string, label: string, type?: string}>} options.messages
 * @param {Array<{type: string, label: string, messages: Array}>} [options.blocks] - alt/opt/loop
 * @returns {string} Complete mermaid code block (fenced)
 */
function createSequence(options = {}) {
  const lines = ['sequenceDiagram'];

  for (const p of options.participants || []) {
    const name = typeof p === 'string' ? p : p.name;
    const alias = typeof p === 'string' ? null : p.alias;
    lines.push(alias ? `    participant ${alias} as ${name}` : `    participant ${name}`);
  }

  const _addMessage = (msg) => {
    const arrows = { solid: '->>', dotted: '-->>', reply: '->>', replyDotted: '-->>', sync: '->', asyncMsg: '--)' };
    const arrow = arrows[msg.type] || '->>';
    lines.push(`    ${msg.from}${arrow}${msg.to}: ${msg.label}`);
  };

  for (const item of options.messages || []) {
    if (item.block) {
      lines.push(`    ${item.block} ${item.label || ''}`);
      for (const inner of item.messages || []) {
        _addMessage(inner);
      }
      lines.push('    end');
    } else {
      _addMessage(item);
    }
  }

  if (options.notes) {
    for (const note of options.notes) {
      const pos = note.position || 'right of';
      lines.push(`    Note ${pos} ${note.participant}: ${note.text}`);
    }
  }

  return wrapInFence(lines.join('\n'), options);
}

/**
 * Create a Gantt chart from structured data.
 *
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.dateFormat='YYYY-MM-DD']
 * @param {Array<{name: string, tasks: Array<{name: string, id?: string, start?: string, duration?: string, status?: string, after?: string}>}>} options.sections
 * @returns {string} Complete mermaid code block (fenced)
 */
function createGantt(options = {}) {
  const lines = ['gantt'];
  if (options.title) lines.push(`    title ${options.title}`);
  lines.push(`    dateFormat ${options.dateFormat || 'YYYY-MM-DD'}`);
  if (options.excludes) lines.push(`    excludes ${options.excludes}`);

  for (const section of options.sections || []) {
    lines.push(`    section ${section.name}`);
    for (const task of section.tasks || []) {
      const parts = [task.name, '    :'];
      if (task.status) parts.push(task.status + ',');
      if (task.id) parts.push(task.id + ',');
      if (task.after) parts.push('after ' + task.after + ',');
      else if (task.start) parts.push(task.start + ',');
      if (task.duration) parts.push(task.duration);
      lines.push(`    ${parts.join(' ').replace(/ +/g, ' ')}`);
    }
  }

  return wrapInFence(lines.join('\n'), options);
}

/**
 * Create a timeline from structured data.
 *
 * @param {object} options
 * @param {string} [options.title]
 * @param {Array<{period: string, events: string[]}>} options.entries
 * @returns {string} Complete mermaid code block (fenced)
 */
function createTimeline(options = {}) {
  const lines = ['timeline'];
  if (options.title) lines.push(`    title ${options.title}`);

  for (const entry of options.entries || []) {
    lines.push(`    ${entry.period}`);
    for (const event of entry.events || []) {
      lines.push(`        : ${event}`);
    }
  }

  return wrapInFence(lines.join('\n'), options);
}

/**
 * Create a mindmap from structured data.
 *
 * @param {object} options
 * @param {string} options.root - root node text
 * @param {Array<{text: string, children?: Array}>} options.branches
 * @returns {string} Complete mermaid code block (fenced)
 */
function createMindmap(options = {}) {
  const lines = ['mindmap'];
  lines.push(`  root(${options.root})`);

  const _addBranch = (branch, depth) => {
    const indent = '  '.repeat(depth + 1);
    lines.push(`${indent}${branch.text}`);
    for (const child of branch.children || []) {
      _addBranch(child, depth + 1);
    }
  };

  for (const branch of options.branches || []) {
    _addBranch(branch, 1);
  }

  return wrapInFence(lines.join('\n'), options);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  findMermaidBlocks,
  injectPalette,
  analyzeMermaid,
  validateSyntax,
  renderMermaid,
  convertSvgToPng,
  mermaidToTableFallback,
  // Creation helpers
  createFlowchart,
  createSequence,
  createGantt,
  createTimeline,
  createMindmap,
  wrapInFence,
  FORMAT_SCALES,
  BRAND_PALETTE,
};
