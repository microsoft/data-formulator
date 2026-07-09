/**
 * shared/prompt-preprocessor.cjs -- Shared Prompt Preprocessing
 *
 * Section validation, trait injection, length checking, and structured
 * prompt building for all image/video generation scripts.
 *
 * Usage:
 *   const { preprocessPrompt, validatePrompt, injectTraits } = require('./shared/prompt-preprocessor.cjs');
 *   const ready = preprocessPrompt(rawPrompt, { model: 'nano-banana-pro', traits: charConfig });
 * @inheritance inheritable
 */

'use strict';

// Maximum prompt lengths per model family (characters)
const PROMPT_LIMITS = {
  'ideogram': 4096,
  'flux': 2048,
  'nano-banana': 1024,
  'sdxl': 800,
  'default': 2048,
};

// Expected prompt sections for structured prompts
const EXPECTED_SECTIONS = [
  'SUBJECT',
  'SCENE',
  'STYLE',
];

/**
 * Get model family from a full model ID.
 * @param {string} model - e.g. 'ideogram-ai/ideogram-v2'
 * @returns {string} Family key for PROMPT_LIMITS lookup
 */
function modelFamily(model) {
  if (!model) return 'default';
  const lower = model.toLowerCase();
  if (lower.includes('ideogram')) return 'ideogram';
  if (lower.includes('flux')) return 'flux';
  if (lower.includes('nano-banana')) return 'nano-banana';
  if (lower.includes('sdxl')) return 'sdxl';
  return 'default';
}

/**
 * Validate prompt structure and length.
 * @param {string} prompt - Raw prompt text
 * @param {object} [options] - { model, requireSections }
 * @returns {{ valid: boolean, warnings: string[], truncated: boolean }}
 */
function validatePrompt(prompt, options = {}) {
  const { model, requireSections = false } = options;
  const warnings = [];
  let truncated = false;

  if (!prompt || typeof prompt !== 'string') {
    return { valid: false, warnings: ['Prompt is empty or not a string'], truncated: false };
  }

  // Length check
  const family = modelFamily(model);
  const maxLen = PROMPT_LIMITS[family] || PROMPT_LIMITS.default;
  if (prompt.length > maxLen) {
    warnings.push(`Prompt exceeds ${family} limit: ${prompt.length}/${maxLen} chars`);
    truncated = true;
  }

  // Section validation (optional -- for structured prompts)
  if (requireSections) {
    for (const section of EXPECTED_SECTIONS) {
      if (!prompt.toUpperCase().includes(section)) {
        warnings.push(`Missing expected section: ${section}`);
      }
    }
  }

  // Common content warnings
  if (prompt.includes('\u201C') || prompt.includes('\u201D') || prompt.includes('\u2018') || prompt.includes('\u2019')) {
    warnings.push('Smart quotes detected -- may cause rendering issues in some models');
  }
  if (/[\uD800-\uDBFF]/.test(prompt)) {
    warnings.push('Surrogate pair characters detected -- some models may reject these');
  }

  return { valid: warnings.length === 0, warnings, truncated };
}

/**
 * Inject character identity traits into a prompt.
 * Prepends immutable traits as a priority section.
 * @param {string} prompt - Base prompt text
 * @param {object} charConfig - Character config from visual-memory.json
 * @param {string} [subject='alex'] - Which subject's traits to inject
 * @returns {string} Enhanced prompt with trait injection
 */
function injectTraits(prompt, charConfig, subject = 'alex') {
  if (!charConfig?.subjects?.[subject]?.immutableTraits) return prompt;

  const traits = charConfig.subjects[subject].immutableTraits;
  if (!Array.isArray(traits) || traits.length === 0) return prompt;

  const traitBlock = `IDENTITY PRESERVATION (highest priority):\n${traits.map(t => `- ${t}`).join('\n')}`;
  return `${traitBlock}\n\n${prompt}`;
}

/**
 * Clean and normalize a prompt for API submission.
 * - Replaces smart quotes with straight quotes
 * - Normalizes whitespace
 * - Trims to model limit if needed
 * @param {string} prompt
 * @param {object} [options] - { model }
 * @returns {string}
 */
function cleanPrompt(prompt, options = {}) {
  if (!prompt) return '';
  let clean = prompt
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u2014/g, '--')
    .replace(/\u2026/g, '...')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const family = modelFamily(options.model);
  const maxLen = PROMPT_LIMITS[family] || PROMPT_LIMITS.default;
  if (clean.length > maxLen) {
    clean = clean.slice(0, maxLen - 3) + '...';
  }
  return clean;
}

/**
 * Full preprocessing pipeline: clean -> inject traits -> validate -> return.
 * @param {string} rawPrompt
 * @param {object} [options] - { model, charConfig, subject, requireSections }
 * @returns {{ prompt: string, validation: object }}
 */
function preprocessPrompt(rawPrompt, options = {}) {
  const { model, charConfig, subject = 'alex', requireSections = false } = options;

  let prompt = cleanPrompt(rawPrompt, { model });
  if (charConfig) {
    prompt = injectTraits(prompt, charConfig, subject);
  }
  const validation = validatePrompt(prompt, { model, requireSections });

  if (validation.warnings.length > 0) {
    validation.warnings.forEach(w => console.warn(`  (x) Prompt: ${w}`));
  }

  return { prompt, validation };
}

module.exports = {
  preprocessPrompt,
  validatePrompt,
  injectTraits,
  cleanPrompt,
  modelFamily,
  PROMPT_LIMITS,
  EXPECTED_SECTIONS,
};
