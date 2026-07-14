/**
 * _registry.cjs — shared memory bus resolution and sync policy.
 *
 * Resolves the Alex_ACT_Memory sibling repo. Read-only callers use an existing
 * sibling or receive null. Explicit setup callers pass { mutate: true } to
 * enable pull, clone, or scaffold behavior.
 *
 * Also exports EDITION_OWNED/HEIR_OWNED sync policy arrays for
 * bootstrap-heir.cjs and upgrade-self.cjs.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
    PASSWORD_ENV,
    ProfileCryptoError,
    decryptEnvelope,
    encryptBuffer,
    readSecretFromSources,
    writeJsonAtomic,
} = require('./shared/profile-crypto.cjs');

const MEMORY_REPO_NAME = 'Alex_ACT_Memory';
const MEMORY_REMOTE = 'https://github.com/fabioc-aloha/Alex_ACT_Memory.git';

/**
 * Resolve the memory bus root. Returns { root, level, message } or null.
 * level: 'sibling' | 'cloned' | 'scaffolded'
 * @param {string} [repoRoot] - the heir's repo root (defaults to cwd)
 * @param {{mutate?: boolean}} [options] - opt into pull/clone/scaffold behavior
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

    const dirs = ['announcements', 'feedback', 'knowledge', 'profile', 'insights', 'docs'];
    for (const d of dirs) {
        fs.mkdirSync(path.join(memoryPath, d), { recursive: true });
    }

    const files = {
        'README.md': '# Alex_ACT_Memory\\n\\nShared memory bus for ACT-Edition heirs.\\nSee docs/MIGRATION.md if upgrading from OneDrive-based AI-Memory.\\n',
        'announcements/README.md': '# Announcements\\n\\nRelease notes and guidance. Any heir writes here on release; all read on greeting.\\n',
        'feedback/README.md': '# Feedback\\n\\nHeir friction reports. Any heir writes here when encountering issues.\\n',
        'knowledge/index.json': '[]',
        'knowledge/README.md': '# Knowledge\\n\\nCurated knowledge packages. See index.json for registry.\\n',
        '.gitignore': '# OS\\nThumbs.db\\n.DS_Store\\n\\n# Editor\\n.vscode/\\n*.swp\\n\\n# Local secrets\\n.env\\n.env.*\\n!.env.example\\n',
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
 * Read one exact local secret without importing or enumerating environment data.
 * @param {string} memoryRoot
 * @param {string} variableName
 * @param {{environment?: object, projectRoot?: string, envFile?: string, required?: boolean}} [options]
 * @returns {string|null}
 */
function readMemorySecret(memoryRoot, variableName, options = {}) {
    const projectRoot = options.projectRoot || process.cwd();
    const envFiles = [];
    if (options.envFile) envFiles.push(options.envFile);
    envFiles.push(path.join(projectRoot, '.env'));
    envFiles.push(path.join(memoryRoot, '.env'));
    return readSecretFromSources({
        environment: options.environment || process.env,
        envFiles,
        variableName,
        requireGitignored: true,
        required: options.required === true,
    });
}

/**
 * Read an encrypted user profile from Memory. Missing authorization skips the
 * optional profile while authentication or envelope failures remain explicit.
 * @param {string} memoryRoot
 * @param {{environment?: object, projectRoot?: string, envFile?: string}} [options]
 * @returns {object|null}
 */
function readProfile(memoryRoot, options = {}) {
    const username = sanitizePathSegment(process.env.USER || process.env.USERNAME || 'default');
    const profilePath = path.join(memoryRoot, 'profile', username, 'user-profile.encrypted.json');
    const fallbackPath = path.join(memoryRoot, 'profile', 'default', 'user-profile.encrypted.json');
    const target = fs.existsSync(profilePath) ? profilePath : (fs.existsSync(fallbackPath) ? fallbackPath : null);
    if (!target) return null;
    const password = readMemorySecret(memoryRoot, PASSWORD_ENV, options);
    if (!password) return null;
    let envelope;
    try {
        envelope = JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch {
        throw new ProfileCryptoError('PROFILE_ENVELOPE_INVALID', 'Encrypted profile envelope is invalid');
    }
    const plaintext = decryptEnvelope(envelope, password);
    try {
        return JSON.parse(plaintext.toString('utf8'));
    } catch {
        throw new ProfileCryptoError('PROFILE_CONTENT_INVALID', 'Decrypted profile content is invalid');
    } finally {
        plaintext.fill(0);
    }
}

/**
 * Write an encrypted profile locally. Repository synchronization is an
 * explicit user decision and is never performed by this function.
 * @param {string} memoryRoot
 * @param {object} profile
 * @param {{environment?: object, projectRoot?: string, envFile?: string}} [options]
 */
function writeProfile(memoryRoot, profile, options = {}) {
    const username = sanitizePathSegment(process.env.USER || process.env.USERNAME || 'default');
    const profilePath = path.join(memoryRoot, 'profile', username, 'user-profile.encrypted.json');
    const password = readMemorySecret(memoryRoot, PASSWORD_ENV, options);
    if (!password) {
        throw new ProfileCryptoError(
            'PROFILE_PASSWORD_MISSING',
            `Profile password is unavailable in ${PASSWORD_ENV}`
        );
    }
    const plaintext = Buffer.from(JSON.stringify(profile));
    try {
        writeJsonAtomic(profilePath, encryptBuffer(plaintext, password));
    } finally {
        plaintext.fill(0);
    }
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

module.exports = { resolveMemoryBus, readMemorySecret, readProfile, writeProfile, scaffoldMemoryRepo, MEMORY_REPO_NAME, MEMORY_REMOTE, EDITION_OWNED, HEIR_OWNED, BOOTSTRAP_TEMPLATES };

// ── CLI mode ───────────────────────────────────────────────────────
// node _registry.cjs --resolve [dir]     Resolve memory bus
// node _registry.cjs --profile [dir]     Check encrypted profile availability
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
            try {
                const profile = readProfile(bus.root, { projectRoot: dir });
                console.log(profile ? '(profile available)' : '(no authorized profile available)');
            } catch (cause) {
                const code = cause instanceof ProfileCryptoError ? cause.code : 'PROFILE_READ_FAILED';
                console.error(`${code}: profile unavailable`);
                process.exitCode = 1;
            }
        } else {
            console.log('(no memory bus)');
        }
    } else {
        console.log('Usage:');
        console.log('  node _registry.cjs --resolve [dir]     Resolve memory bus');
        console.log('  node _registry.cjs --profile [dir]     Check encrypted profile availability');
    }
}
