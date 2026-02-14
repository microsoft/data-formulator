// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Type } from '../../../data/types';
import { Channel, EncodingItem } from '../../../components/ComponentType';
import { TestCase, makeField, makeEncodingItem } from './types';
import { seededRandom, genCategories } from './generators';

/** Facet cardinality sizes */
export const FACET_SIZES = { S: 2, M: 4, L: 8, XL: 12 } as const;
/** Discrete axis cardinality sizes */
export const DISCRETE_SIZES = { S: 4, M: 8, L: 20, XL: 50 } as const;

/**
 * Generate facet test cases for a given facet mode (column, row, or column+row).
 * For each combination of facetSize × axisType:
 *   - Continuous × Continuous (scatter in each facet)
 *   - Continuous × Discrete-S/M/L/XL (bar in each facet)
 */
export function genFacetTests(
    mode: 'column' | 'row' | 'column+row',
): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(mode === 'column' ? 500 : mode === 'row' ? 600 : 700);

    const facetSizeEntries = Object.entries(FACET_SIZES) as [string, number][];
    const discreteSizeEntries = Object.entries(DISCRETE_SIZES) as [string, number][];

    for (const [facetLabel, facetCount] of facetSizeEntries) {
        // For column+row mode, split facetCount across columns and rows
        let colCount: number, rowCount: number;
        if (mode === 'column+row') {
            colCount = Math.max(2, Math.ceil(Math.sqrt(facetCount)));
            rowCount = Math.max(2, Math.ceil(facetCount / colCount));
        } else {
            colCount = facetCount;
            rowCount = facetCount;
        }

        const facetDesc = mode === 'column+row'
            ? `${colCount} cols × ${rowCount} rows`
            : `${facetCount} facets`;

        // --- 1. Continuous × Continuous (scatter) ---
        {
            const facetVals = mode === 'column+row'
                ? null  // handled separately
                : genCategories('Region', mode === 'column' ? colCount : rowCount);
            const colVals = mode === 'column+row' ? genCategories('Region', colCount) : undefined;
            const rowVals = mode === 'column+row' ? genCategories('Zone', rowCount) : undefined;

            const data: any[] = [];
            const pointsPerFacet = 20;

            if (mode === 'column+row') {
                for (const c of colVals!) for (const r of rowVals!) {
                    for (let i = 0; i < pointsPerFacet; i++) {
                        data.push({
                            X: Math.round(10 + rand() * 90),
                            Y: Math.round(10 + rand() * 90),
                            Col: c,
                            Row: r,
                        });
                    }
                }
            } else {
                for (const f of facetVals!) {
                    for (let i = 0; i < pointsPerFacet; i++) {
                        data.push({
                            X: Math.round(10 + rand() * 90),
                            Y: Math.round(10 + rand() * 90),
                            Facet: f,
                        });
                    }
                }
            }

            const encodingMap: Partial<Record<Channel, EncodingItem>> = {
                x: makeEncodingItem('X'),
                y: makeEncodingItem('Y'),
            };
            const fields = [makeField('X'), makeField('Y')];
            const metadata: Record<string, any> = {
                X: { type: Type.Number, semanticType: 'Value', levels: [] },
                Y: { type: Type.Number, semanticType: 'Value', levels: [] },
            };

            if (mode === 'column+row') {
                encodingMap.column = makeEncodingItem('Col');
                encodingMap.row = makeEncodingItem('Row');
                fields.push(makeField('Col'), makeField('Row'));
                metadata['Col'] = { type: Type.String, semanticType: 'Category', levels: colVals };
                metadata['Row'] = { type: Type.String, semanticType: 'Category', levels: rowVals };
            } else if (mode === 'column') {
                encodingMap.column = makeEncodingItem('Facet');
                fields.push(makeField('Facet'));
                metadata['Facet'] = { type: Type.String, semanticType: 'Category', levels: facetVals };
            } else {
                encodingMap.row = makeEncodingItem('Facet');
                fields.push(makeField('Facet'));
                metadata['Facet'] = { type: Type.String, semanticType: 'Category', levels: facetVals };
            }

            tests.push({
                title: `Cont × Cont — facet ${facetLabel} (${facetDesc})`,
                description: `Scatter plot with ${facetDesc}`,
                tags: ['quantitative', 'facet', facetLabel.toLowerCase()],
                chartType: 'Scatter Plot',
                data,
                fields,
                metadata,
                encodingMap,
            });
        }

        // --- 2. Continuous × Discrete (bar chart) ---
        for (const [discLabel, discCount] of discreteSizeEntries) {
            const categories = genCategories('Item', discCount);
            const facetVals = mode === 'column+row'
                ? null
                : genCategories('Region', mode === 'column' ? colCount : rowCount);
            const colVals = mode === 'column+row' ? genCategories('Region', colCount) : undefined;
            const rowVals = mode === 'column+row' ? genCategories('Zone', rowCount) : undefined;

            const data: any[] = [];

            if (mode === 'column+row') {
                for (const c of colVals!) for (const r of rowVals!) {
                    for (const cat of categories) {
                        data.push({
                            Category: cat,
                            Value: Math.round(50 + rand() * 500),
                            Col: c,
                            Row: r,
                        });
                    }
                }
            } else {
                for (const f of facetVals!) {
                    for (const cat of categories) {
                        data.push({
                            Category: cat,
                            Value: Math.round(50 + rand() * 500),
                            Facet: f,
                        });
                    }
                }
            }

            const encodingMap: Partial<Record<Channel, EncodingItem>> = {
                x: makeEncodingItem('Category'),
                y: makeEncodingItem('Value'),
            };
            const fields = [makeField('Category'), makeField('Value')];
            const metadata: Record<string, any> = {
                Category: { type: Type.String, semanticType: 'Category', levels: categories },
                Value: { type: Type.Number, semanticType: 'Revenue', levels: [] },
            };

            if (mode === 'column+row') {
                encodingMap.column = makeEncodingItem('Col');
                encodingMap.row = makeEncodingItem('Row');
                fields.push(makeField('Col'), makeField('Row'));
                metadata['Col'] = { type: Type.String, semanticType: 'Category', levels: colVals };
                metadata['Row'] = { type: Type.String, semanticType: 'Category', levels: rowVals };
            } else if (mode === 'column') {
                encodingMap.column = makeEncodingItem('Facet');
                fields.push(makeField('Facet'));
                metadata['Facet'] = { type: Type.String, semanticType: 'Category', levels: facetVals };
            } else {
                encodingMap.row = makeEncodingItem('Facet');
                fields.push(makeField('Facet'));
                metadata['Facet'] = { type: Type.String, semanticType: 'Category', levels: facetVals };
            }

            tests.push({
                title: `Cont × Disc-${discLabel} — facet ${facetLabel} (${facetDesc})`,
                description: `Bar chart: ${discCount} categories × ${facetDesc}`,
                tags: ['nominal', 'quantitative', 'facet', facetLabel.toLowerCase(), `disc-${discLabel.toLowerCase()}`],
                chartType: 'Bar Chart',
                data,
                fields,
                metadata,
                encodingMap,
            });
        }
    }

    return tests;
}

export function genFacetColumnTests(): TestCase[] { return genFacetTests('column'); }
export function genFacetRowTests(): TestCase[] { return genFacetTests('row'); }
export function genFacetColRowTests(): TestCase[] { return genFacetTests('column+row'); }
