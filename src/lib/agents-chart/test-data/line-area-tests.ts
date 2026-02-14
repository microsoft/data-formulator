// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Type } from '../../../data/types';
import { TestCase, makeField, makeEncodingItem } from './types';
import { seededRandom, genDates, genYears, genMonths, genCategories } from './generators';

// ------ Line Chart ------
export function genLineTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(600);

    // 1. Simple temporal line
    {
        const dates = genDates(30, 2023);
        const data = dates.map(d => ({ Date: d, Price: Math.round(100 + rand() * 200) }));
        tests.push({
            title: 'Temporal × Quant (simple line)',
            description: '30 dates — basic time series',
            tags: ['temporal', 'quantitative', 'small'],
            chartType: 'Line Chart',
            data,
            fields: [makeField('Date'), makeField('Price')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Price: { type: Type.Number, semanticType: 'Price', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Price') },
        });
    }

    // 2. Multi-line with color
    {
        const dates = genDates(50, 2020);
        const companies = genCategories('Company', 4);
        const data: any[] = [];
        for (const d of dates) for (const c of companies) {
            data.push({ Date: d, Company: c, Revenue: Math.round(500 + rand() * 2000) });
        }
        tests.push({
            title: 'Temporal × Quant + Color (multi-line)',
            description: '50 dates × 4 companies',
            tags: ['temporal', 'quantitative', 'color', 'medium'],
            chartType: 'Line Chart',
            data,
            fields: [makeField('Date'), makeField('Revenue'), makeField('Company')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Revenue: { type: Type.Number, semanticType: 'Revenue', levels: [] },
                Company: { type: Type.String, semanticType: 'Company', levels: companies },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Revenue'), color: makeEncodingItem('Company') },
        });
    }

    // 3. Year numbers as x (temporal detection)
    {
        const years = genYears(20, 2000);
        const data = years.map(y => ({ Year: y, CO2: Math.round(300 + rand() * 200) }));
        tests.push({
            title: 'Year numbers × Quant',
            description: 'Year as number — tests temporal detection for numeric years',
            tags: ['temporal', 'quantitative', 'medium'],
            chartType: 'Line Chart',
            data,
            fields: [makeField('Year'), makeField('CO2')],
            metadata: {
                Year: { type: Type.Number, semanticType: 'Year', levels: years },
                CO2: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Year'), y: makeEncodingItem('CO2') },
        });
    }

    // 4. Large temporal with many series
    {
        const dates = genDates(100, 2015);
        const categories = genCategories('Category', 8);
        const data: any[] = [];
        for (const d of dates) for (const c of categories) {
            data.push({ Date: d, Category: c, Value: Math.round(rand() * 500) });
        }
        tests.push({
            title: 'Temporal × Quant + Color (large, 800 pts)',
            description: '100 dates × 8 categories',
            tags: ['temporal', 'quantitative', 'color', 'large'],
            chartType: 'Line Chart',
            data,
            fields: [makeField('Date'), makeField('Value'), makeField('Category')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Category: { type: Type.String, semanticType: 'Category', levels: categories },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Value'), color: makeEncodingItem('Category') },
        });
    }

    return tests;
}

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

// ------ Area Chart ------
export function genAreaTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(910);

    // 1. Simple temporal area
    {
        const dates = genDates(30, 2022);
        const data = dates.map((d, i) => ({ Date: d, Revenue: Math.round(100 + rand() * 300 + i * 5) }));
        tests.push({
            title: 'Temporal × Quant (simple area)',
            description: '30 dates — basic time series area',
            tags: ['temporal', 'quantitative', 'small'],
            chartType: 'Area Chart',
            data,
            fields: [makeField('Date'), makeField('Revenue')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Revenue: { type: Type.Number, semanticType: 'Revenue', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Revenue') },
        });
    }

    // 2. Stacked area with color
    {
        const dates = genDates(24, 2021);
        const types = ['Solar', 'Wind', 'Hydro', 'Nuclear'];
        const data: any[] = [];
        for (const d of dates) for (const t of types) {
            data.push({ Date: d, Source: t, GWh: Math.round(20 + rand() * 150) });
        }
        tests.push({
            title: 'Temporal × Quant + Color (stacked area)',
            description: '24 dates × 4 energy sources — stacked by default',
            tags: ['temporal', 'quantitative', 'color', 'medium'],
            chartType: 'Area Chart',
            data,
            fields: [makeField('Date'), makeField('GWh'), makeField('Source')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                GWh: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Source: { type: Type.String, semanticType: 'Category', levels: types },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('GWh'), color: makeEncodingItem('Source') },
        });
    }

    // 3. Large stacked area (many series)
    {
        const dates = genDates(60, 2018);
        const categories = genCategories('Sector', 8);
        const data: any[] = [];
        for (const d of dates) for (const c of categories) {
            data.push({ Date: d, Sector: c, Output: Math.round(rand() * 500) });
        }
        tests.push({
            title: 'Temporal × Quant + Color (large, 480 pts)',
            description: '60 dates × 8 sectors',
            tags: ['temporal', 'quantitative', 'color', 'large'],
            chartType: 'Area Chart',
            data,
            fields: [makeField('Date'), makeField('Output'), makeField('Sector')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Output: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Sector: { type: Type.String, semanticType: 'Category', levels: categories },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Output'), color: makeEncodingItem('Sector') },
        });
    }

    return tests;
}

// ------ Streamgraph ------
export function genStreamgraphTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(920);

    // 1. Basic streamgraph
    {
        const dates = genDates(40, 2020);
        const genres = ['Rock', 'Pop', 'Jazz', 'Electronic', 'Classical'];
        const data: any[] = [];
        for (const d of dates) for (const g of genres) {
            data.push({ Date: d, Genre: g, Listeners: Math.round(50 + rand() * 400) });
        }
        tests.push({
            title: 'Streamgraph (5 series, 200 pts)',
            description: '40 dates × 5 genres — center-stacked area',
            tags: ['temporal', 'quantitative', 'color', 'medium'],
            chartType: 'Streamgraph',
            data,
            fields: [makeField('Date'), makeField('Listeners'), makeField('Genre')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Listeners: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Genre: { type: Type.String, semanticType: 'Category', levels: genres },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Listeners'), color: makeEncodingItem('Genre') },
        });
    }

    // 2. Large streamgraph (many series)
    {
        const dates = genDates(80, 2015);
        const industries = genCategories('Industry', 10);
        const data: any[] = [];
        for (const d of dates) for (const ind of industries) {
            data.push({ Date: d, Industry: ind, Workers: Math.round(100 + rand() * 1000) });
        }
        tests.push({
            title: 'Streamgraph (10 series, 800 pts)',
            description: '80 dates × 10 industries — dense center-stacked',
            tags: ['temporal', 'quantitative', 'color', 'large'],
            chartType: 'Streamgraph',
            data,
            fields: [makeField('Date'), makeField('Workers'), makeField('Industry')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Workers: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Industry: { type: Type.String, semanticType: 'Category', levels: industries },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Workers'), color: makeEncodingItem('Industry') },
        });
    }

    return tests;
}
