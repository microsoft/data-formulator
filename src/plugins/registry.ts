// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Plugin registry — build-time discovery via `import.meta.glob`.
 *
 * Every sub-directory under `src/plugins/` that contains an `index.ts`
 * exporting a {@link DataSourcePluginModule} is automatically discovered.
 * The registry merges these modules with the backend `PLUGINS` config
 * from `/api/app-config` so only **enabled** plugins are surfaced.
 */

import type { DataSourcePluginModule, PluginConfig } from './types';
import i18n from '../i18n';

// Build-time eager import of every `plugins/*/index.{ts,tsx}`
const pluginModules = import.meta.glob<{ default: DataSourcePluginModule }>(
    ['./**/index.ts', './**/index.tsx'],
    { eager: true },
);

/** All frontend plugin modules keyed by `id`. */
const _modules: Map<string, DataSourcePluginModule> = new Map();

for (const [path, mod] of Object.entries(pluginModules)) {
    if (path === './index.ts' || path === './index.tsx') continue;
    const plugin = mod.default;
    if (plugin?.id) {
        _modules.set(plugin.id, plugin);
    }
}

/**
 * Return the list of plugins that are both:
 * 1. Discovered on the frontend (have an `index.ts`)
 * 2. Enabled on the backend (present in `PLUGINS` from app-config)
 */
export function getEnabledPlugins(
    backendPlugins: Record<string, PluginConfig> | undefined,
): Array<{ module: DataSourcePluginModule; config: PluginConfig }> {
    if (!backendPlugins) return [];

    const result: Array<{ module: DataSourcePluginModule; config: PluginConfig }> = [];
    for (const [id, config] of Object.entries(backendPlugins)) {
        const mod = _modules.get(id);
        if (mod) {
            result.push({ module: mod, config });
        }
    }
    return result;
}

/** Get a single plugin module by id (for direct rendering). */
export function getPluginModule(id: string): DataSourcePluginModule | undefined {
    return _modules.get(id);
}

/**
 * Merge each plugin's self-contained translations into the i18next
 * `translation` namespace.  Call once at app startup, after i18n.init().
 */
export function registerPluginTranslations(): void {
    for (const [, mod] of _modules) {
        if (!mod.locales) continue;
        for (const [lang, bundle] of Object.entries(mod.locales)) {
            i18n.addResourceBundle(lang, 'translation', bundle, true, true);
        }
    }
}
