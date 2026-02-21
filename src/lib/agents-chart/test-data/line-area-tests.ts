// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Type } from '../../../data/types';
import { TestCase, makeField, makeEncodingItem } from './types';
import { seededRandom, genDates, genYears, genMonths, genCategories } from './generators';

// Line Chart tests have been moved to line-tests.ts (matrix-driven).
// Area Chart & Streamgraph tests have been moved to area-tests.ts (matrix-driven).

// ------ Dotted Line Chart ------
export function genDottedLineTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(650);

    {
        const months = genMonths(12);
        const data = months.map(m => ({ Month: m, Temperature: Math.round(10 + rand() * 25) }));
        tests.push({
            title: 'Ordinal × Quant (dotted line)',
            description: 'Monthly temperatures with point markers',
            tags: ['ordinal', 'quantitative', 'small'],
            chartType: 'Dotted Line Chart',
            data,
            fields: [makeField('Month'), makeField('Temperature')],
            metadata: {
                Month: { type: Type.String, semanticType: 'Month', levels: months },
                Temperature: { type: Type.Number, semanticType: 'Temperature', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Month'), y: makeEncodingItem('Temperature') },
        });
    }

    return tests;
}

// ------ Bump Chart ------
export function genBumpChartTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(700);

    // 1. Classic bump chart: rank over rounds (intended use)
    {
        const teams = ['Team A', 'Team B', 'Team C', 'Team D', 'Team E'];
        const rounds = ['Round 1', 'Round 2', 'Round 3', 'Round 4', 'Round 5', 'Round 6'];
        const data: any[] = [];
        for (const r of rounds) {
            const shuffled = [...teams].sort(() => rand() - 0.5);
            shuffled.forEach((t, i) => {
                data.push({ Round: r, Team: t, Rank: i + 1 });
            });
        }
        tests.push({
            title: 'Ordinal × Rank + Color (classic bump)',
            description: '6 rounds × 5 teams — rank changes over rounds',
            tags: ['ordinal', 'quantitative', 'color', 'small'],
            chartType: 'Bump Chart',
            data,
            fields: [makeField('Round'), makeField('Rank'), makeField('Team')],
            metadata: {
                Round: { type: Type.String, semanticType: 'Category', levels: rounds },
                Rank: { type: Type.Number, semanticType: 'Rank', levels: [] },
                Team: { type: Type.String, semanticType: 'Team', levels: teams },
            },
            encodingMap: { x: makeEncodingItem('Round'), y: makeEncodingItem('Rank'), color: makeEncodingItem('Team') },
        });
    }

    // 2. Temporal bump: rank over years (intended use)
    {
        const years = genYears(10, 2015);
        const countries = ['USA', 'China', 'Germany', 'Japan', 'India'];
        const data: any[] = [];
        for (const y of years) {
            const shuffled = [...countries].sort(() => rand() - 0.5);
            shuffled.forEach((c, i) => {
                data.push({ Year: y, Country: c, Rank: i + 1 });
            });
        }
        tests.push({
            title: 'Temporal × Rank + Color (yearly ranking)',
            description: '10 years × 5 countries — GDP ranking over time',
            tags: ['temporal', 'quantitative', 'color', 'medium'],
            chartType: 'Bump Chart',
            data,
            fields: [makeField('Year'), makeField('Country'), makeField('Rank')],
            metadata: {
                Year: { type: Type.Number, semanticType: 'Year', levels: years },
                Rank: { type: Type.Number, semanticType: 'Rank', levels: [] },
                Country: { type: Type.String, semanticType: 'Country', levels: countries },
            },
            encodingMap: { x: makeEncodingItem('Year'), y: makeEncodingItem('Rank'), color: makeEncodingItem('Country') },
        });
    }

    // 3. Many series (potential clutter — stress test)
    {
        const months = genMonths(12);
        const players = genCategories('Player', 12);
        const data: any[] = [];
        for (const m of months) {
            const shuffled = [...players].sort(() => rand() - 0.5);
            shuffled.forEach((p, i) => {
                data.push({ Month: m, Player: p, Rank: i + 1 });
            });
        }
        tests.push({
            title: 'Ordinal × Rank + Color (many series, 144 pts)',
            description: '12 months × 12 players — crowded bump chart',
            tags: ['ordinal', 'quantitative', 'color', 'large'],
            chartType: 'Bump Chart',
            data,
            fields: [makeField('Month'), makeField('Rank'), makeField('Player')],
            metadata: {
                Month: { type: Type.String, semanticType: 'Month', levels: months },
                Rank: { type: Type.Number, semanticType: 'Rank', levels: [] },
                Player: { type: Type.String, semanticType: 'Category', levels: players },
            },
            encodingMap: { x: makeEncodingItem('Month'), y: makeEncodingItem('Rank'), color: makeEncodingItem('Player') },
        });
    }

    // 4. Score instead of rank — no "Rank" semantic type (edge case)
    {
        const dates = genDates(8, 2024);
        const brands = ['Brand A', 'Brand B', 'Brand C'];
        const data: any[] = [];
        for (const d of dates) for (const b of brands) {
            data.push({ Date: d, Brand: b, Score: Math.round(50 + rand() * 50) });
        }
        tests.push({
            title: 'Temporal × Quant + Color (score, no rank semantic)',
            description: '8 dates × 3 brands — score values without Rank semantic type',
            tags: ['temporal', 'quantitative', 'color', 'small'],
            chartType: 'Bump Chart',
            data,
            fields: [makeField('Date'), makeField('Score'), makeField('Brand')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Score: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Brand: { type: Type.String, semanticType: 'Category', levels: brands },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Score'), color: makeEncodingItem('Brand') },
        });
    }

    // 5. No color — single series (degenerate case)
    {
        const rounds = ['Q1', 'Q2', 'Q3', 'Q4'];
        const data = rounds.map((r, i) => ({ Quarter: r, Rank: Math.ceil(1 + rand() * 5) }));
        tests.push({
            title: 'Ordinal × Rank (single series, no color)',
            description: '4 quarters — bump chart without color encoding',
            tags: ['ordinal', 'quantitative', 'small'],
            chartType: 'Bump Chart',
            data,
            fields: [makeField('Quarter'), makeField('Rank')],
            metadata: {
                Quarter: { type: Type.String, semanticType: 'Category', levels: rounds },
                Rank: { type: Type.Number, semanticType: 'Rank', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Quarter'), y: makeEncodingItem('Rank') },
        });
    }

    // 6. Two items only (minimal case)
    {
        const years = genYears(5, 2020);
        const items = ['Alpha', 'Beta'];
        const data: any[] = [];
        for (const y of years) {
            const flip = rand() > 0.5;
            data.push({ Year: y, Item: items[0], Rank: flip ? 1 : 2 });
            data.push({ Year: y, Item: items[1], Rank: flip ? 2 : 1 });
        }
        tests.push({
            title: 'Temporal × Rank + Color (2 items only)',
            description: '5 years × 2 items — minimal bump chart',
            tags: ['temporal', 'quantitative', 'color', 'small'],
            chartType: 'Bump Chart',
            data,
            fields: [makeField('Year'), makeField('Rank'), makeField('Item')],
            metadata: {
                Year: { type: Type.Number, semanticType: 'Year', levels: years },
                Rank: { type: Type.Number, semanticType: 'Rank', levels: [] },
                Item: { type: Type.String, semanticType: 'Category', levels: items },
            },
            encodingMap: { x: makeEncodingItem('Year'), y: makeEncodingItem('Rank'), color: makeEncodingItem('Item') },
        });
    }

    return tests;
}
