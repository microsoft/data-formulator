import { describe, expect, it } from 'vitest';

import { ALLOWED_IMPORTS, compileReactApp, mountScript, parseReactAppManifest } from '../../../../../src/app/reactApp/compile';
import { MODULES, OPTIONAL_MODULES } from '../../../../../src/app/reactApp/runtime/index';

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
        expect(result.error).toMatch(/^Syntax error at line 2, column 11: JSX element 'div' has no corresponding closing tag/);
    });

    it('points at a missing brace in a JSX object attribute, not at the next element', () => {
        const result = compileReactApp([
            'export default function App() {',
            '  return <div>',
            "    <Chart encodings={{x:{field:'date'},y:{field:'price'}} labels={{date:'Week'}}/>",
            '    <Kpis />',
            '  </div>;',
            '}',
        ].join('\n'));
        expect(result).toMatchObject({ ok: false });
        if (result.ok) return;
        expect(result.error).toMatch(/^Syntax error at line 3, column \d+: '}' expected\. \(just before "labels=\{\{date:'Week'/);
    });

    it('rejects imports the runtime does not provide and a missing default export', () => {
        const imported = compileReactApp("import moment from 'moment';\nimport x from 'https://cdn.example/x.js';\nexport default () => null;");
        expect(imported).toMatchObject({ ok: false, error: expect.stringContaining('Cannot import "moment", "https://cdn.example/x.js"') });
        expect(compileReactApp('function App() { return null; }')).toMatchObject({ ok: false, error: expect.stringContaining('export default') });
    });

    it('allows exactly the modules the runtime provides, core and optional', () => {
        expect([...ALLOWED_IMPORTS].sort()).toEqual([...Object.keys(MODULES), ...OPTIONAL_MODULES].sort());
    });
});

describe('optional modules', () => {
    const optional = (source: string) => {
        const result = compileReactApp(source);
        return result.ok ? result.optionalModules : result.error;
    };

    it('loads only the optional bundles an app uses', () => {
        expect(optional("import _ from 'lodash';\nexport default function App() { return <b>{_.sum([1])}</b>; }")).toEqual(['lodash']);
        expect(optional("import * as d3 from 'd3';\nimport { countries } from '@df/geo';\nexport default function App() { return <b>{countries().length}{d3.max([1])}</b>; }"))
            .toEqual(['d3', '@df/geo']);
        expect(optional("export default function App() { return <b>plain</b>; }")).toEqual([]);
    });

    it('loads map boundaries for a Flint map', () => {
        expect(optional("import { FlintChart } from '@df/chart';\nexport default function App() { return <FlintChart chartType=\"Choropleth\" encodings={{}} />; }"))
            .toEqual(['@df/geo']);
    });

    it('still refuses other packages', () => {
        expect(optional("import { groupBy } from 'lodash/groupBy';\nexport default function App() { return null; }"))
            .toMatch(/Cannot import "lodash\/groupBy"/);
    });

    it('reads declared sources from the manifest', () => {
        expect(parseReactAppManifest('// @df-app {"version": 2, "title": "Live", "tables": [], "sources": ["external:kusto:Events", 1]}\nexport default 1'))
            .toEqual({ version: 2, title: 'Live', tables: [], sources: ['external:kusto:Events'] });
    });
});
