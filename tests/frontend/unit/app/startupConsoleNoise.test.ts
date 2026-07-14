import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../..');

function readSource(relativePath: string): string {
    return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('startup console noise', () => {
    it('should not preload demo or deferred application images at startup', () => {
        const html = readSource('index.html');
        const dataFormulator = readSource('src/views/DataFormulator.tsx');

        expect(html).not.toContain('rel="preload" as="image"');
        expect(dataFormulator).not.toContain("link.rel = 'preload'");
    });

    it('should not emit unconditional workspace or API request debug logs', () => {
        const app = readSource('src/app/App.tsx');
        const utils = readSource('src/app/utils.tsx');
        const dataRefresh = readSource('src/app/useDataRefresh.tsx');

        expect(app).not.toContain("console.log('Rendering WorkspaceMenu");
        expect(app).not.toContain("console.log('[DEBUG] activeWorkspace:");
        expect(utils).not.toContain('with headers:`');
        expect(dataRefresh).not.toContain('[DerivedRefresh] useEffect triggered');
        expect(dataRefresh).not.toContain('[DerivedRefresh] First run');
    });
});
