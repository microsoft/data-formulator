#!/usr/bin/env node
/**
 * @type muscle
 * @lifecycle stable
 * @muscle heir-doctor
 * @inheritance inheritable
 * @description Health check for an ACT Edition heir — flags misplaced files, edition-owned drift, missing local/ subdirs
 * @version 1.2.0
 * @reviewed 2026-04-30
 * @platform windows,macos,linux
 * @requires node
 *
 * Usage: node .github/skills/greeting-checkin/scripts/heir-doctor.cjs
 *        node .github/skills/greeting-checkin/scripts/heir-doctor.cjs --json
 *
 * Exit codes: 0 = healthy, 1 = warnings, 2 = errors (bugs in heir layout)
 */

const fs = require('fs');
const path = require('path');

const HEIR_ROOT = process.cwd();
const GH = path.join(HEIR_ROOT, '.github');
const MARKER_PATH = path.join(GH, '.act-heir.json');
const IS_EDITION_TEMPLATE = fs.existsSync(path.join(HEIR_ROOT, 'init-edition.cjs'));

// Sync policy now lives inline in scripts/_registry.cjs (was .github/config/sync-policy.json).
// Import directly; if the heir is missing _registry.cjs the script will error on require, which
// is what we want — _registry.cjs is edition-owned and load-bearing.
const { EDITION_OWNED, HEIR_OWNED } = require(path.join(GH, 'scripts', '_registry.cjs'));

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');

const findings = { errors: [], warnings: [], info: [] };

function err(msg) { findings.errors.push(msg); }
function warn(msg) { findings.warnings.push(msg); }
function info(msg) { findings.info.push(msg); }

function walkDir(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const absolutePath = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...walkDir(absolutePath));
        else if (entry.isFile()) files.push(absolutePath);
    }
    return files;
}

// ---- Check 1: marker exists --------------------------------------------------
let marker = null;
if (!fs.existsSync(MARKER_PATH)) {
    if (IS_EDITION_TEMPLATE) {
        info('Template mode: running in Alex_ACT_Edition source repo; .github/.act-heir.json is not expected.');
    } else {
        err('Missing .github/.act-heir.json — heir not bootstrapped. Run scripts/bootstrap-heir.cjs.');
        emit();
        process.exit(2);
    }
} else {
    try {
        marker = JSON.parse(fs.readFileSync(MARKER_PATH, 'utf8'));
    } catch (e) {
        err(`.github/.act-heir.json is not valid JSON: ${e.message}`);
        emit();
        process.exit(2);
    }
    info(`Heir: ${marker.heir_id || '(no heir_id)'} on Edition v${marker.edition_version || '?'}`);
}

// ---- Check 2: sync policy loaded --------------------------------------------
// Policy is imported from _registry.cjs above. If require failed we'd already have crashed.
const editionOwned = EDITION_OWNED || [];
const heirOwned = HEIR_OWNED || [];

// ---- Check 3: local/ subdirs exist ------------------------------------------
const expectedLocalDirs = [
    '.github/skills/local',
    '.github/instructions/local',
    '.github/scripts/local',
    '.github/prompts/local',
    '.github/agents/local',
];
for (const d of expectedLocalDirs) {
    const full = path.join(HEIR_ROOT, d);
    if (!fs.existsSync(full)) {
        info(`Missing ${d}/ — created on first install (not an error)`);
    }
}

// ---- Check 4: misplaced custom skills/prompts/instructions/scripts ----------
// We read the edition-shipped allowlist from .github/config/edition-manifest.json,
// which is generated at release time and synced to heirs as edition-owned.
// Without the manifest we cannot reliably tell heir-added files from edition
// drift, so we skip the check rather than risk false positives that would
// move edition-owned files into local/.
const manifestPath = path.join(GH, 'config', 'edition-manifest.json');
let editionManifest = null;
if (fs.existsSync(manifestPath)) {
    try {
        editionManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
        warn(`.github/config/edition-manifest.json is not valid JSON: ${e.message}. Skipping misplaced-file checks.`);
    }
} else {
    warn('Missing .github/config/edition-manifest.json — cannot identify edition-shipped skills/prompts. Run /upgrade to pull the manifest, or skip this check on pre-manifest Edition versions.');
}

if (editionManifest) {
    const editionShippedSkills = new Set([...(editionManifest.skills || []), 'local']);
    const editionShippedSkillFiles = new Set(editionManifest.skill_files || []);
    const skillsDir = path.join(GH, 'skills');
    if (fs.existsSync(skillsDir)) {
        const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
        for (const e of entries) {
            if (e.isDirectory() && !editionShippedSkills.has(e.name)) {
                err(`Skill .github/skills/${e.name}/ is in an edition-owned path and not shipped by Edition. Move to .github/skills/local/${e.name}/ or it will be deleted on next upgrade.`);
            } else if (e.isDirectory() && e.name !== 'local' && editionShippedSkillFiles.size > 0) {
                const skillDir = path.join(skillsDir, e.name);
                for (const absPath of walkDir(skillDir)) {
                    const rel = path.relative(skillsDir, absPath).replace(/\\/g, '/');
                    if (!editionShippedSkillFiles.has(rel)) {
                        err(`File .github/skills/${rel} is inside an Edition-shipped skill but is not shipped by Edition. Move to .github/skills/local/${rel} or it will be relocated on next upgrade.`);
                    }
                }
            }
        }
    }

    const editionShippedPrompts = new Set(editionManifest.prompts || []);
    const promptsDir = path.join(GH, 'prompts');
    if (fs.existsSync(promptsDir)) {
        const entries = fs.readdirSync(promptsDir, { withFileTypes: true });
        for (const e of entries) {
            if (e.isFile() && e.name.endsWith('.prompt.md') && !editionShippedPrompts.has(e.name)) {
                err(`Prompt .github/prompts/${e.name} is in an edition-owned path and not shipped by Edition. Move to .github/prompts/local/${e.name}/ or it will be deleted on next upgrade.`);
            }
        }
    }

    const editionShippedAgents = new Set(editionManifest.agents || []);
    const agentsDir = path.join(GH, 'agents');
    if (fs.existsSync(agentsDir)) {
        const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
        for (const e of entries) {
            if (e.isFile() && e.name.endsWith('.agent.md') && !editionShippedAgents.has(e.name)) {
                err(`Agent .github/agents/${e.name} is in an edition-owned path and not shipped by Edition. Move to .github/agents/local/${e.name} or it will be deleted on next upgrade.`);
            }
        }
    }
}

// ---- Check 5: copilot-instructions.local.md exists --------------------------
const localId = path.join(GH, 'copilot-instructions.local.md');
if (!IS_EDITION_TEMPLATE && !fs.existsSync(localId)) {
    warn('Missing .github/copilot-instructions.local.md — your identity customizations have no home. Create the file and fill in the ## Project Context section (see /welcome for guided orientation).');
}

// ---- Check 6: scripts present -----------------------------------------------
for (const s of ['upgrade-self.cjs', 'bootstrap-heir.cjs']) {
    if (!fs.existsSync(path.join(GH, 'scripts', s))) {
        err(`Missing .github/scripts/${s}`);
    }
}

// ---- Check 6b: heir-owned config templates ----------------------------------
const heirConfigs = [
    { rel: '.github/config/cognitive-config.json', ref: 'knowledge-coverage instruction (showConfidenceBadge)' },
];
for (const { rel, ref } of heirConfigs) {
    if (!fs.existsSync(path.join(HEIR_ROOT, rel))) {
        warn(`Missing ${rel} — referenced by ${ref}. Bootstrap should have rendered it.`);
    }
}

// ---- Check 7: VERSION matches marker ----------------------------------------
const versionPath = path.join(GH, 'VERSION');
if (fs.existsSync(versionPath)) {
    const ver = fs.readFileSync(versionPath, 'utf8').trim();
    if (marker && marker.edition_version && ver !== marker.edition_version) {
        warn(`VERSION file says ${ver} but marker says ${marker.edition_version}. Run /upgrade to reconcile.`);
    }
}

// ---- Check 8: stale sync ----------------------------------------------------
if (marker && marker.last_sync_at) {
    const last = new Date(marker.last_sync_at);
    const ageDays = (Date.now() - last.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > 30) {
        warn(`Edition last synced ${Math.floor(ageDays)} days ago. Consider /upgrade.`);
    }
}

// ---- Emit -------------------------------------------------------------------
function emit() {
    if (jsonOutput) {
        console.log(JSON.stringify(findings, null, 2));
        return;
    }
    console.log('');
    if (findings.info.length) {
        findings.info.forEach(m => console.log(`  i  ${m}`));
    }
    if (findings.warnings.length) {
        console.log('');
        findings.warnings.forEach(m => console.log(`  !  ${m}`));
    }
    if (findings.errors.length) {
        console.log('');
        findings.errors.forEach(m => console.log(`  X  ${m}`));
    }
    console.log('');
    if (!findings.errors.length && !findings.warnings.length) {
        console.log('  Heir is healthy.');
    } else {
        console.log(`  ${findings.errors.length} error(s), ${findings.warnings.length} warning(s)`);
    }
    console.log('');
}

emit();
process.exit(findings.errors.length ? 2 : findings.warnings.length ? 1 : 0);
