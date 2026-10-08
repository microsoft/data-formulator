// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Serves `virtual:df-react-runtime`: the sandboxed React app runtime
 * (src/app/reactApp/runtime) bundled by esbuild into one IIFE script and exported
 * as a string, so the host can inline it into the app frame (like vega.min.js?raw).
 */

import path from 'path';
import { build } from 'esbuild';
import type { Plugin } from 'vite';

const VIRTUAL_ID = 'virtual:df-react-runtime';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

export function dfReactRuntime(options: { root: string; flintChartLocal?: string }): Plugin {
    let production = false;
    return {
        name: 'df-react-runtime',
        configResolved(config) {
            production = config.command === 'build' && config.mode === 'production';
        },
        resolveId(id) {
            return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
        },
        async load(id) {
            if (id !== RESOLVED_ID) return undefined;
            const result = await build({
                entryPoints: [path.join(options.root, 'src/app/reactApp/runtime/index.tsx')],
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
