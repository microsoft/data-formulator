// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Host-side compilation of React app artifacts (`*.app.jsx`).
 *
 * Sucrase turns the agent's single JSX file into a CommonJS module that the
 * sandboxed runtime evaluates with its own `require`. Compiling is a pure text
 * transform; the host never runs app code.
 */

import { transform } from 'sucrase';

import type { HtmlAppManifest } from '../htmlApp/htmlAppDocument';

export const REACT_APP_FILE = /\.app\.jsx$/i;

/** Modules the runtime provides; must match `MODULES` in runtime/index.tsx. */
export const ALLOWED_IMPORTS = [
    'react', 'react/jsx-runtime', '@df/ui', '@df/data', '@df/chart', '@df/format', '@df/icons', '@mui/material',
];

const MANIFEST_LINE = /^\s*\/\/\s*@df-app\s+(\{.*\})\s*$/m;

/** Read the `// @df-app {...}` header the backend stamps on the first line. */
export function parseReactAppManifest(source: string): HtmlAppManifest {
    const empty = { version: 2, title: '', tables: [] as string[] };
    const match = MANIFEST_LINE.exec(source);
    if (!match) return empty;
    try {
        const parsed = JSON.parse(match[1]);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
        const tables: string[] = Array.isArray(parsed.tables)
            ? Array.from(new Set<string>(parsed.tables.filter((table: unknown): table is string => typeof table === 'string' && table.length > 0)))
            : [];
        return { version: 2, title: typeof parsed.title === 'string' ? parsed.title : '', tables };
    } catch {
        return empty;
    }
}

export type CompileResult =
    | { ok: true; code: string; manifest: HtmlAppManifest }
    | { ok: false; error: string; manifest: HtmlAppManifest };

/** Compile app source to a CommonJS module body, or explain why it cannot run. */
export function compileReactApp(source: string): CompileResult {
    const manifest = parseReactAppManifest(source);
    let code: string;
    try {
        code = transform(source, {
            transforms: ['jsx', 'typescript', 'imports'],
            jsxRuntime: 'automatic',
            production: true,
            filePath: 'App.tsx',
        }).code;
    } catch (error) {
        const loc = (error as { loc?: { line: number; column: number } }).loc;
        const message = error instanceof Error ? error.message.replace(/^Error transforming App\.tsx:\s*/, '') : String(error);
        return { ok: false, manifest, error: `Syntax error${loc ? ` at line ${loc.line}, column ${loc.column + 1}` : ''}: ${message.replace(/\s*\(\d+:\d+\)$/, '')}` };
    }
    const imports = [
        ...[...code.matchAll(/\brequire\((['"])([^'"]+)\1\)/g)].map(match => match[2]),
        // Sucrase drops unused imports, so check the source as well.
        ...[...source.matchAll(/^\s*(?:import|export)\s[^'";]*?\bfrom\s*(['"])([^'"]+)\1/gm)].map(match => match[2]),
        ...[...source.matchAll(/^\s*import\s*(['"])([^'"]+)\1/gm)].map(match => match[2]),
        ...[...source.matchAll(/\b(?:require|import)\s*\(\s*(['"])([^'"]+)\1\s*\)/g)].map(match => match[2]),
    ];
    const disallowed = [...new Set(imports.filter(name => !ALLOWED_IMPORTS.includes(name)))];
    if (disallowed.length) {
        return { ok: false, manifest, error: `Cannot import ${disallowed.map(name => `"${name}"`).join(', ')}. Apps can import only: ${ALLOWED_IMPORTS.filter(name => name !== 'react/jsx-runtime').join(', ')}.` };
    }
    if (!/\bexports\.\s*default\s*=/.test(code)) {
        return { ok: false, manifest, error: 'The app must `export default` a React component.' };
    }
    return { ok: true, code, manifest };
}

/** The script that evaluates the compiled module and mounts it in the app frame. */
export const mountScript = (code: string) =>
    `window.__DF_REACT__.mount(function (require, module, exports) {\n${code}\n});`;
