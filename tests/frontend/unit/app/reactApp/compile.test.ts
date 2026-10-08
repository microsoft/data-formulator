import { describe, expect, it } from 'vitest';

import { ALLOWED_IMPORTS, compileReactApp, mountScript, parseReactAppManifest } from '../../../../../src/app/reactApp/compile';
import { MODULES } from '../../../../../src/app/reactApp/runtime/index';

const APP = `// @df-app {"version": 2, "title": "Sales", "tables": ["sales", 3, "sales"]}
import { useState } from 'react';
import { Page } from '@df/ui';
export default function App() {
  const [n] = useState(1);
  return <Page title="Sales">{n}</Page>;
}
`;

describe('parseReactAppManifest', () => {
    it('reads the header line and ignores invalid tables', () => {
        expect(parseReactAppManifest(APP)).toEqual({ version: 2, title: 'Sales', tables: ['sales'] });
    });

    it('falls back to no tables without a valid header', () => {
        expect(parseReactAppManifest('export default 1').tables).toEqual([]);
        expect(parseReactAppManifest('// @df-app {oops\nexport default 1').tables).toEqual([]);
    });
});

describe('compileReactApp', () => {
    it('compiles JSX to a CommonJS module using only allowed imports', () => {
        const result = compileReactApp(APP);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.code).toContain("require('@df/ui')");
        expect(result.code).toContain('require("react/jsx-runtime")');
        expect(result.code).toMatch(/exports\.default = App/);
        expect(mountScript(result.code)).toMatch(/^window\.__DF_REACT__\.mount\(function \(require, module, exports\) \{/);
    });

    it('accepts TypeScript syntax', () => {
        expect(compileReactApp('const n: number = 1;\nexport default function App(): JSX.Element { return <b>{n}</b>; }').ok).toBe(true);
    });

    it('reports syntax errors with their position', () => {
        const result = compileReactApp('export default function App() {\n  return <div>;\n}');
        expect(result).toMatchObject({ ok: false });
        if (result.ok) return;
        expect(result.error).toMatch(/^Syntax error at line 2, column \d+: Unexpected token/);
    });

    it('rejects imports the runtime does not provide and a missing default export', () => {
        const imported = compileReactApp("import _ from 'lodash';\nimport x from 'https://cdn.example/x.js';\nexport default () => null;");
        expect(imported).toMatchObject({ ok: false, error: expect.stringContaining('Cannot import "lodash", "https://cdn.example/x.js"') });
        expect(compileReactApp('function App() { return null; }')).toMatchObject({ ok: false, error: expect.stringContaining('export default') });
    });

    it('allows exactly the modules the runtime provides', () => {
        expect([...ALLOWED_IMPORTS].sort()).toEqual(Object.keys(MODULES).sort());
    });
});
