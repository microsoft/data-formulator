#!/usr/bin/env node
/**
 * @type script
 * @lifecycle stable
 * @script build-edition-manifest
 * @description Scan Edition's .github/ tree and emit a manifest of
 *              edition-shipped artifacts. Bill-of-materials covering
 *              all EDITION_OWNED categories (skills, prompts, agents,
 *              instructions, scripts, copilot-instructions, configs,
 *              VERSION, .vscode assets). Read by heir-doctor.cjs to
 *              detect misplaced (heir-added) artifacts in edition-owned
 *              paths without drifting against a hardcoded allowlist.
 * @reviewed 2026-05-26
 * @platform windows,macos,linux
 * @requires node
 *
 * Usage: node .github/scripts/build-edition-manifest.cjs
 *        node .github/scripts/build-edition-manifest.cjs --check  (exit 1 if regenerated content differs)
 *        node .github/scripts/build-edition-manifest.cjs --preflight  (exit 1 if .github/VERSION != latest git tag)
 *
 * Output: .github/config/edition-manifest.json (overwrites)
 *
 * Run manually before tagging a release. Output is committed alongside
 * the release commit. Future automation: wire into release-ritual.
 *
 * Spec versions:
 *   1.0 — skills, prompts, agents only
 *   1.1 — adds instructions, scripts, copilot_instructions, configs,
 *         version_file, vscode_assets. Additive; consumers reading
 *         1.0 fields work unchanged.
 *   1.2 — adds bootstrap_templates (HEIR_OWNED files Edition ships
 *         as first-install templates: .vscode/settings.json and
 *         .github/config/cognitive-config.json). Additive.
 *   1.3 — adds skill_files: every file under each edition-owned skill
 *         (SKILL.md plus references/, assets/, scripts/, sub-prompts,
 *         etc). Closes the bill-of-materials gap where `skills` only
 *         tracked directory names. `skills` retained for heir-doctor
 *         drift detection at skill granularity. Additive.
 *   1.4 — adds min_extension_version, brain_subtrees, marker_schema.
 *         Merged from .github/config/extension-contract.json. Read by
 *         Alex_ACT_Extension v9.4.0+ static-fetch path (ADR-009) to
 *         validate the install contract before any destructive op.
 *         Fields are null when the sidecar is absent. Additive.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const GH = path.join(ROOT, '.github');
const SKILLS_DIR = path.join(GH, 'skills');
const PROMPTS_DIR = path.join(GH, 'prompts');
const AGENTS_DIR = path.join(GH, 'agents');
const INSTRUCTIONS_DIR = path.join(GH, 'instructions');
const SCRIPTS_DIR = path.join(GH, 'scripts');
const CONFIG_DIR = path.join(GH, 'config');
const VSCODE_DIR = path.join(ROOT, '.vscode');
const VERSION_FILE = path.join(GH, 'VERSION');
const OUT = path.join(GH, 'config', 'edition-manifest.json');

// HEIR_OWNED + BOOTSTRAP_TEMPLATES policy lives in _registry.cjs
// (single source of truth); pulled in so we never duplicate the lists.
const { BOOTSTRAP_TEMPLATES, HEIR_OWNED } = require('./_registry.cjs');

// Edition-owned config files (heir-owned configs like cognitive-config.json excluded).
// Keep in sync with EDITION_OWNED in .github/scripts/_registry.cjs.
const EDITION_CONFIG_FILES = new Set([
  'edition-manifest.json',
  'welcome-baseline.json',
  'heir-workspace-settings-baseline.json',
  'README.md',
]);

// Edition-owned VS Code assets (heir-owned like settings.json + extensions.json excluded).
const EDITION_VSCODE_FILES = new Set([
  'markdown-light.css',
]);

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const preflight = args.includes('--preflight');

function listSkills() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name !== 'local')
    .map(e => e.name)
    .sort();
}

function listSkillFiles() {
  // Every file under each non-local skill directory, relative to .github/skills/.
  // Each skill is a multi-file unit (SKILL.md + references/, assets/, scripts/,
  // sub-prompts, etc). File-level bill-of-materials complements the unit-level
  // `skills` list used by heir-doctor for drift detection.
  if (!fs.existsSync(SKILLS_DIR)) return [];
  const out = [];
  for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'local') continue;
    function walk(dir, rel) {
      for (const sub of fs.readdirSync(dir, { withFileTypes: true })) {
        if (sub.isDirectory()) {
          walk(path.join(dir, sub.name), `${rel}/${sub.name}`);
        } else if (sub.isFile()) {
          out.push(`${rel}/${sub.name}`);
        }
      }
    }
    walk(path.join(SKILLS_DIR, entry.name), entry.name);
  }
  return out.sort();
}

function listPrompts() {
  if (!fs.existsSync(PROMPTS_DIR)) return [];
  return fs.readdirSync(PROMPTS_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.prompt.md'))
    .map(e => e.name)
    .sort();
}

function listAgents() {
  if (!fs.existsSync(AGENTS_DIR)) return [];
  return fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.agent.md'))
    .map(e => e.name)
    .sort();
}

function listInstructions() {
  // Recursive, but skip the local/ subdirectory (heir-owned).
  if (!fs.existsSync(INSTRUCTIONS_DIR)) return [];
  const out = [];
  function walk(dir, rel) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === 'local') continue;
        walk(path.join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name);
      } else if (entry.isFile() && entry.name.endsWith('.instructions.md')) {
        out.push(rel ? `${rel}/${entry.name}` : entry.name);
      }
    }
  }
  walk(INSTRUCTIONS_DIR, '');
  return out.sort();
}

function listScripts() {
  // Root .cjs files plus shared/** (recursive). Skip local/.
  if (!fs.existsSync(SCRIPTS_DIR)) return [];
  const out = [];
  for (const entry of fs.readdirSync(SCRIPTS_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.cjs')) {
      out.push(entry.name);
    } else if (entry.isDirectory() && entry.name === 'shared') {
      function walk(dir, rel) {
        for (const sub of fs.readdirSync(dir, { withFileTypes: true })) {
          if (sub.isDirectory()) {
            walk(path.join(dir, sub.name), `${rel}/${sub.name}`);
          } else if (sub.isFile()) {
            out.push(`${rel}/${sub.name}`);
          }
        }
      }
      walk(path.join(SCRIPTS_DIR, 'shared'), 'shared');
    }
  }
  // CONVERTER-CHANGELOG.md is edition-owned per EDITION_OWNED but not a .cjs.
  // Include any .md docs that sit at scripts/ root.
  for (const entry of fs.readdirSync(SCRIPTS_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(entry.name);
    }
  }
  return out.sort();
}

function listConfigs() {
  if (!fs.existsSync(CONFIG_DIR)) return [];
  return fs.readdirSync(CONFIG_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && EDITION_CONFIG_FILES.has(e.name))
    .map(e => e.name)
    .sort();
}

function listVscodeAssets() {
  if (!fs.existsSync(VSCODE_DIR)) return [];
  return fs.readdirSync(VSCODE_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && EDITION_VSCODE_FILES.has(e.name))
    .map(e => e.name)
    .sort();
}

function hasCopilotInstructions() {
  return fs.existsSync(path.join(GH, 'copilot-instructions.md'));
}

function hasVersionFile() {
  return fs.existsSync(VERSION_FILE);
}

function listBootstrapTemplates() {
  // Read explicit BOOTSTRAP_TEMPLATES from _registry.cjs. Each listed file
  // must exist on disk (Edition release-preflight asserts this). The
  // explicit list replaces the older HEIR_OWNED-inferred path, which
  // leaked curator-only files (e.g. `.github/dependabot.yml`) into the
  // heir first-install set when Edition's own repo gained them.
  // See _registry.cjs BOOTSTRAP_TEMPLATES comment for the rule.
  const out = [];
  for (const rel of BOOTSTRAP_TEMPLATES) {
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      out.push(rel);
    }
  }
  return out.sort();
}

const version = fs.existsSync(VERSION_FILE)
  ? fs.readFileSync(VERSION_FILE, 'utf8').trim()
  : 'unknown';

// Extension contract sidecar: hand-authored fields the static-fetch
// Extension (v9.4.0+) reads at install time per ADR-009. Merged into the
// generated manifest so consumers have one file to read. Source of truth
// lives in .github/config/extension-contract.json so the generator can
// stay deterministic and the contract can evolve without code changes.
const CONTRACT_FILE = path.join(GH, 'config', 'extension-contract.json');
let extensionContract = null;
if (fs.existsSync(CONTRACT_FILE)) {
  try {
    extensionContract = JSON.parse(fs.readFileSync(CONTRACT_FILE, 'utf8'));
  } catch (err) {
    console.error(`Failed to parse ${path.relative(ROOT, CONTRACT_FILE)}: ${err.message}`);
    process.exit(1);
  }
}

const manifest = {
    $comment: 'Generated by .github/scripts/build-edition-manifest.cjs at release time. File-level bill-of-materials of every edition-shipped artifact across EDITION_OWNED categories plus HEIR_OWNED first-install templates. Read by .github/skills/greeting-checkin/scripts/heir-doctor.cjs to identify edition-shipped artifacts and detect heir-added drift. Read by Alex_ACT_Extension v9.4.0+ to validate the install contract per ADR-009. Do not edit by hand, re-run the script.',
  spec_version: '1.4',
  edition_version: version,
  generated_at: new Date().toISOString(),
  // Extension contract fields (spec 1.4+) — merged from
  // .github/config/extension-contract.json. Null when the sidecar is absent
  // (legacy Edition releases before the static-fetch cutover).
  min_extension_version: extensionContract ? extensionContract.min_extension_version : null,
  brain_subtrees: extensionContract ? extensionContract.brain_subtrees : null,
  marker_schema: extensionContract ? extensionContract.marker_schema : null,
  skills: listSkills(),
  skill_files: listSkillFiles(),
  prompts: listPrompts(),
  agents: listAgents(),
  instructions: listInstructions(),
  scripts: listScripts(),
  copilot_instructions: hasCopilotInstructions() ? 'copilot-instructions.md' : null,
  configs: listConfigs(),
  version_file: hasVersionFile() ? 'VERSION' : null,
  vscode_assets: listVscodeAssets(),
  bootstrap_templates: listBootstrapTemplates(),
  heir_owned: HEIR_OWNED.slice(),
};

const newJson = JSON.stringify(manifest, null, 2) + '\n';

if (checkOnly) {
  if (!fs.existsSync(OUT)) {
    console.error(`edition-manifest.json missing. Run: node .github/scripts/build-edition-manifest.cjs`);
    process.exit(1);
  }
  const cur = fs.readFileSync(OUT, 'utf8');
  // Ignore generated_at when comparing, it always differs.
  const stripStamp = (s) => s.replace(/"generated_at":\s*"[^"]*",?\s*/, '');
  if (stripStamp(cur) !== stripStamp(newJson)) {
    console.error('edition-manifest.json is stale. Run: node .github/scripts/build-edition-manifest.cjs');
    process.exit(1);
  }
  console.log('edition-manifest.json is current.');
  process.exit(0);
}

// --preflight: verify .github/VERSION matches the latest git tag.
// Catches the failure mode where a release is tagged but .github/VERSION
// was not bumped (or vice versa).
if (preflight) {
  let latestTag;
  try {
    latestTag = execSync('git describe --tags --abbrev=0', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    console.error('No git tags found. Skipping version-drift check.');
    process.exit(0);
  }
  const tagVersion = latestTag.replace(/^v/, '');
  if (tagVersion !== version) {
    console.error(`VERSION DRIFT DETECTED`);
    console.error(`  .github/VERSION says: ${version}`);
    console.error(`  Latest git tag says:  ${latestTag} (${tagVersion})`);
    console.error(`  Fix: update .github/VERSION to match the tag, or tag a new release.`);
    process.exit(1);
  }
  console.log(`Preflight OK: .github/VERSION (${version}) matches latest tag (${latestTag}).`);
  process.exit(0);
}

fs.writeFileSync(OUT, newJson, 'utf8');
console.log(`Wrote ${path.relative(ROOT, OUT)}`);
console.log(`  edition_version: ${manifest.edition_version}`);
console.log(`  skills:       ${manifest.skills.length} units`);
console.log(`  skill_files:  ${manifest.skill_files.length}`);
console.log(`  prompts:      ${manifest.prompts.length}`);
console.log(`  agents:       ${manifest.agents.length}`);
console.log(`  instructions: ${manifest.instructions.length}`);
console.log(`  scripts:      ${manifest.scripts.length}`);
console.log(`  configs:      ${manifest.configs.length}`);
console.log(`  vscode:       ${manifest.vscode_assets.length}`);
console.log(`  bootstrap:    ${manifest.bootstrap_templates.length}`);
console.log(`  copilot:      ${manifest.copilot_instructions ?? '(missing)'}`);
console.log(`  version_file: ${manifest.version_file ?? '(missing)'}`);
