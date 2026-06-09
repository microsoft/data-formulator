// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
//
// Comprehensive fixture extractor for the Flint-Py compatibility suite.
//
// Walks GALLERY_TREE, collects every page rendered with a VegaLite-relevant
// backend (single library='vegalite' OR render='triple', which always includes
// VL), and runs the JS `assembleVegaLite` on every TestCase produced by every
// referenced generator. For each case we write:
//   flint-py/tests/fixtures/<slug>/input.json
//   flint-py/tests/fixtures/<slug>/expected.json   (only on JS success)
//   flint-py/tests/fixtures/<slug>/meta.json       (always)
//
// A top-level `manifest.json` records every case with its status, chart type,
// gallery section/category/page provenance, and any JS error message.

import { describe, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { GALLERY_TREE, TEST_GENERATORS } from '../../../../../src/lib/agents-chart/test-data';
import { assembleVegaLite } from '../../../../../src/lib/agents-chart';
import type { TestCase } from '../../../../../src/lib/agents-chart/test-data/types';
import type { ChartAssemblyInput, ChartEncoding } from '../../../../../src/lib/agents-chart/core/types';

const CANVAS_SIZE = { width: 400, height: 300 } as const;
const DEFAULT_OPTIONS = { addTooltips: true } as const;

const FIXTURES_ROOT = path.resolve(__dirname, '../../../../../flint-py/tests/fixtures');

interface ManifestEntry {
    slug: string;
    title: string;
    chartType: string;
    section: string;
    category: string;
    page: string;
    generator: string;
    library: 'vegalite' | 'triple';
    status: 'js_success' | 'js_error';
    jsError?: string;
    fixtureDir?: string;
}

function slugify(s: string): string {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80);
}

/** Convert a TestCase into the ChartAssemblyInput that ChartGallery passes to assembleVegaLite. */
function testCaseToInput(tc: TestCase): ChartAssemblyInput {
    const encodings: Record<string, ChartEncoding> = {};
    for (const [channel, ei] of Object.entries(tc.encodingMap)) {
        if (ei && ei.fieldID) {
            const entry: ChartEncoding = { field: ei.fieldID };
            if (ei.dtype)     entry.type      = ei.dtype as any;
            if (ei.aggregate) entry.aggregate = ei.aggregate as any;
            if (ei.sortOrder) entry.sortOrder = ei.sortOrder as any;
            if (ei.sortBy)    entry.sortBy    = ei.sortBy;
            if (ei.scheme)    entry.scheme    = ei.scheme;
            encodings[channel] = entry;
        }
    }

    const semanticTypes: Record<string, any> = {};
    for (const [name, meta] of Object.entries(tc.metadata)) {
        if (meta.semanticType) semanticTypes[name] = meta.semanticType;
    }
    if (tc.semanticAnnotations) {
        for (const [name, ann] of Object.entries(tc.semanticAnnotations)) {
            semanticTypes[name] = ann;
        }
    }

    return {
        data: { values: tc.data },
        semantic_types: semanticTypes,
        chart_spec: {
            chartType: tc.chartType,
            encodings,
            canvasSize: CANVAS_SIZE,
            ...(tc.chartProperties ? { chartProperties: tc.chartProperties } : {}),
        },
        options: { ...DEFAULT_OPTIONS, ...(tc.assembleOptions ?? {}) },
    };
}

/** Walk GALLERY_TREE and collect every (section, category, page, generator) tuple
 *  that produces VegaLite output. Each generator may appear under multiple pages;
 *  we de-duplicate by generator key, preferring the first page that referenced it.
 */
interface PageRef {
    section: string;
    category: string;
    page: string;
    library: 'vegalite' | 'triple';
}

function collectVlGeneratorRefs(): Map<string, PageRef> {
    const seen = new Map<string, PageRef>();
    for (const section of GALLERY_TREE) {
        for (const category of section.categories) {
            for (const page of category.pages) {
                const isVl = (page.render === 'single' && page.library === 'vegalite')
                          || page.render === 'triple';
                if (!isVl) continue;
                for (const gen of page.generatorKeys) {
                    if (!seen.has(gen)) {
                        seen.set(gen, {
                            section: section.id,
                            category: category.id,
                            page: page.id,
                            library: page.render === 'triple' ? 'triple' : 'vegalite',
                        });
                    }
                }
            }
        }
    }
    return seen;
}

describe('flint-py fixture extraction (full gallery)', () => {
    fs.mkdirSync(FIXTURES_ROOT, { recursive: true });
    const manifest: ManifestEntry[] = [];
    const refs = collectVlGeneratorRefs();

    for (const [genKey, ref] of refs) {
        describe(genKey, () => {
            const generator = TEST_GENERATORS[genKey];
            if (!generator) {
                it('skip — generator not registered', () => {
                    manifest.push({
                        slug: `_missing__${slugify(genKey)}`,
                        title: '(generator not registered)',
                        chartType: '',
                        section: ref.section,
                        category: ref.category,
                        page: ref.page,
                        generator: genKey,
                        library: ref.library,
                        status: 'js_error',
                        jsError: 'generator key not found in TEST_GENERATORS',
                    });
                });
                return;
            }

            let cases: TestCase[];
            try {
                cases = generator();
            } catch (e: any) {
                it('skip — generator threw', () => {
                    manifest.push({
                        slug: `_gen_threw__${slugify(genKey)}`,
                        title: '(generator threw)',
                        chartType: '',
                        section: ref.section,
                        category: ref.category,
                        page: ref.page,
                        generator: genKey,
                        library: ref.library,
                        status: 'js_error',
                        jsError: `generator() threw: ${e?.message || String(e)}`,
                    });
                });
                return;
            }

            cases.forEach((tc, idx) => {
                const slug = `${slugify(genKey)}__${String(idx).padStart(2, '0')}__${slugify(tc.title || `case${idx}`)}`;
                it(tc.title || `case ${idx}`, () => {
                    const dir = path.join(FIXTURES_ROOT, slug);
                    fs.mkdirSync(dir, { recursive: true });

                    const entry: ManifestEntry = {
                        slug,
                        title: tc.title || `case ${idx}`,
                        chartType: tc.chartType,
                        section: ref.section,
                        category: ref.category,
                        page: ref.page,
                        generator: genKey,
                        library: ref.library,
                        status: 'js_success',
                        fixtureDir: slug,
                    };

                    let input: ChartAssemblyInput;
                    try {
                        input = testCaseToInput(tc);
                    } catch (e: any) {
                        entry.status = 'js_error';
                        entry.jsError = `testCaseToInput threw: ${e?.message || String(e)}`;
                        manifest.push(entry);
                        fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(entry, null, 2));
                        return;
                    }

                    let spec: unknown;
                    try {
                        spec = assembleVegaLite(input);
                    } catch (e: any) {
                        entry.status = 'js_error';
                        entry.jsError = e?.message || String(e);
                        manifest.push(entry);
                        fs.writeFileSync(
                            path.join(dir, 'input.json'),
                            JSON.stringify({ title: tc.title, description: tc.description, chartType: tc.chartType, input }, null, 2),
                        );
                        fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(entry, null, 2));
                        return;
                    }

                    fs.writeFileSync(
                        path.join(dir, 'input.json'),
                        JSON.stringify({ title: tc.title, description: tc.description, chartType: tc.chartType, input }, null, 2),
                    );
                    fs.writeFileSync(
                        path.join(dir, 'expected.json'),
                        JSON.stringify(spec, null, 2),
                    );
                    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(entry, null, 2));
                    manifest.push(entry);
                });
            });
        });
    }

    it('writes the fixture manifest', () => {
        manifest.sort((a, b) => a.slug.localeCompare(b.slug));
        fs.writeFileSync(
            path.join(FIXTURES_ROOT, 'manifest.json'),
            JSON.stringify(manifest, null, 2),
        );
    });
});
