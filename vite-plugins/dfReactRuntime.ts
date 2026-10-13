// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Serves `virtual:df-react-runtime`: the sandboxed React app runtime
 * (src/app/reactApp/runtime) bundled by esbuild into one IIFE script and exported
 * as a string, so the host can inline it into the app frame (like vega.min.js?raw).
 *
 * Optional app modules are separate virtual modules, `virtual:df-react-runtime/<name>`
 * (d3, lodash, geo), so the host loads and injects them only for apps that use them.
 */

import path from 'path';
import { build } from 'esbuild';
import type { Plugin } from 'vite';

const VIRTUAL_ID = 'virtual:df-react-runtime';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
/** Optional module bundles by virtual-id suffix. */
const OPTIONAL_ENTRIES: Record<string, string> = { d3: 'd3.ts', lodash: 'lodash.ts', geo: 'geo.ts' };

export function dfReactRuntime(options: { root: string; flintChartLocal?: string }): Plugin {
    let production = false;
    return {
        name: 'df-react-runtime',
        configResolved(config) {
            production = config.command === 'build' && config.mode === 'production';
        },
        resolveId(id) {
            if (id === VIRTUAL_ID) return RESOLVED_ID;
            const optional = id.startsWith(`${VIRTUAL_ID}/`) ? id.slice(VIRTUAL_ID.length + 1) : '';
            return optional && OPTIONAL_ENTRIES[optional] ? `\0${id}` : undefined;
        },
        async load(id) {
            const optional = id.startsWith(`${RESOLVED_ID}/`) ? id.slice(RESOLVED_ID.length + 1) : '';
            if (id !== RESOLVED_ID && !OPTIONAL_ENTRIES[optional]) return undefined;
            const entry = optional
                ? path.join(options.root, 'src/app/reactApp/runtime/optional', OPTIONAL_ENTRIES[optional])
                : path.join(options.root, 'src/app/reactApp/runtime/index.tsx');
            const result = await build({
                entryPoints: [entry],
                bundle: true,
                write: false,
                format: 'iife',
                platform: 'browser',
                target: 'es2020',
                jsx: 'automatic',
                // Development React keeps error messages readable for the repair loop.
                minify: production,
                define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
                legalComments: 'none',
                metafile: true,
                logLevel: 'silent',
                ...(options.flintChartLocal
                    ? { alias: { 'flint-chart': path.resolve(options.root, options.flintChartLocal) } }
                    : {}),
            });
            for (const input of Object.keys(result.metafile.inputs)) {
                if (!input.includes('node_modules')) this.addWatchFile(path.resolve(input));
            }
            return `export default ${JSON.stringify(result.outputFiles[0].text)};`;
        },
    };
}
