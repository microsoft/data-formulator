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
import ts from 'typescript';

import type { HtmlAppManifest } from '../htmlApp/htmlAppDocument';

export const REACT_APP_FILE = /\.app\.jsx$/i;

/** Modules the runtime provides; must match `MODULES` in runtime/index.tsx. */
/** Modules in their own runtime bundles, injected only into apps that use them. */
export const OPTIONAL_IMPORTS = ['d3', 'lodash', '@df/geo'] as const;
export type OptionalImport = typeof OPTIONAL_IMPORTS[number];

export const ALLOWED_IMPORTS = [
    'react', 'react/jsx-runtime', '@df/ui', '@df/data', '@df/chart', '@df/format', '@df/icons', '@mui/material',
    ...OPTIONAL_IMPORTS,
];

/** Bundles the host injects for what an app uses beyond its imports: chart links need Flint's link validator. */
export type OptionalModule = OptionalImport | 'flint-links';

/** A Flint map draws vendored boundaries from `@df/geo`. */
const FLINT_MAP_CHART = /(['"])(?:Map|Choropleth)\1/;
/** Linked charts (`ChartLink`, `useChartLink`) check their links with Flint's validator. */
const CHART_LINK = /\b(?:ChartLink|useChartLink)\b/;

const MANIFEST_LINE = /^\s*\/\/\s*@df-app\s+(\{.*\})\s*$/m;

/** Read the `// @df-app {...}` header the backend stamps on the first line. */
export function parseReactAppManifest(source: string): HtmlAppManifest {
    const empty = { version: 2, title: '', tables: [] as string[] };
    const match = MANIFEST_LINE.exec(source);
    if (!match) return empty;
    try {
        const parsed = JSON.parse(match[1]);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
        const names = (value: unknown): string[] => Array.isArray(value)
            ? Array.from(new Set<string>(value.filter((item: unknown): item is string => typeof item === 'string' && item.length > 0)))
            : [];
        const tables = names(parsed.tables);
        const sources = names(parsed.sources);
        return { version: 2, title: typeof parsed.title === 'string' ? parsed.title : '', tables, ...(sources.length ? { sources } : {}) };
    } catch {
        return empty;
    }
}

export type CompileResult =
    | { ok: true; code: string; manifest: HtmlAppManifest; optionalModules: OptionalModule[] }
    | { ok: false; error: string; manifest: HtmlAppManifest };

/**
 * Where and why the app fails to parse. Sucrase often stops at a later symptom (for a missing `}` in
 * `encodings={{ x: {...}, y: {...} }}`, the next element), so locate the cause with TypeScript's parser,
 * and quote what follows it so the agent asked to fix it finds the spot.
 */
function describeSyntaxError(source: string, error: unknown): string {
    const diagnostic = ts.transpileModule(source, {
        reportDiagnostics: true, fileName: 'App.tsx', compilerOptions: { jsx: ts.JsxEmit.ReactJSX },
    }).diagnostics?.find(item => item.file && item.start !== undefined);
    if (diagnostic) {
        const { line, character } = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start!);
        const after = source.split('\n')[line].slice(character, character + 24).trim();
        return `Syntax error at line ${line + 1}, column ${character + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`
            + (after ? ` (just before "${after}")` : '');
    }
    const loc = (error as { loc?: { line: number; column: number } }).loc;
    const message = error instanceof Error ? error.message.replace(/^Error transforming App\.tsx:\s*/, '') : String(error);
    return `Syntax error${loc ? ` at line ${loc.line}, column ${loc.column + 1}` : ''}: ${message.replace(/\s*\(\d+:\d+\)$/, '')}`;
}

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
        return { ok: false, manifest, error: describeSyntaxError(source, error) };
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
    const optionalModules: OptionalModule[] = [...OPTIONAL_IMPORTS.filter(name => imports.includes(name)
        || (name === '@df/geo' && FLINT_MAP_CHART.test(source))), ...(CHART_LINK.test(source) ? ['flint-links' as const] : [])];
    return { ok: true, code, manifest, optionalModules };
}

/** The script that evaluates the compiled module and mounts it in the app frame. */
export const mountScript = (code: string) =>
    `window.__DF_REACT__.mount(function (require, module, exports) {\n${code}\n});`;
