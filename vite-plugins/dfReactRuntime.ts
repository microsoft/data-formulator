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
import { build, type Plugin as EsbuildPlugin } from 'esbuild';
import type { Plugin } from 'vite';

const VIRTUAL_ID = 'virtual:df-react-runtime';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
/** Optional module bundles by virtual-id suffix. */
const OPTIONAL_ENTRIES: Record<string, string> = { d3: 'd3.ts', lodash: 'lodash.ts', geo: 'geo.ts', 'flint-links': 'flintLinks.ts' };

/** The frame loads vega and vega-lite as scripts before the runtime; Flint's renderer uses those globals. */
const IFRAME_GLOBALS: Record<string, string> = { 'vega': 'vega', 'vega-lite': 'vegaLite' };

/**
 * Keep Flint's interactive layer to what apps use: Vega and Vega-Lite come from the frame's
 * scripts, the other backends' adapters are left out (apps draw with Vega-Lite only), and the
 * link validator loads from the `flint-links` optional bundle, only into apps that link charts.
 */
const flintRuntime: EsbuildPlugin = {
    name: 'df-flint-runtime',
    setup(context) {
        context.onResolve({ filter: /^(vega|vega-lite)$/ }, args => ({ path: args.path, namespace: 'df-iframe-global' }));
        context.onLoad({ filter: /.*/, namespace: 'df-iframe-global' }, args => ({
            contents: `module.exports = globalThis.${IFRAME_GLOBALS[args.path]};`, loader: 'js' }));
        context.onResolve({ filter: /^\.\.\/(plotly|echarts|chartjs)\/interactive$/ }, args => ({ path: args.path, namespace: 'df-no-backend' }));
        context.onLoad({ filter: /.*/, namespace: 'df-no-backend' }, args => ({
            contents: `throw new Error(${JSON.stringify(`Apps draw charts with Vega-Lite; ${args.path} is not in the app runtime.`)});`, loader: 'js' }));
        context.onResolve({ filter: /^\.\.\/validate\/links$/ }, () => ({ path: 'flint-links', namespace: 'df-flint-links' }));
        context.onLoad({ filter: /.*/, namespace: 'df-flint-links' }, () => ({ loader: 'js', contents:
            `export function validateLinks(inputs, spec) {
                const links = globalThis.__DF_OPTIONAL_MODULES__ && globalThis.__DF_OPTIONAL_MODULES__['flint-links'];
                if (!links) throw new Error('Chart links did not load in this app. Reload the app to try again.');
                return links.validateLinks(inputs, spec);
            }` }));
    },
};

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
                plugins: [flintRuntime],
                external: ['echarts', 'chart.js', 'chart.js/auto', 'plotly.js', 'plotly.js-dist-min'],
                ...(options.flintChartLocal
                    ? { alias: { 'flint-chart': path.resolve(options.root, options.flintChartLocal) } }
                    : {}),
            });
            for (const input of Object.keys(result.metafile.inputs)) {
                // Modules the plugin makes up (`df-…:name`) are not files to watch.
                if (!input.includes('node_modules') && !/^df-[\w-]+:/.test(input)) this.addWatchFile(path.resolve(input));
            }
            return `export default ${JSON.stringify(result.outputFiles[0].text)};`;
        },
    };
}
