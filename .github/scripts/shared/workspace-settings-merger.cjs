/**
 * workspace-settings-merger.cjs — deep-merge a workspace-settings baseline
 * into a heir's `.vscode/settings.json` non-destructively.
 *
 * Used by:
 *   - bootstrap-heir.cjs (on init, after HEIR_OWNED templates land)
 *   - upgrade-self.cjs (on upgrade, after the marker is refreshed)
 *
 * Why a shared module: `.vscode/settings.json` is HEIR_OWNED (see _registry.cjs
 * EDITION_OWNED / HEIR_OWNED arrays). Edition never overwrites the file
 * wholesale, so per-key baseline keys must be merged. This module is the
 * single implementation both lifecycle scripts call.
 *
 * Behaviour:
 *   - Reads `.github/config/heir-workspace-settings-baseline.json`
 *   - Loads heir's existing `.vscode/settings.json` (creating empty object if
 *     absent; tolerating JSONC `//` and block comments)
 *   - For each top-level key in `settings`: if the baseline value is an object,
 *     deep-merge its child keys; otherwise scalar-replace
 *   - Per-key merge mode (optional `mergeMode` map in baseline JSON):
 *       - `enforce` (default, unset) — current behaviour: object deep-merge or
 *         scalar overwrite. Use when the brain holds the opinion.
 *       - `set-if-absent` — skip wholesale if heir's settings.json already has
 *         the key (under any value, including object/scalar/null). Use when
 *         the brain wants to pin a safe default on fresh installs but respect
 *         heir per-repo overrides on upgrade.
 *   - Returns the merge result without writing — caller decides whether to
 *     persist (lets dry-run paths reuse the same logic)
 *
 * Companion to:
 *   - docs/proposals/heir-local-skills-discovery-2026-05-27.md (Edition v2.6.0)
 *   - docs/proposals/edition-chat-permissions-default-2026-06-03.md (Edition v3.3.0)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

function stripJsonc(text) {
    let out = '';
    let inString = false;
    let escaped = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const next = text[i + 1];

        if (inLineComment) {
            if (ch === '\n' || ch === '\r') {
                inLineComment = false;
                out += ch;
            }
            continue;
        }

        if (inBlockComment) {
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                i++;
            }
            continue;
        }

        if (inString) {
            out += ch;
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
            out += ch;
            continue;
        }
        if (ch === '/' && next === '/') {
            inLineComment = true;
            i++;
            continue;
        }
        if (ch === '/' && next === '*') {
            inBlockComment = true;
            i++;
            continue;
        }
        out += ch;
    }

    // Strip trailing commas before object/array closers after comments are gone.
    return out.replace(/,\s*([}\]])/g, '$1');
}

/**
 * Compute the merge result without writing.
 *
 * @param {string} repoRoot - heir repo root (where `.vscode/settings.json` lives)
 * @param {string} baselinePath - absolute path to the baseline JSON
 * @returns {object} { ok, settingsFile, existed, hadComments, changes, skipped, merged, error? }
 *   - changes: array of { key, sub|null, from, to } describing each upsert
 *   - skipped: array of { key, mode, reason } describing baseline keys whose
 *     mode (e.g. `set-if-absent`) caused them NOT to be applied because the
 *     heir already had the key. Always present (may be empty).
 *   - merged: the would-be-written object
 *   - hadComments: true if the existing settings.json contained JSONC comments
 *     (caller may want to warn the heir that comments will be lost on write)
 */
function mergeWorkspaceSettings(repoRoot, baselinePath) {
    let baseline;
    try {
        baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    } catch (e) {
        return { ok: false, error: `Cannot read baseline at ${baselinePath}: ${e.message}` };
    }
    const targetKeys = baseline.settings || {};
    const mergeMode = baseline.mergeMode || {};

    const vscodeDir = path.join(repoRoot, '.vscode');
    const settingsFile = path.join(vscodeDir, 'settings.json');

    let existing = {};
    let hadComments = false;
    const existed = fs.existsSync(settingsFile);
    if (existed) {
        const raw = fs.readFileSync(settingsFile, 'utf8');
        hadComments = /\/\/|\/\*/.test(raw);
        try {
            existing = JSON.parse(stripJsonc(raw)) || {};
        } catch (e) {
            return {
                ok: false,
                error: `${settingsFile} is not valid JSON/JSONC: ${e.message}`,
            };
        }
    }

    const changes = [];
    const skipped = [];
    const merged = { ...existing };

    for (const [key, desiredVal] of Object.entries(targetKeys)) {
        const mode = mergeMode[key] || 'enforce';

        // set-if-absent: skip entire key when heir already has it under any value
        if (mode === 'set-if-absent' && Object.prototype.hasOwnProperty.call(merged, key)) {
            skipped.push({ key, mode, reason: 'heir-has-key' });
            continue;
        }

        if (
            desiredVal &&
            typeof desiredVal === 'object' &&
            !Array.isArray(desiredVal)
        ) {
            const current =
                merged[key] &&
                typeof merged[key] === 'object' &&
                !Array.isArray(merged[key])
                    ? merged[key]
                    : {};
            const next = { ...current };
            for (const [subKey, subVal] of Object.entries(desiredVal)) {
                if (next[subKey] !== subVal) {
                    changes.push({ key, sub: subKey, from: next[subKey], to: subVal });
                    next[subKey] = subVal;
                }
            }
            merged[key] = next;
        } else {
            if (merged[key] !== desiredVal) {
                changes.push({ key, sub: null, from: merged[key], to: desiredVal });
                merged[key] = desiredVal;
            }
        }
    }

    return { ok: true, settingsFile, existed, hadComments, changes, skipped, merged };
}

/**
 * Persist a merge result to disk.
 *
 * @param {object} result - return value of mergeWorkspaceSettings
 */
function writeMerged(result) {
    const dir = path.dirname(result.settingsFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        result.settingsFile,
        JSON.stringify(result.merged, null, 2) + '\n',
        'utf8'
    );
}

/**
 * Format a one-line summary suitable for console.log.
 *
 * @param {object} result - return value of mergeWorkspaceSettings
 * @param {string} verb - "Would apply" / "Applied" / "Already current"
 */
function formatChangeSummary(result, verb) {
    if (!result.ok) return `Workspace settings merge: ${result.error}`;
    const skipped = result.skipped || [];
    if (result.changes.length === 0) {
        let msg = `Workspace settings: already current (${result.settingsFile})`;
        if (skipped.length > 0) {
            const noun = skipped.length === 1 ? 'override' : 'overrides';
            msg += ` (respected ${skipped.length} heir ${noun}: ${skipped.map((s) => s.key).join(', ')})`;
        }
        return msg;
    }
    const lines = [
        `${verb} ${result.changes.length} workspace-settings change(s) to ${result.settingsFile}:`,
    ];
    for (const c of result.changes) {
        const where = c.sub ? `${c.key}["${c.sub}"]` : c.key;
        lines.push(`  ${where}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`);
    }
    if (skipped.length > 0) {
        const noun = skipped.length === 1 ? 'override' : 'overrides';
        lines.push(`  Respected ${skipped.length} heir ${noun} (set-if-absent): ${skipped.map((s) => s.key).join(', ')}`);
    }
    if (result.hadComments) {
        lines.push(
            '  Note: existing settings.json contained JSONC comments; they were not preserved.'
        );
    }
    return lines.join('\n');
}

module.exports = { mergeWorkspaceSettings, writeMerged, formatChangeSummary };
