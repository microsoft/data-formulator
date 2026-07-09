/**
 * _registry.cjs — shared memory bus resolution and sync policy.
 *
 * Resolves the Alex_ACT_Memory sibling repo using a three-state fallback:
 *   1. SIBLING: ../Alex_ACT_Memory exists → use it (git pull)
 *   2. CLONE:   remote configured → git clone
 *   3. SCAFFOLD: create minimal local repo
 *
 * Also exports EDITION_OWNED/HEIR_OWNED sync policy arrays for
 * bootstrap-heir.cjs and upgrade-self.cjs.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MEMORY_REPO_NAME = 'Alex_ACT_Memory';
const MEMORY_REMOTE = 'https://github.com/fabioc-aloha/Alex_ACT_Memory.git';

/**
 * Resolve the memory bus root. Returns { root, level, message } or null on failure.
 * level: 'sibling' | 'cloned' | 'scaffolded'
 * @param {string} [repoRoot] - the heir's repo root (defaults to cwd)
 */
function resolveMemoryBus(repoRoot, options = {}) {
    const mutate = options.mutate === true;
    const base = repoRoot ? path.resolve(repoRoot, '..') : path.resolve(process.cwd(), '..');
    const memoryPath = path.join(base, MEMORY_REPO_NAME);

    // Level 1: sibling exists — pull updates
    if (fs.existsSync(path.join(memoryPath, '.git'))) {
        if (mutate) {
            try {
                execFileSync('git', ['pull', '--rebase', '--quiet'], {
                    cwd: memoryPath,
                    stdio: ['ignore', 'ignore', 'ignore'],
                    timeout: 15000,
                });
            } catch { /* network failure is fine; use stale copy */ }
        }
        return { root: memoryPath, level: 'sibling', message: null };
    }

    if (!mutate) return null;

    // Level 2: not present but remote configured — clone
    if (MEMORY_REMOTE) {
        try {
            execFileSync('git', ['clone', MEMORY_REMOTE, memoryPath, '--quiet'], {
                stdio: ['ignore', 'ignore', 'ignore'],
                timeout: 30000,
            });
            return { root: memoryPath, level: 'cloned', message: `Shared memory cloned from GitHub to ${memoryPath}` };
        } catch { /* clone failed — fall through to scaffold */ }
    }

    // Level 3: scaffold a local repo
    return scaffoldMemoryRepo(memoryPath);
}

/**
 * Create a minimal memory repo scaffold.
 */
function scaffoldMemoryRepo(memoryPath) {
    fs.mkdirSync(memoryPath, { recursive: true });
    try { execFileSync('git', ['init', '--quiet'], { cwd: memoryPath, stdio: 'ignore' }); } catch { /* git not available */ }

    const dirs = ['announcements', 'feedback', 'knowledge', 'profile/default', 'insights', 'docs'];
    for (const d of dirs) {
        fs.mkdirSync(path.join(memoryPath, d), { recursive: true });
    }

    const files = {
        'README.md': '# Alex_ACT_Memory\\n\\nShared memory bus for ACT-Edition heirs.\\nSee docs/MIGRATION.md if upgrading from OneDrive-based AI-Memory.\\n',
        'announcements/README.md': '# Announcements\\n\\nRelease notes and guidance. Any heir writes here on release; all read on greeting.\\n',
        'feedback/README.md': '# Feedback\\n\\nHeir friction reports. Any heir writes here when encountering issues.\\n',
        'knowledge/index.json': '[]',
        'knowledge/README.md': '# Knowledge\\n\\nCurated knowledge packages. See index.json for registry.\\n',
        'profile/default/README.md': '# Default Profile\\n\\nFallback when no user-specific profile exists.\\n',
        '.gitignore': '# OS\\nThumbs.db\\n.DS_Store\\n\\n# Editor\\n.vscode/\\n*.swp\\n',
    };

    for (const [rel, content] of Object.entries(files)) {
        const full = path.join(memoryPath, rel);
        if (!fs.existsSync(full)) {
            fs.writeFileSync(full, content.replace(/\\n/g, '\n'));
        }
    }

    try {
        execFileSync('git', ['add', '-A'], { cwd: memoryPath, stdio: 'ignore' });
        execFileSync('git', ['commit', '-m', 'Initial scaffold', '--quiet'], { cwd: memoryPath, stdio: 'ignore' });
    } catch { /* best effort */ }

    return { root: memoryPath, level: 'scaffolded', message: `Created local memory bus at ${memoryPath}. No remote configured — set one to sync across machines.` };
}

/**
 * Read user profile from memory bus.
 * @param {string} memoryRoot
 * @returns {object|null}
 */
function readProfile(memoryRoot) {
    const username = sanitizePathSegment(process.env.USER || process.env.USERNAME || 'default');
    const profilePath = path.join(memoryRoot, 'profile', username, 'user-profile.json');
    const fallbackPath = path.join(memoryRoot, 'profile', 'default', 'user-profile.json');
    const target = fs.existsSync(profilePath) ? profilePath : (fs.existsSync(fallbackPath) ? fallbackPath : null);
    if (!target) return null;
    try { return JSON.parse(fs.readFileSync(target, 'utf8')); } catch { return null; }
}

/**
 * Write user profile to memory bus (best-effort commit + push).
 * @param {string} memoryRoot
 * @param {object} profile
 */
function writeProfile(memoryRoot, profile) {
    const username = sanitizePathSegment(process.env.USER || process.env.USERNAME || 'default');
    const profileDir = path.join(memoryRoot, 'profile', username);
    fs.mkdirSync(profileDir, { recursive: true });
    const profilePath = path.join(profileDir, 'user-profile.json');
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n');
    try {
        execFileSync('git', ['add', profilePath], { cwd: memoryRoot, stdio: 'ignore' });
        execFileSync('git', ['commit', '-m', `Update profile: ${username}`, '--quiet'], { cwd: memoryRoot, stdio: 'ignore' });
        execFileSync('git', ['push', '--quiet'], { cwd: memoryRoot, stdio: 'ignore', timeout: 15000 });
    } catch { /* best effort — push may fail without remote */ }
}

function sanitizePathSegment(value) {
    return String(value || 'default').replace(/[^a-zA-Z0-9._-]/g, '_') || 'default';
}

// ─── Sync policy ──────────────────────────────────────────────────────────────
// Read by bootstrap-heir.cjs (initial install) and upgrade-self.cjs (overwrite-vs-preserve).

const EDITION_OWNED = [
    '.github/copilot-instructions.md',
    '.github/instructions/**',
    '.github/skills/**',
    '.github/prompts/**',
    '.github/agents/**',
    '.github/config/edition-manifest.json',
    '.github/config/welcome-baseline.json',
    '.github/config/heir-workspace-settings-baseline.json',
    '.github/config/README.md',
    '.github/scripts/shared/**',
    '.github/scripts/converter-qa.cjs',
    '.github/scripts/audit-mall-drift.cjs',
    '.github/scripts/upgrade-self.cjs',
    '.github/scripts/bootstrap-heir.cjs',
    '.github/scripts/build-edition-manifest.cjs',
    '.github/scripts/_registry.cjs',
    '.github/scripts/CONVERTER-CHANGELOG.md',
    '.github/VERSION',
    '.vscode/markdown-light.css',
];

const HEIR_OWNED = [
    '.github/.act-heir.json',
    '.github/copilot-instructions.local.md',
    '.github/config/cognitive-config.json',
    '.github/config/local/**',
    '.github/instructions/local/**',
    '.github/skills/local/**',
    '.github/prompts/local/**',
    '.github/scripts/local/**',
    '.github/agents/local/**',
    '.github/episodic/**',
    '.github/workflows/**',
    '.github/ISSUE_TEMPLATE/**',
    '.github/dependabot.yml',
    '.vscode/extensions.json',
    '.vscode/settings.json',
];

// Explicit subset of HEIR_OWNED that ships as first-install template.
// build-edition-manifest.cjs reads this list directly instead of inferring
// from HEIR_OWNED (the older inferred path leaked curator-only files like
// `.github/dependabot.yml` into bootstrap_templates when Edition's own
// repo gained them as curator-side policy; see brain-qa-changelog entry
// for Edition v3.4.1, 2026-06-10).
//
// Adding a row here means "the Extension installs this file once on
// fresh heirs; never overwrites on upgrade." Curator-only HEIR_OWNED
// files (workflows/, dependabot.yml, episodic/, ISSUE_TEMPLATE/) must
// NOT be listed here — they're heir territory but Edition has no
// business shipping its curator-side instance to heirs.
const BOOTSTRAP_TEMPLATES = [
    '.github/config/cognitive-config.json',
    '.vscode/extensions.json',
    '.vscode/settings.json',
];

module.exports = { resolveMemoryBus, readProfile, writeProfile, scaffoldMemoryRepo, MEMORY_REPO_NAME, MEMORY_REMOTE, EDITION_OWNED, HEIR_OWNED, BOOTSTRAP_TEMPLATES };

// ── CLI mode ───────────────────────────────────────────────────────
// node _registry.cjs --resolve [dir]     Resolve memory bus
// node _registry.cjs --profile [dir]     Read user profile
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.includes('--resolve')) {
        const idx = args.indexOf('--resolve');
        const dir = args[idx + 1] || process.cwd();
        const result = resolveMemoryBus(dir);
        if (result) {
            console.log(`Memory bus: ${result.root} (${result.level})`);
            if (result.message) console.log(`  ${result.message}`);
        } else {
            console.log('(not found)');
        }
    } else if (args.includes('--profile')) {
        const idx = args.indexOf('--profile');
        const dir = args[idx + 1] || process.cwd();
        const bus = resolveMemoryBus(dir);
        if (bus) {
            const profile = readProfile(bus.root);
            console.log(profile ? JSON.stringify(profile, null, 2) : '(no profile found)');
        } else {
            console.log('(no memory bus)');
        }
    } else {
        console.log('Usage:');
        console.log('  node _registry.cjs --resolve [dir]     Resolve memory bus');
        console.log('  node _registry.cjs --profile [dir]     Read user profile');
    }
}
