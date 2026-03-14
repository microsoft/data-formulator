// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Type } from '../../../data/types';
import { TestCase, makeField, makeEncodingItem, buildMetadata } from './types';
import { seededRandom, genCategories, genMonths } from './generators';

// ------ Histogram ------
export function genHistogramTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(400);

    // 1. Small normal distribution
    {
        const data = Array.from({ length: 100 }, () => {
            // Box-Muller transform
            const u1 = rand(), u2 = rand();
            return { Value: Math.round((Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)) * 15 + 50) };
        });
        tests.push({
            title: 'Normal distribution (100 points)',
            description: 'Gaussian data — basic histogram',
            tags: ['quantitative', 'medium'],
            chartType: 'Histogram',
            data,
            fields: [makeField('Value')],
            metadata: { Value: { type: Type.Number, semanticType: 'Quantity', levels: [] } },
            encodingMap: { x: makeEncodingItem('Value') },
        });
    }

    // 2. With color split
    {
        const groups = ['Male', 'Female'];
        const data: any[] = [];
        for (let i = 0; i < 200; i++) {
            const g = groups[i % 2];
            const offset = g === 'Male' ? 170 : 160;
            const u1 = rand(), u2 = rand();
            data.push({
                Height: Math.round((Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)) * 8 + offset),
                Gender: g,
            });
        }
        tests.push({
            title: 'Histogram + Color (gender split)',
            description: '200 points, two groups',
            tags: ['quantitative', 'nominal', 'color', 'medium'],
            chartType: 'Histogram',
            data,
            fields: [makeField('Height'), makeField('Gender')],
            metadata: {
                Height: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Gender: { type: Type.String, semanticType: 'Category', levels: groups },
            },
            encodingMap: { x: makeEncodingItem('Height'), color: makeEncodingItem('Gender') },
        });
    }

    // 3. Large dataset
    {
        const data = Array.from({ length: 1000 }, () => ({
            Income: Math.round(20000 + rand() * 180000),
        }));
        tests.push({
            title: 'Large histogram (1000 points)',
            description: 'Income distribution, large dataset',
            tags: ['quantitative', 'large'],
            chartType: 'Histogram',
            data,
            fields: [makeField('Income')],
            metadata: { Income: { type: Type.Number, semanticType: 'Amount', levels: [] } },
            encodingMap: { x: makeEncodingItem('Income') },
        });
    }

    return tests;
}

// ------ Boxplot ------
export function genBoxplotTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(700);

    // 1. Nominal × Quant
    {
        const groups = genCategories('Category', 5);
        const data: any[] = [];
        for (const g of groups) for (let i = 0; i < 30; i++) {
            data.push({ Group: g, Value: Math.round(rand() * 100) });
        }
        tests.push({
            title: 'Nominal × Quant (5 groups)',
            description: '5 categories × 30 observations each',
            tags: ['nominal', 'quantitative', 'medium'],
            chartType: 'Boxplot',
            data,
            fields: [makeField('Group'), makeField('Value')],
            metadata: {
                Group: { type: Type.String, semanticType: 'Category', levels: groups },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Group'), y: makeEncodingItem('Value') },
        });
    }

    // 2. Two quant axes (ensureNominalAxis test)
    {
        const data: any[] = [];
        for (let level = 1; level <= 5; level++) for (let i = 0; i < 20; i++) {
            data.push({ Level: level, Score: Math.round(level * 10 + rand() * 40) });
        }
        tests.push({
            title: 'Quant × Quant (ensureNominalAxis)',
            description: 'Both axes quant — lower cardinality should convert to nominal',
            tags: ['quantitative', 'medium', 'dtype-conversion'],
            chartType: 'Boxplot',
            data,
            fields: [makeField('Level'), makeField('Score')],
            metadata: {
                Level: { type: Type.Number, semanticType: 'Rank', levels: [1, 2, 3, 4, 5] },
                Score: { type: Type.Number, semanticType: 'Score', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Level'), y: makeEncodingItem('Score') },
        });
    }

    // 3. Large boxplot
    {
        const depts = genCategories('Department', 12);
        const data: any[] = [];
        for (const d of depts) for (let i = 0; i < 50; i++) {
            data.push({ Department: d, Salary: Math.round(30000 + rand() * 120000) });
        }
        tests.push({
            title: 'Nominal × Quant (large, 12 groups)',
            description: '12 departments × 50 observations',
            tags: ['nominal', 'quantitative', 'large'],
            chartType: 'Boxplot',
            data,
            fields: [makeField('Department'), makeField('Salary')],
            metadata: {
                Department: { type: Type.String, semanticType: 'Department', levels: depts },
                Salary: { type: Type.Number, semanticType: 'Amount', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Department'), y: makeEncodingItem('Salary') },
        });
    }

    // 4. Nominal × Quant + Color (small, 4 groups × 2 colors)
    {
        const groups = genCategories('Category', 4);
        const genders = ['Male', 'Female'];
        const data: any[] = [];
        for (const g of groups) for (const s of genders) for (let i = 0; i < 25; i++) {
            data.push({ Group: g, Gender: s, Score: Math.round(20 + rand() * 80) });
        }
        tests.push({
            title: 'Nominal × Quant + Color (4 groups × 2)',
            description: '4 categories split by gender — colored boxplot',
            tags: ['nominal', 'quantitative', 'color', 'small'],
            chartType: 'Boxplot',
            data,
            fields: [makeField('Group'), makeField('Score'), makeField('Gender')],
            metadata: {
                Group: { type: Type.String, semanticType: 'Category', levels: groups },
                Score: { type: Type.Number, semanticType: 'Score', levels: [] },
                Gender: { type: Type.String, semanticType: 'Category', levels: genders },
            },
            encodingMap: { x: makeEncodingItem('Group'), y: makeEncodingItem('Score'), color: makeEncodingItem('Gender') },
        });
    }

    // 5. Nominal × Quant + Color (medium, 6 groups × 4 colors)
    {
        const countries = genCategories('Country', 6);
        const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
        const data: any[] = [];
        for (const c of countries) for (const q of quarters) for (let i = 0; i < 20; i++) {
            data.push({ Country: c, Quarter: q, Revenue: Math.round(500 + rand() * 5000) });
        }
        tests.push({
            title: 'Nominal × Quant + Color (6 groups × 4)',
            description: '6 countries × 4 quarters — tests boxplot color grouping',
            tags: ['nominal', 'quantitative', 'color', 'medium'],
            chartType: 'Boxplot',
            data,
            fields: [makeField('Country'), makeField('Revenue'), makeField('Quarter')],
            metadata: {
                Country: { type: Type.String, semanticType: 'Country', levels: countries },
                Revenue: { type: Type.Number, semanticType: 'Amount', levels: [] },
                Quarter: { type: Type.String, semanticType: 'Category', levels: quarters },
            },
            encodingMap: { x: makeEncodingItem('Country'), y: makeEncodingItem('Revenue'), color: makeEncodingItem('Quarter') },
        });
    }

    // 6. Large boxplot + many colors (8 departments × 5 levels)
    {
        const depts = genCategories('Department', 8);
        const levels = ['Intern', 'Junior', 'Mid', 'Senior', 'Lead'];
        const data: any[] = [];
        for (const d of depts) for (const l of levels) for (let i = 0; i < 15; i++) {
            data.push({ Department: d, Level: l, Compensation: Math.round(25000 + rand() * 175000) });
        }
        tests.push({
            title: 'Nominal × Quant + Color (large, 8 × 5)',
            description: '8 departments × 5 levels — many colored boxes',
            tags: ['nominal', 'quantitative', 'color', 'large'],
            chartType: 'Boxplot',
            data,
            fields: [makeField('Department'), makeField('Compensation'), makeField('Level')],
            metadata: {
                Department: { type: Type.String, semanticType: 'Department', levels: depts },
                Compensation: { type: Type.Number, semanticType: 'Amount', levels: [] },
                Level: { type: Type.String, semanticType: 'Category', levels: levels },
            },
            encodingMap: { x: makeEncodingItem('Department'), y: makeEncodingItem('Compensation'), color: makeEncodingItem('Level') },
        });
    }

    return tests;
}

// ------ Density Plot ------
export function genDensityTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(940);

    // 1. Simple density (one distribution)
    {
        const data = Array.from({ length: 200 }, () => ({
            Score: Math.round(50 + (rand() + rand() + rand() - 1.5) * 30),  // roughly normal
        }));
        tests.push({
            title: 'Single Distribution (200 pts)',
            description: 'Approximately normal distribution of scores',
            tags: ['quantitative', 'small'],
            chartType: 'Density Plot',
            data,
            fields: [makeField('Score')],
            metadata: {
                Score: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Score') },
        });
    }

    // 2. Grouped density with color
    {
        const groups = ['Control', 'Treatment A', 'Treatment B'];
        const data: any[] = [];
        for (const g of groups) {
            const offset = g === 'Control' ? 0 : g === 'Treatment A' ? 10 : 20;
            for (let i = 0; i < 150; i++) {
                data.push({
                    Value: Math.round(50 + offset + (rand() + rand() + rand() - 1.5) * 20),
                    Group: g,
                });
            }
        }
        tests.push({
            title: 'Grouped Density (3 groups, 450 pts)',
            description: 'Three overlapping distributions colored by group',
            tags: ['quantitative', 'color', 'medium'],
            chartType: 'Density Plot',
            data,
            fields: [makeField('Value'), makeField('Group')],
            metadata: {
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Group: { type: Type.String, semanticType: 'Category', levels: groups },
            },
            encodingMap: { x: makeEncodingItem('Value'), color: makeEncodingItem('Group') },
        });
    }

    // 3. Bimodal distribution
    {
        const data: any[] = [];
        for (let i = 0; i < 300; i++) {
            const peak = rand() > 0.4 ? 30 : 70;
            data.push({ Measurement: Math.round(peak + (rand() - 0.5) * 20) });
        }
        tests.push({
            title: 'Bimodal Distribution (300 pts)',
            description: 'Two peaks — tests bandwidth sensitivity',
            tags: ['quantitative', 'medium'],
            chartType: 'Density Plot',
            data,
            fields: [makeField('Measurement')],
            metadata: {
                Measurement: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Measurement') },
        });
    }

    // 4. Color + Column facet
    {
        const sites = ['Lab A', 'Lab B'];
        const data: any[] = [];
        for (const site of sites) {
            const offset = site === 'Lab A' ? 0 : 15;
            for (let i = 0; i < 200; i++) {
                data.push({
                    Reading: Math.round(40 + offset + (rand() + rand() + rand() - 1.5) * 25),
                    Batch: rand() > 0.5 ? 'Morning' : 'Evening',
                    Site: site,
                });
            }
        }
        tests.push({
            title: 'Color + Column Facet (2 sites)',
            description: 'Density by batch, faceted by site',
            tags: ['quantitative', 'color', 'facet', 'medium'],
            chartType: 'Density Plot',
            data,
            fields: [makeField('Reading'), makeField('Batch'), makeField('Site')],
            metadata: {
                Reading: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Batch: { type: Type.String, semanticType: 'Category', levels: ['Morning', 'Evening'] },
                Site: { type: Type.String, semanticType: 'Category', levels: sites },
            },
            encodingMap: {
                x: makeEncodingItem('Reading'),
                color: makeEncodingItem('Batch'),
                column: makeEncodingItem('Site'),
            },
        });
    }

    return tests;
}

// ------ Strip Plot (Jitter) ------
export function genStripPlotTests(): TestCase[] {
    const tests: TestCase[] = [];

    // 1. Basic categorical x, numeric y
    {
        const species = ['Setosa', 'Versicolor', 'Virginica'];
        const rand = seededRandom(77);
        const data: any[] = [];
        for (const sp of species) {
            const base = sp === 'Setosa' ? 1.5 : sp === 'Versicolor' ? 4.3 : 5.5;
            for (let i = 0; i < 20; i++) {
                data.push({ Species: sp, PetalLength: Math.round((base + (rand() - 0.5) * 2) * 10) / 10 });
            }
        }
        tests.push({
            title: 'Iris Petal Length (3 species, 60 pts)',
            description: 'Categorical x, quantitative y with jitter',
            tags: ['jitter', 'nominal', 'small'],
            chartType: 'Strip Plot',
            data,
            fields: [makeField('Species'), makeField('PetalLength')],
            metadata: buildMetadata(data),
            encodingMap: { x: makeEncodingItem('Species'), y: makeEncodingItem('PetalLength') },
        });
    }

    // 2. With color encoding
    {
        const groups = ['Control', 'Treatment A', 'Treatment B'];
        const genders = ['M', 'F'];
        const rand = seededRandom(88);
        const data: any[] = [];
        for (const g of groups) {
            const base = g === 'Control' ? 50 : g === 'Treatment A' ? 65 : 80;
            for (const sex of genders) {
                for (let i = 0; i < 10; i++) {
                    data.push({
                        Group: g,
                        Gender: sex,
                        Score: Math.round(base + (rand() - 0.4) * 30),
                    });
                }
            }
        }
        tests.push({
            title: 'Clinical Trial Scores (color = Gender)',
            description: 'Strip plot with color grouping',
            tags: ['jitter', 'nominal', 'color'],
            chartType: 'Strip Plot',
            data,
            fields: [makeField('Group'), makeField('Score'), makeField('Gender')],
            metadata: buildMetadata(data),
            encodingMap: {
                x: makeEncodingItem('Group'),
                y: makeEncodingItem('Score'),
                color: makeEncodingItem('Gender'),
            },
        });
    }

    // 3. No jitter (jitterWidth = 0)
    {
        const data = [
            { Category: 'A', Value: 10 }, { Category: 'A', Value: 15 },
            { Category: 'A', Value: 12 }, { Category: 'A', Value: 18 },
            { Category: 'B', Value: 25 }, { Category: 'B', Value: 30 },
            { Category: 'B', Value: 22 }, { Category: 'B', Value: 28 },
        ];
        tests.push({
            title: 'No Jitter (aligned strip)',
            description: 'jitterWidth=0 produces a clean strip',
            tags: ['jitter', 'config'],
            chartType: 'Strip Plot',
            data,
            fields: [makeField('Category'), makeField('Value')],
            metadata: buildMetadata(data),
            encodingMap: { x: makeEncodingItem('Category'), y: makeEncodingItem('Value') },
            chartProperties: { jitterWidth: 0 },
        });
    }

    return tests;
}
