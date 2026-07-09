/**
 * @type muscle
 * @lifecycle stable
 * @muscle conversion-report
 * @inheritance inheritable
 * @description Shared conversion report helper for converter QA contract (FC1)
 * @version 1.0.0
 * @currency 2026-04-26
 *
 * Converters call report.add() during processing to collect findings,
 * then report.write() at the end to emit .conversion-report.json.
 *
 * Usage:
 *   const { createConversionReport } = require('./shared/conversion-report.cjs');
 *   const report = createConversionReport('md-to-html', inputPath, outputPath);
 *   report.add('warning', 'mermaid', 'Mermaid diagram rendered as table fallback');
 *   report.add('dropped', 'math', 'KaTeX equation could not render — raw LaTeX kept');
 *   report.add('ok', 'images', '3 images embedded as base64');
 *   report.write();
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Create a conversion report collector.
 * @param {string} converter - Converter name (e.g., 'md-to-html')
 * @param {string} inputPath - Source file path
 * @param {string} outputPath - Output file path
 * @returns {{ add: Function, write: Function, findings: Array, summary: Function }}
 */
function createConversionReport(converter, inputPath, outputPath) {
  const findings = [];
  const startTime = Date.now();

  return {
    findings,

    /**
     * Record a finding during conversion.
     * @param {'ok'|'warning'|'dropped'|'error'} severity
     * @param {string} category - Element type (e.g., 'mermaid', 'images', 'math', 'tables', 'links', 'frontmatter')
     * @param {string} message - Human-readable description
     */
    add(severity, category, message) {
      findings.push({ severity, category, message });
    },

    /**
     * Get summary counts by severity.
     */
    summary() {
      const counts = { ok: 0, warning: 0, dropped: 0, error: 0 };
      for (const f of findings) {
        counts[f.severity] = (counts[f.severity] || 0) + 1;
      }
      return counts;
    },

    /**
     * Write the report as .conversion-report.json next to the output file.
     * @returns {string} Path to the written report file
     */
    write() {
      const counts = this.summary();
      const report = {
        converter,
        input: path.basename(inputPath),
        output: path.basename(outputPath),
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        counts,
        passed: counts.error === 0 && counts.dropped === 0,
        findings,
      };

      const reportPath = outputPath.replace(/\.[^.]+$/, '.conversion-report.json');
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
      return reportPath;
    },
  };
}

module.exports = { createConversionReport };
