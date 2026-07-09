#!/usr/bin/env node
/**
 * audit-mall-drift.cjs
 *
 * Mechanical drift detector for heir-installed Mall plugins in
 * .github/skills/local/<plugin>/.
 *
 * What it does (mechanical):
 *   - Loads the Mall trust-scored catalog index (catalog/index.json, schema 3.0)
 *     from a local sibling clone first, then GitHub raw as fallback.
 *   - Reads local plugin manifests from .github/skills/local/<plugin>/.install.json
 *     (preferred — written by /mall-install when shipped) or plugin.json (legacy).
 *   - Classifies each local plugin as:
 *     IN_SYNC | UPDATED_UPSTREAM | DEPRECATED_UPSTREAM | UNMANAGED_LOCAL_PLUGIN
 *   - Emits summary + table (or JSON with --json).
 *
 * What it does NOT do (semantic):
 *   - Apply updates.
 *   - Remove plugins.
 *   - Decide policy.
 *
 * Catalog schema (post-ADR-008 / Phase 5a):
 *   Each entry in `plugins[]` carries { name, store, shape, trust_score, version,
 *   description_short, source_url, provenance, adapted_from }. Plugins with the
 *   same name can appear in multiple stores; identity for drift purposes is the
 *   (store, name) pair. Local plugin manifests carry `store` + `name` for matching.
 *
 * @inheritance inheritable
 * @currency 2026-05-31
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const quiet = args.includes('--quiet');
const allowNetwork = !args.includes('--no-network');
const catalogArg = args.find((a) => a.startsWith('--catalog='));

const RAW_CATALOG_URL =
    'https://raw.githubusercontent.com/fabioc-aloha/Alex_Skill_Mall/main/catalog/index.json';
const MALL_CLONE_DIR_NAME = 'Alex_Skill_Mall';

function usage() {
    console.log(`Usage: node .github/scripts/audit-mall-drift.cjs [options]

Options:
  --catalog=<path>   Use specific catalog/index.json path
  --no-network       Disable HTTPS fallback (local clone only)
  --json             Emit JSON report
  --quiet            Summary line only (ignored with --json)
  --help, -h         Show this message

Catalog discovery order:
  1. --catalog=<path> if supplied
  2. ./catalog/index.json (running from inside Mall clone)
  3. ../Alex_Skill_Mall/catalog/index.json (sibling clone)
  4. C:\\Development\\Alex_Skill_Mall\\catalog\\index.json (Windows default)
  5. ~/Alex_Skill_Mall/catalog/index.json (Unix default)
  6. HTTPS fallback to raw.githubusercontent.com (unless --no-network)

Exit codes:
  0  all managed plugins are IN_SYNC (or no managed plugins)
  1  one or more UPDATED_UPSTREAM / DEPRECATED_UPSTREAM / UNMANAGED_LOCAL_PLUGIN
  2  catalog unavailable or local manifest parse error
`);
}

if (args.includes('--help') || args.includes('-h')) {
    usage();
    process.exit(0);
}

function fileExists(p) {
    try {
        fs.accessSync(p, fs.constants.R_OK);
        return true;
    } catch {
        return false;
    }
}

function readJson(p) {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function fetchJsonHttps(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                } catch (err) {
                    reject(new Error(`Malformed JSON from ${url}: ${err.message}`));
                }
            });
            res.on('error', reject);
        });
        req.setTimeout(timeoutMs, () => { req.destroy(new Error(`Timeout after ${timeoutMs}ms`)); });
        req.on('error', reject);
    });
}

async function tryLoadCatalog() {
    const candidates = [];
    if (catalogArg) candidates.push(path.resolve(process.cwd(), catalogArg.split('=')[1]));
    candidates.push(path.join(process.cwd(), 'catalog', 'index.json'));
    candidates.push(path.join(process.cwd(), '..', MALL_CLONE_DIR_NAME, 'catalog', 'index.json'));
    if (process.platform === 'win32') {
        candidates.push(path.join('C:\\Development', MALL_CLONE_DIR_NAME, 'catalog', 'index.json'));
    } else {
        // Mac/Linux symmetric fallback for the canonical Development tree.
        candidates.push(path.join(os.homedir(), 'Development', MALL_CLONE_DIR_NAME, 'catalog', 'index.json'));
    }
    candidates.push(path.join(os.homedir(), MALL_CLONE_DIR_NAME, 'catalog', 'index.json'));

    for (const p of candidates) {
        if (fileExists(p)) {
            return { catalog: readJson(p), source: p };
        }
    }

    if (!allowNetwork) {
        return null;
    }

    try {
        const catalog = await fetchJsonHttps(RAW_CATALOG_URL, 15000);
        return { catalog, source: RAW_CATALOG_URL };
    } catch {
        return null;
    }
}

function scanLocalPluginDirs(localSkillsDir) {
    const rows = [];
    if (!fileExists(localSkillsDir)) return rows;

    const dirs = fs.readdirSync(localSkillsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b));

    for (const d of dirs) {
        const pluginDir = path.join(localSkillsDir, d);
        // Preferred manifest: .install.json (record of how /mall-install fetched
        // the plugin, including store + version pin). Legacy fallback: plugin.json
        // (pre-ADR-008 Mall-bundled manifest, may still ship inside the plugin).
        const installManifestPath = path.join(pluginDir, '.install.json');
        const legacyManifestPath = path.join(pluginDir, 'plugin.json');

        let manifestPath = null;
        if (fileExists(installManifestPath)) manifestPath = installManifestPath;
        else if (fileExists(legacyManifestPath)) manifestPath = legacyManifestPath;

        if (!manifestPath) {
            rows.push({
                name: d,
                state: 'UNMANAGED_LOCAL_PLUGIN',
                source_url: '(local-only)',
                delta: 'No .install.json or plugin.json; cannot match against Mall catalog',
                plugin_dir: pluginDir,
                managed: false,
            });
            continue;
        }

        let manifest;
        try {
            manifest = readJson(manifestPath);
        } catch (err) {
            throw new Error(`Invalid JSON in ${manifestPath}: ${err.message}`);
        }

        // Normalise: .install.json uses `plugin`+`store`; plugin.json uses `name`
        // and may omit `store` (legacy). Default store to `plugin-mall` when absent
        // because pre-ADR-008 installs predominantly came from the curated tier.
        const normalised = {
            name: String(manifest.plugin || manifest.name || d),
            store: String(manifest.store || 'plugin-mall'),
            version: String(manifest.version_at_install || manifest.version || ''),
            source_url_at_install: String(manifest.source_url || ''),
        };

        rows.push({
            name: normalised.name,
            store: normalised.store,
            version_at_install: normalised.version,
            source_url_at_install: normalised.source_url_at_install,
            plugin_dir: pluginDir,
            manifest_path: manifestPath,
            manifest_kind: manifestPath === installManifestPath ? 'install' : 'legacy',
            managed: true,
        });
    }

    return rows;
}

function classify(rows, plugins) {
    // Catalog is a flat array of {store, name, ...}; build a (store, name) index
    // and a name-only fallback for legacy plugin.json manifests that lack store.
    const byKey = new Map(); // "<store>::<name>" -> entry
    const byName = new Map(); // "<name>" -> [entry, ...]
    for (const p of plugins) {
        const key = `${p.store}::${p.name}`;
        byKey.set(key, p);
        const list = byName.get(p.name) || [];
        list.push(p);
        byName.set(p.name, list);
    }

    const out = [];
    for (const r of rows) {
        if (!r.managed) {
            out.push(r);
            continue;
        }

        const key = `${r.store}::${r.name}`;
        let c = byKey.get(key);
        let storeFallback = false;

        if (!c) {
            // Try name-only match (legacy plugin.json without store field).
            const matches = byName.get(r.name) || [];
            if (matches.length === 1) {
                c = matches[0];
                storeFallback = true;
            } else if (matches.length > 1) {
                out.push({
                    ...r,
                    source_url: '(ambiguous; multiple stores carry this name)',
                    state: 'UNMANAGED_LOCAL_PLUGIN',
                    delta: `Name "${r.name}" appears in ${matches.length} stores; local manifest lacks 'store' field to disambiguate. Add { "store": "<store-name>" } to plugin.json.`,
                });
                continue;
            }
        }

        if (!c) {
            out.push({
                ...r,
                source_url: '(not found in catalog)',
                state: 'DEPRECATED_UPSTREAM',
                delta: r.store
                    ? `Plugin ${r.store}/${r.name} not found in current catalog index`
                    : `Plugin name "${r.name}" not found in current catalog index`,
            });
            continue;
        }

        const deltas = [];
        if (storeFallback) {
            deltas.push(`store inferred from name match (${c.store})`);
        }
        if (r.version_at_install && c.version && r.version_at_install !== c.version) {
            deltas.push(`version ${r.version_at_install} -> ${c.version}`);
        }

        out.push({
            ...r,
            source_url: c.source_url || '(unknown)',
            store_resolved: c.store,
            version_upstream: c.version || '',
            trust_score_upstream: c.trust_score || null,
            state: deltas.length ? 'UPDATED_UPSTREAM' : 'IN_SYNC',
            delta: deltas.join('; '),
            catalog: c,
        });
    }

    return out;
}

function summarize(rows) {
    const summary = {};
    for (const r of rows) {
        summary[r.state] = (summary[r.state] || 0) + 1;
    }
    return summary;
}

function printTable(rows) {
    if (!rows.length) {
        console.log('No local plugins detected under .github/skills/local/.');
        return;
    }

    const data = rows.map((r) => ({
        name: r.name,
        store: r.store || '',
        state: r.state,
        delta: r.delta || '',
    }));

    const widths = {
        name: Math.max('name'.length, ...data.map((x) => x.name.length)),
        store: Math.max('store'.length, ...data.map((x) => x.store.length)),
        state: Math.max('state'.length, ...data.map((x) => x.state.length)),
        delta: Math.max('delta'.length, ...data.map((x) => x.delta.length)),
    };

    const pad = (s, n) => String(s).padEnd(n, ' ');
    console.log(`${pad('name', widths.name)}  ${pad('store', widths.store)}  ${pad('state', widths.state)}  delta`);
    console.log(`${'-'.repeat(widths.name)}  ${'-'.repeat(widths.store)}  ${'-'.repeat(widths.state)}  ${'-'.repeat(widths.delta)}`);
    for (const r of data.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name))) {
        console.log(`${pad(r.name, widths.name)}  ${pad(r.store, widths.store)}  ${pad(r.state, widths.state)}  ${r.delta}`);
    }
}

async function main() {
    const catalogPayload = await tryLoadCatalog();
    if (!catalogPayload) {
        const msg = `Mall catalog not found. Tried local clones (e.g. ../${MALL_CLONE_DIR_NAME}/catalog/index.json)${allowNetwork ? ' and HTTPS fallback' : ' (network disabled)'}. Provide --catalog=<path> or clone the Mall as a sibling repo: git clone https://github.com/fabioc-aloha/Alex_Skill_Mall.git ../${MALL_CLONE_DIR_NAME}`;
        if (jsonMode) {
            console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
        } else {
            console.error(`ERROR: ${msg}`);
        }
        process.exit(2);
    }

    const catalog = catalogPayload.catalog;
    if (!catalog || !Array.isArray(catalog.plugins)) {
        const msg = `Invalid catalog schema at ${catalogPayload.source}: expected { plugins: [...] }`;
        if (jsonMode) {
            console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
        } else {
            console.error(`ERROR: ${msg}`);
        }
        process.exit(2);
    }

    const localSkillsDir = path.join(process.cwd(), '.github', 'skills', 'local');

    let scanned;
    try {
        scanned = scanLocalPluginDirs(localSkillsDir);
    } catch (err) {
        if (jsonMode) {
            console.log(JSON.stringify({ ok: false, error: err.message }, null, 2));
        } else {
            console.error(`ERROR: ${err.message}`);
        }
        process.exit(2);
    }

    const rows = classify(scanned, catalog.plugins);
    const summary = summarize(rows);
    const actionable =
        (summary.UPDATED_UPSTREAM || 0) +
        (summary.DEPRECATED_UPSTREAM || 0) +
        (summary.UNMANAGED_LOCAL_PLUGIN || 0);

    if (jsonMode) {
        console.log(JSON.stringify({
            ok: true,
            catalog_source: catalogPayload.source,
            catalog_schema_version: catalog.schema_version || null,
            catalog_plugin_count: catalog.plugins.length,
            local_root: localSkillsDir,
            summary,
            total: rows.length,
            actionable,
            rows: rows.map((r) => ({
                name: r.name,
                store: r.store || null,
                state: r.state,
                version_at_install: r.version_at_install || null,
                version_upstream: r.version_upstream || null,
                trust_score_upstream: r.trust_score_upstream || null,
                source_url: r.source_url || null,
                delta: r.delta || '',
                plugin_dir: r.plugin_dir,
                manifest_path: r.manifest_path || null,
                manifest_kind: r.manifest_kind || null,
            })),
        }, null, 2));
    } else if (!quiet) {
        console.log('audit-mall-drift');
        console.log(`  catalog: ${catalogPayload.source} (schema ${catalog.schema_version || '?'}; ${catalog.plugins.length} plugins)`);
        console.log(`  local: ${localSkillsDir}`);
        console.log('');
        const states = ['IN_SYNC', 'UPDATED_UPSTREAM', 'DEPRECATED_UPSTREAM', 'UNMANAGED_LOCAL_PLUGIN'];
        for (const s of states) {
            if (summary[s]) console.log(`  ${s}: ${summary[s]}`);
        }
        console.log(`  TOTAL: ${rows.length}`);
        console.log('');
        printTable(rows);
    } else {
        // Quiet summary line
        const parts = ['audit-mall-drift'];
        for (const s of ['IN_SYNC', 'UPDATED_UPSTREAM', 'DEPRECATED_UPSTREAM', 'UNMANAGED_LOCAL_PLUGIN']) {
            if (summary[s]) parts.push(`${s}=${summary[s]}`);
        }
        parts.push(`TOTAL=${rows.length}`);
        console.log(parts.join(' '));
    }

    process.exit(actionable > 0 ? 1 : 0);
}

main().catch((err) => {
    if (jsonMode) {
        console.log(JSON.stringify({ ok: false, error: err.message || String(err) }, null, 2));
    } else {
        console.error(`ERROR: ${err.message || err}`);
    }
    process.exit(2);
});
