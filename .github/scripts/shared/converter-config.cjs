/**
 * converter-config.cjs -- Shared converter configuration loader
 * Version: 1.0.0
 *
 * Loads per-project .converter.json from the project root and merges with defaults.
 * Converters call loadConfig(section) to get their merged config.
 *
 * Usage:
 *   const { loadConfig } = require('./shared/converter-config.cjs');
 *   const cfg = loadConfig('word', { inputFile: './docs/README.md' });
 *   // cfg = { style: 'professional', toc: false, fonts: {...}, colors: {...}, ... }
 * @inheritance inheritable
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  word: {
    style: 'professional',
    pageSize: 'letter',
    toc: false,
    cover: false,
    referenceDoc: null,
    luaFilters: [],
    mermaid: { scale: 8, width: 2400, background: 'white', injectPalette: false },
    fonts: { body: 'Segoe UI', heading: 'Segoe UI', code: 'Consolas' },
    colors: { h1: '0078D4', h2: '2B579A', h3: '3B3B3B', body: '1F2328', link: '0563C1', tableHeader: '0078D4' }
  },
  email: {
    inlineImages: true,
    defaultFrom: null,
    testTo: null
  }
};

/**
 * Walk up from startDir looking for .converter.json.
 * Stops at git root or filesystem root.
 */
function findConfigFile(startDir) {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  while (dir !== root) {
    const candidate = path.join(dir, '.converter.json');
    if (fs.existsSync(candidate)) return candidate;
    // Stop at git root
    if (fs.existsSync(path.join(dir, '.git'))) break;
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Deep merge b into a (b wins on conflict for primitives, objects merge recursively).
 * Arrays from b replace a entirely.
 */
function deepMerge(a, b) {
  const result = { ...a };
  for (const key of Object.keys(b)) {
    if (b[key] != null && typeof b[key] === 'object' && !Array.isArray(b[key]) &&
        a[key] != null && typeof a[key] === 'object' && !Array.isArray(a[key])) {
      result[key] = deepMerge(a[key], b[key]);
    } else {
      result[key] = b[key];
    }
  }
  return result;
}

/**
 * Load converter config for a given section.
 *
 * @param {string} section - Config section: 'word', 'email'
 * @param {object} [options] - Options
 * @param {string} [options.inputFile] - Input file path (used to find project root)
 * @param {string} [options.projectRoot] - Explicit project root directory
 * @param {object} [options.overrides] - CLI overrides that take highest priority
 * @returns {object} Merged configuration
 */
function loadConfig(section, options = {}) {
  const defaults = DEFAULTS[section] || {};

  // Find project root
  const startDir = options.projectRoot
    || (options.inputFile ? path.dirname(path.resolve(options.inputFile)) : process.cwd());

  const configPath = findConfigFile(startDir);
  if (!configPath) {
    return options.overrides ? deepMerge(defaults, options.overrides) : { ...defaults };
  }

  let fileConfig;
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    fileConfig = parsed[section] || {};
  } catch (err) {
    console.warn(`[!]  Warning: Failed to parse ${configPath}: ${err.message}`);
    return options.overrides ? deepMerge(defaults, options.overrides) : { ...defaults };
  }

  // Priority: CLI overrides > .converter.json > defaults
  let merged = deepMerge(defaults, fileConfig);
  if (options.overrides) {
    merged = deepMerge(merged, options.overrides);
  }
  return merged;
}

/**
 * Load visual-memory.json character configuration.
 *
 * @param {string} [configPath] - Path to visual-memory.json. If null, looks in .github/config/
 * @param {string} [projectRoot] - Project root directory
 * @returns {object|null} Parsed visual-memory config or null if not found
 */
function loadCharacterConfig(configPath, projectRoot) {
  const candidates = configPath
    ? [path.resolve(configPath)]
    : [
        path.join(projectRoot || process.cwd(), '.github', 'config', 'visual-memory.json'),
        path.join(process.cwd(), '.github', 'config', 'visual-memory.json')
      ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        return JSON.parse(fs.readFileSync(candidate, 'utf8'));
      } catch (err) {
        console.warn(`[!]  Warning: Failed to parse ${candidate}: ${err.message}`);
        return null;
      }
    }
  }
  return null;
}

/**
 * Get prompt template from visual-memory.json.
 *
 * @param {object} charConfig - Parsed visual-memory.json
 * @param {string} templateName - Template name (e.g., 'portrait', 'banner', 'scene')
 * @param {object} [variables] - Template variables to interpolate
 * @returns {string|null} Interpolated prompt template or null
 */
function getPromptTemplate(charConfig, templateName, variables = {}) {
  const entry = charConfig?.promptTemplates?.[templateName];
  if (!entry) return null;
  // Handle both string and { template: string } formats
  let template = typeof entry === 'string' ? entry : entry.template;
  if (typeof template !== 'string') return null;

  // Interpolate {variable} and {{variable}} placeholders
  for (const [key, value] of Object.entries(variables)) {
    template = template.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
    template = template.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
  }
  return template;
}

module.exports = { loadConfig, loadCharacterConfig, getPromptTemplate, findConfigFile, deepMerge, DEFAULTS };
