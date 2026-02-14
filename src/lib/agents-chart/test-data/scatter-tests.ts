// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Type } from '../../../data/types';
import { TestCase, makeField, makeEncodingItem } from './types';
import { seededRandom, genDates, genCategories, genRandomNames } from './generators';

// ------ Scatter Plot ------
export function genScatterTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(42);

    // 1. Basic quant x quant, small
    {
        const n = 30;
        const data = Array.from({ length: n }, (_, i) => ({
            Height: 150 + rand() * 50,
            Weight: 40 + rand() * 60,
        }));
        tests.push({
            title: 'Quant × Quant (small)',
            description: '30 points, two quantitative axes',
            tags: ['quantitative', 'small'],
            chartType: 'Scatter Plot',
            data,
            fields: [makeField('Height'), makeField('Weight')],
            metadata: { 
                Height: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Weight: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Height'), y: makeEncodingItem('Weight') },
        });
    }

    // 2. Quant x quant with nominal color (medium)
    {
        const categories = genCategories('Category', 6);
        const n = 60;
        const data = Array.from({ length: n }, (_, i) => ({
            Revenue: 100 + rand() * 900,
            Profit: -200 + rand() * 600,
            Segment: categories[i % categories.length],
        }));
        tests.push({
            title: 'Quant × Quant + Color (medium)',
            description: '60 points, 6 color categories',
            tags: ['quantitative', 'nominal', 'color', 'medium'],
            chartType: 'Scatter Plot',
            data,
            fields: [makeField('Revenue'), makeField('Profit'), makeField('Segment')],
            metadata: {
                Revenue: { type: Type.Number, semanticType: 'Revenue', levels: [] },
                Profit: { type: Type.Number, semanticType: 'Amount', levels: [] },
                Segment: { type: Type.String, semanticType: 'Category', levels: categories },
            },
            encodingMap: { x: makeEncodingItem('Revenue'), y: makeEncodingItem('Profit'), color: makeEncodingItem('Segment') },
        });
    }

    // 3. Temporal x quant with color (large)
    {
        const dates = genDates(100);
        const companies = genCategories('Company', 5);
        const data: any[] = [];
        for (const date of dates) {
            for (const co of companies) {
                data.push({ Date: date, StockPrice: 50 + rand() * 200, Company: co });
            }
        }
        tests.push({
            title: 'Temporal × Quant + Color (large)',
            description: '500 points, temporal x-axis, 5 company colors',
            tags: ['temporal', 'quantitative', 'color', 'large'],
            chartType: 'Scatter Plot',
            data,
            fields: [makeField('Date'), makeField('StockPrice'), makeField('Company')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                StockPrice: { type: Type.Number, semanticType: 'Price', levels: [] },
                Company: { type: Type.String, semanticType: 'Company', levels: companies },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('StockPrice'), color: makeEncodingItem('Company') },
        });
    }

    // 4. Quant size encoding
    {
        const countries = genCategories('Country', 15);
        const data = countries.map(c => ({
            GDP: 500 + rand() * 20000,
            Population: 1e6 + rand() * 1.4e9,
            Country: c,
            LifeExpectancy: 55 + rand() * 30,
        }));
        tests.push({
            title: 'Bubble chart (size + color)',
            description: '15 countries with GDP, Population as size, LifeExpectancy as color',
            tags: ['quantitative', 'size', 'color', 'medium'],
            chartType: 'Scatter Plot',
            data,
            fields: [makeField('GDP'), makeField('Population'), makeField('Country'), makeField('LifeExpectancy')],
            metadata: {
                GDP: { type: Type.Number, semanticType: 'Amount', levels: [] },
                Population: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Country: { type: Type.String, semanticType: 'Country', levels: countries },
                LifeExpectancy: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { 
                x: makeEncodingItem('GDP'), y: makeEncodingItem('LifeExpectancy'), 
                size: makeEncodingItem('Population'), color: makeEncodingItem('Country'),
            },
        });
    }

    // 5. Dense scatter — coverage-based point sizing (200 points)
    {
        const n = 200;
        const data = Array.from({ length: n }, () => ({
            X: rand() * 100,
            Y: rand() * 100,
        }));
        tests.push({
            title: 'Dense scatter (200 pts)',
            description: '200 random points — tests coverage-based point sizing (moderate density)',
            tags: ['quantitative', 'density', 'medium'],
            chartType: 'Scatter Plot',
            data,
            fields: [makeField('X'), makeField('Y')],
            metadata: {
                X: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Y: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('X'), y: makeEncodingItem('Y') },
        });
    }

    // 6. Very dense scatter — 2000 points
    {
        const n = 2000;
        const data = Array.from({ length: n }, () => ({
            X: rand() * 100,
            Y: rand() * 100,
        }));
        tests.push({
            title: 'Very dense scatter (2000 pts)',
            description: '2000 random points — should shrink to small dots',
            tags: ['quantitative', 'density', 'large'],
            chartType: 'Scatter Plot',
            data,
            fields: [makeField('X'), makeField('Y')],
            metadata: {
                X: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Y: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('X'), y: makeEncodingItem('Y') },
        });
    }

    // 7. Dense scatter with color — 500 points, 4 groups
    {
        const groups = ['A', 'B', 'C', 'D'];
        const n = 500;
        const data = Array.from({ length: n }, (_, i) => ({
            X: rand() * 100,
            Y: rand() * 100,
            Group: groups[i % groups.length],
        }));
        tests.push({
            title: 'Dense + Color (500 pts, 4 groups)',
            description: '500 points with 4 color groups — tests sizing with color channel',
            tags: ['quantitative', 'nominal', 'color', 'density', 'large'],
            chartType: 'Scatter Plot',
            data,
            fields: [makeField('X'), makeField('Y'), makeField('Group')],
            metadata: {
                X: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Y: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Group: { type: Type.String, semanticType: 'Category', levels: groups },
            },
            encodingMap: { x: makeEncodingItem('X'), y: makeEncodingItem('Y'), color: makeEncodingItem('Group') },
        });
    }

    // 8. Bubble chart with many points — size encoding should prevent point shrinking
    {
        const n = 300;
        const data = Array.from({ length: n }, () => ({
            X: rand() * 100,
            Y: rand() * 100,
            Z: rand() * 1000,
        }));
        tests.push({
            title: 'Dense bubble (300 pts, size mapped)',
            description: '300 points with size encoding — applyPointSizeScaling should be skipped',
            tags: ['quantitative', 'size', 'density', 'medium'],
            chartType: 'Scatter Plot',
            data,
            fields: [makeField('X'), makeField('Y'), makeField('Z')],
            metadata: {
                X: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Y: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Z: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('X'), y: makeEncodingItem('Y'), size: makeEncodingItem('Z') },
        });
    }

    // ---- Bubble chart size evaluation suite ----

    // 9. Bubble — 5 points
    {
        const countries = genCategories('Country', 5);
        const data = countries.map(c => ({
            X: rand() * 100,
            Y: rand() * 100,
            Population: Math.round(1e6 + rand() * 1.4e9),
            Country: c,
        }));
        tests.push({
            title: 'Bubble 5 pts (quant size)',
            description: '5 countries — sparse, max size should be at VL default 361',
            tags: ['quantitative', 'size', 'bubble', 'small'],
            chartType: 'Scatter Plot',
            data,
            fields: [makeField('X'), makeField('Y'), makeField('Population'), makeField('Country')],
            metadata: {
                X: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Y: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Population: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Country: { type: Type.String, semanticType: 'Country', levels: countries },
            },
            encodingMap: { x: makeEncodingItem('X'), y: makeEncodingItem('Y'), size: makeEncodingItem('Population'), color: makeEncodingItem('Country') },
        });
    }

    // 10. Bubble — 15 points
    {
        const countries = genCategories('Country', 15);
        const data = countries.map(c => ({
            GDP: 500 + rand() * 20000,
            LifeExp: 55 + rand() * 30,
            Population: Math.round(1e6 + rand() * 1.4e9),
            Country: c,
        }));
        tests.push({
            title: 'Bubble 15 pts (quant size)',
            description: '15 countries — moderate, should still be near VL default',
            tags: ['quantitative', 'size', 'bubble', 'medium'],
            chartType: 'Scatter Plot',
            data,
            fields: [makeField('GDP'), makeField('LifeExp'), makeField('Population'), makeField('Country')],
            metadata: {
                GDP: { type: Type.Number, semanticType: 'Amount', levels: [] },
                LifeExp: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Population: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Country: { type: Type.String, semanticType: 'Country', levels: countries },
            },
            encodingMap: { x: makeEncodingItem('GDP'), y: makeEncodingItem('LifeExp'), size: makeEncodingItem('Population'), color: makeEncodingItem('Country') },
        });
    }

    // 11. Bubble — 50 points
    {
        const n = 50;
        const data = Array.from({ length: n }, (_, i) => ({
            X: rand() * 100,
            Y: rand() * 100,
            Size: Math.round(10 + rand() * 990),
            Group: ['A', 'B', 'C', 'D', 'E'][i % 5],
        }));
        tests.push({
            title: 'Bubble 50 pts (quant size)',
            description: '50 points with 5 color groups — density starts to matter',
            tags: ['quantitative', 'size', 'bubble', 'medium'],
            chartType: 'Scatter Plot',
            data,
            fields: [makeField('X'), makeField('Y'), makeField('Size'), makeField('Group')],
            metadata: {
                X: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Y: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Size: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Group: { type: Type.String, semanticType: 'Category', levels: ['A', 'B', 'C', 'D', 'E'] },
            },
            encodingMap: { x: makeEncodingItem('X'), y: makeEncodingItem('Y'), size: makeEncodingItem('Size'), color: makeEncodingItem('Group') },
        });
    }

    // 12. Bubble — 100 points
    {
        const n = 100;
        const data = Array.from({ length: n }, () => ({
            X: rand() * 100,
            Y: rand() * 100,
            Revenue: Math.round(100 + rand() * 9900),
        }));
        tests.push({
            title: 'Bubble 100 pts (quant size)',
            description: '100 points — fair-share starts shrinking max size',
            tags: ['quantitative', 'size', 'bubble', 'large'],
            chartType: 'Scatter Plot',
            data,
            fields: [makeField('X'), makeField('Y'), makeField('Revenue')],
            metadata: {
                X: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Y: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Revenue: { type: Type.Number, semanticType: 'Amount', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('X'), y: makeEncodingItem('Y'), size: makeEncodingItem('Revenue') },
        });
    }

    // 13. Bubble — 500 points (very dense)
    {
        const n = 500;
        const data = Array.from({ length: n }, () => ({
            X: rand() * 100,
            Y: rand() * 100,
            Weight: Math.round(1 + rand() * 100),
        }));
        tests.push({
            title: 'Bubble 500 pts (quant size)',
            description: '500 points — should shrink significantly',
            tags: ['quantitative', 'size', 'bubble', 'large'],
            chartType: 'Scatter Plot',
            data,
            fields: [makeField('X'), makeField('Y'), makeField('Weight')],
            metadata: {
                X: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Y: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Weight: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('X'), y: makeEncodingItem('Y'), size: makeEncodingItem('Weight') },
        });
    }

    // 14. Bubble — ordinal size
    {
        const priorities = ['Low', 'Medium', 'High', 'Critical'];
        const n = 30;
        const data = Array.from({ length: n }, () => ({
            X: rand() * 100,
            Y: rand() * 100,
            Priority: priorities[Math.floor(rand() * priorities.length)],
        }));
        tests.push({
            title: 'Bubble 30 pts (ordinal size)',
            description: '30 points sized by ordinal Priority — 4 distinct size levels',
            tags: ['ordinal', 'size', 'bubble', 'medium'],
            chartType: 'Scatter Plot',
            data,
            fields: [makeField('X'), makeField('Y'), makeField('Priority')],
            metadata: {
                X: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Y: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Priority: { type: Type.String, semanticType: 'Rank', levels: priorities },
            },
            encodingMap: { x: makeEncodingItem('X'), y: makeEncodingItem('Y'), size: makeEncodingItem('Priority') },
        });
    }

    // 15. Bubble — size with large numeric range
    {
        const countries = genCategories('Country', 20);
        const data = countries.map(c => ({
            X: rand() * 100,
            Y: rand() * 100,
            Pop: Math.round(1e3 + rand() * 1e9),
            Country: c,
        }));
        tests.push({
            title: 'Bubble 20 pts (huge value range)',
            description: '20 countries, Pop ranges 1K-1B — tests sqrt scale discrimination',
            tags: ['quantitative', 'size', 'bubble', 'medium', 'skewed'],
            chartType: 'Scatter Plot',
            data,
            fields: [makeField('X'), makeField('Y'), makeField('Pop'), makeField('Country')],
            metadata: {
                X: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Y: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Pop: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Country: { type: Type.String, semanticType: 'Country', levels: countries },
            },
            encodingMap: { x: makeEncodingItem('X'), y: makeEncodingItem('Y'), size: makeEncodingItem('Pop'), color: makeEncodingItem('Country') },
        });
    }

    // 16. Bubble — size with narrow numeric range
    {
        const n = 20;
        const data = Array.from({ length: n }, () => ({
            X: rand() * 100,
            Y: rand() * 100,
            Score: 90 + rand() * 10,
        }));
        tests.push({
            title: 'Bubble 20 pts (narrow value range)',
            description: '20 points, Score 90-100 — tests size discrimination for tight data',
            tags: ['quantitative', 'size', 'bubble', 'medium', 'narrow'],
            chartType: 'Scatter Plot',
            data,
            fields: [makeField('X'), makeField('Y'), makeField('Score')],
            metadata: {
                X: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Y: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Score: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('X'), y: makeEncodingItem('Y'), size: makeEncodingItem('Score') },
        });
    }

    return tests;
}

// ------ Linear Regression ------
export function genLinearRegressionTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(55);

    // 1. Basic regression (quant × quant)
    {
        const n = 40;
        const data = Array.from({ length: n }, () => {
            const x = 10 + rand() * 80;
            return { Hours: Math.round(x * 10) / 10, Score: Math.round(20 + x * 0.8 + (rand() - 0.5) * 30) };
        });
        tests.push({
            title: 'Basic regression (40 pts)',
            description: 'Hours vs Score — simple linear trend',
            tags: ['quantitative', 'small'],
            chartType: 'Linear Regression',
            data,
            fields: [makeField('Hours'), makeField('Score')],
            metadata: {
                Hours: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Score: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Hours'), y: makeEncodingItem('Score') },
        });
    }

    // 2. Regression with color (grouped lines)
    {
        const groups = ['Male', 'Female'];
        const data: any[] = [];
        for (const g of groups) {
            const offset = g === 'Male' ? 5 : -5;
            for (let i = 0; i < 30; i++) {
                const x = 10 + rand() * 80;
                data.push({
                    Experience: Math.round(x * 10) / 10,
                    Salary: Math.round(30 + x * 0.6 + offset + (rand() - 0.5) * 20),
                    Gender: g,
                });
            }
        }
        tests.push({
            title: 'Regression + Color (2 groups)',
            description: '60 points — separate regression per gender',
            tags: ['quantitative', 'color', 'medium'],
            chartType: 'Linear Regression',
            data,
            fields: [makeField('Experience'), makeField('Salary'), makeField('Gender')],
            metadata: {
                Experience: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Salary: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Gender: { type: Type.String, semanticType: 'Category', levels: groups },
            },
            encodingMap: { x: makeEncodingItem('Experience'), y: makeEncodingItem('Salary'), color: makeEncodingItem('Gender') },
        });
    }

    // 3. Regression with column facet
    {
        const regions = ['East', 'West', 'Central'];
        const data: any[] = [];
        for (const r of regions) {
            const slope = r === 'East' ? 0.9 : r === 'West' ? 0.5 : 0.7;
            for (let i = 0; i < 25; i++) {
                const x = 5 + rand() * 90;
                data.push({
                    Spend: Math.round(x * 10) / 10,
                    Revenue: Math.round(10 + x * slope + (rand() - 0.5) * 25),
                    Region: r,
                });
            }
        }
        tests.push({
            title: 'Regression + Column Facet (3 regions)',
            description: '75 points — separate subplot per region',
            tags: ['quantitative', 'facet', 'medium'],
            chartType: 'Linear Regression',
            data,
            fields: [makeField('Spend'), makeField('Revenue'), makeField('Region')],
            metadata: {
                Spend: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Revenue: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Region: { type: Type.String, semanticType: 'Category', levels: regions },
            },
            encodingMap: {
                x: makeEncodingItem('Spend'),
                y: makeEncodingItem('Revenue'),
                column: makeEncodingItem('Region'),
            },
        });
    }

    // 4. Regression with color + facet
    {
        const depts = ['Sales', 'Engineering'];
        const levels = ['Junior', 'Senior'];
        const data: any[] = [];
        for (const d of depts) {
            for (const l of levels) {
                const base = l === 'Senior' ? 20 : 0;
                for (let i = 0; i < 15; i++) {
                    const x = 1 + rand() * 20;
                    data.push({
                        Years: Math.round(x * 10) / 10,
                        Performance: Math.round(40 + base + x * 2.5 + (rand() - 0.5) * 15),
                        Level: l,
                        Department: d,
                    });
                }
            }
        }
        tests.push({
            title: 'Color + Facet (2×2)',
            description: '60 pts — color by level, facet by department',
            tags: ['quantitative', 'color', 'facet', 'medium'],
            chartType: 'Linear Regression',
            data,
            fields: [makeField('Years'), makeField('Performance'), makeField('Level'), makeField('Department')],
            metadata: {
                Years: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Performance: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Level: { type: Type.String, semanticType: 'Category', levels: levels },
                Department: { type: Type.String, semanticType: 'Category', levels: depts },
            },
            encodingMap: {
                x: makeEncodingItem('Years'),
                y: makeEncodingItem('Performance'),
                color: makeEncodingItem('Level'),
                column: makeEncodingItem('Department'),
            },
        });
    }

    return tests;
}
