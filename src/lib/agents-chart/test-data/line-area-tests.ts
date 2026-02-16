// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Type } from '../../../data/types';
import { TestCase, makeField, makeEncodingItem } from './types';
import { seededRandom, genDates, genYears, genMonths, genCategories } from './generators';

// ------ Line Chart ------
export function genLineTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(600);

    // Helper: generate a smooth random-walk series
    // Each series starts at a random base and drifts with momentum + noise
    const genSeries = (n: number, base: number, volatility: number): number[] => {
        const values: number[] = [base];
        let momentum = 0;
        for (let i = 1; i < n; i++) {
            momentum = 0.7 * momentum + (rand() - 0.5) * volatility;
            values.push(Math.round(Math.max(0, values[i - 1] + momentum)));
        }
        return values;
    };

    // 1. Simple temporal line — single series, 30 dates
    {
        const dates = genDates(30, 2023);
        const prices = genSeries(30, 150, 15);
        const data = dates.map((d, i) => ({ Date: d, Price: prices[i] }));
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

    // 2. Multi-line with color — 4 companies, 50 shared dates, smooth trends
    {
        const dates = genDates(50, 2020);
        const companies = genCategories('Company', 4);
        const data: any[] = [];
        for (const c of companies) {
            const base = 500 + Math.round(rand() * 1500);
            const series = genSeries(50, base, 80);
            for (let i = 0; i < dates.length; i++) {
                data.push({ Date: dates[i], Company: c, Revenue: series[i] });
            }
        }
        tests.push({
            title: 'Temporal × Quant + Color (4 series)',
            description: '50 dates × 4 companies — smooth random walks',
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
        const co2 = genSeries(20, 350, 10);
        const data = years.map((y, i) => ({ Year: y, CO2: co2[i] }));
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

    // 4. Large temporal — 8 categories, 100 shared dates, smooth overlapping trends
    {
        const dates = genDates(100, 2015);
        const categories = genCategories('Category', 8);
        const data: any[] = [];
        for (const c of categories) {
            const base = 100 + Math.round(rand() * 300);
            const series = genSeries(100, base, 20);
            for (let i = 0; i < dates.length; i++) {
                data.push({ Date: dates[i], Category: c, Value: series[i] });
            }
        }
        tests.push({
            title: 'Temporal × Quant + Color (large, 800 pts)',
            description: '100 dates × 8 categories — smooth overlapping series',
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

    // 5. Stress test — 20 series, 200 dates (4000 pts), all sharing same X
    {
        const dates = genDates(200, 2010);
        const series20 = genCategories('Category', 20);
        const data: any[] = [];
        for (const s of series20) {
            const base = 50 + Math.round(rand() * 400);
            const vals = genSeries(200, base, 25);
            for (let i = 0; i < dates.length; i++) {
                data.push({ Date: dates[i], Series: s, Metric: vals[i] });
            }
        }
        tests.push({
            title: 'Temporal × Quant + Color (stress, 4000 pts)',
            description: '200 dates × 20 series — crowded line spaghetti',
            tags: ['temporal', 'quantitative', 'color', 'stress'],
            chartType: 'Line Chart',
            data,
            fields: [makeField('Date'), makeField('Metric'), makeField('Series')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Metric: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Series: { type: Type.String, semanticType: 'Category', levels: series20 },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Metric'), color: makeEncodingItem('Series') },
        });
    }

    // 6. Sparse / irregular — 3 series, some dates missing per series
    {
        const allDates = genDates(60, 2022);
        const products = genCategories('Product', 3);
        const data: any[] = [];
        for (const p of products) {
            const base = 200 + Math.round(rand() * 300);
            const vals = genSeries(60, base, 30);
            for (let i = 0; i < allDates.length; i++) {
                // Each series randomly drops ~20% of dates
                if (rand() < 0.2) continue;
                data.push({ Date: allDates[i], Product: p, Sales: vals[i] });
            }
        }
        tests.push({
            title: 'Temporal × Quant + Color (sparse)',
            description: '3 series, ~48 dates each (20% missing) — irregular gaps',
            tags: ['temporal', 'quantitative', 'color', 'medium'],
            chartType: 'Line Chart',
            data,
            fields: [makeField('Date'), makeField('Sales'), makeField('Product')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Sales: { type: Type.Number, semanticType: 'Revenue', levels: [] },
                Product: { type: Type.String, semanticType: 'Product', levels: products },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Sales'), color: makeEncodingItem('Product') },
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

    // Helper: smooth random walk with upward drift (natural for cumulative metrics)
    const genTrend = (n: number, base: number, drift: number, volatility: number): number[] => {
        const values: number[] = [base];
        let momentum = 0;
        for (let i = 1; i < n; i++) {
            momentum = 0.6 * momentum + (rand() - 0.45) * volatility + drift;
            values.push(Math.round(Math.max(0, values[i - 1] + momentum)));
        }
        return values;
    };

    // 1. Simple temporal area — single series, upward trend
    {
        const dates = genDates(30, 2022);
        const revenue = genTrend(30, 100, 3, 15);
        const data = dates.map((d, i) => ({ Date: d, Revenue: revenue[i] }));
        tests.push({
            title: 'Temporal × Quant (simple area)',
            description: '30 dates — basic time series area with upward trend',
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

    // 2. Stacked area — 4 energy sources, smooth trends, shared dates
    {
        const dates = genDates(24, 2021);
        const types = ['Solar', 'Wind', 'Hydro', 'Nuclear'];
        const data: any[] = [];
        for (const t of types) {
            const base = 20 + Math.round(rand() * 100);
            const series = genTrend(24, base, 1, 12);
            for (let i = 0; i < dates.length; i++) {
                data.push({ Date: dates[i], Source: t, GWh: series[i] });
            }
        }
        tests.push({
            title: 'Temporal × Quant + Color (stacked, 4 series)',
            description: '24 dates × 4 energy sources — proportions shift over time',
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

    // 3. Large stacked — 8 sectors, 60 dates, smooth
    {
        const dates = genDates(60, 2018);
        const categories = genCategories('Sector', 8);
        const data: any[] = [];
        for (const c of categories) {
            const base = 50 + Math.round(rand() * 200);
            const series = genTrend(60, base, 0.5, 18);
            for (let i = 0; i < dates.length; i++) {
                data.push({ Date: dates[i], Sector: c, Output: series[i] });
            }
        }
        tests.push({
            title: 'Temporal × Quant + Color (large, 480 pts)',
            description: '60 dates × 8 sectors — smooth stacked area',
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

    // 4. Normalized (100%) stacked — market share over years
    {
        const years = genYears(12, 2012);
        const browsers = ['Chrome', 'Firefox', 'Safari', 'Edge', 'Other'];
        const data: any[] = [];
        for (const y of years) {
            const raw = browsers.map(() => 10 + rand() * 80);
            const total = raw.reduce((a, b) => a + b, 0);
            for (let j = 0; j < browsers.length; j++) {
                data.push({ Year: y, Browser: browsers[j], Share: Math.round(raw[j] / total * 100) });
            }
        }
        tests.push({
            title: 'Year × Quant + Color (100% stacked)',
            description: '12 years × 5 browsers — market share proportions',
            tags: ['temporal', 'quantitative', 'color', 'medium'],
            chartType: 'Area Chart',
            data,
            fields: [makeField('Year'), makeField('Share'), makeField('Browser')],
            metadata: {
                Year: { type: Type.Number, semanticType: 'Year', levels: years },
                Share: { type: Type.Number, semanticType: 'Percentage', levels: [] },
                Browser: { type: Type.String, semanticType: 'Category', levels: browsers },
            },
            encodingMap: { x: makeEncodingItem('Year'), y: makeEncodingItem('Share'), color: makeEncodingItem('Browser') },
        });
    }

    // 5. Stress — 15 series, 120 dates (1800 pts)
    {
        const dates = genDates(120, 2010);
        const departments = genCategories('Category', 15);
        const data: any[] = [];
        for (const dept of departments) {
            const base = 30 + Math.round(rand() * 150);
            const series = genTrend(120, base, 0.3, 10);
            for (let i = 0; i < dates.length; i++) {
                data.push({ Date: dates[i], Department: dept, Spend: series[i] });
            }
        }
        tests.push({
            title: 'Temporal × Quant + Color (stress, 1800 pts)',
            description: '120 dates × 15 departments — dense stacked area',
            tags: ['temporal', 'quantitative', 'color', 'stress'],
            chartType: 'Area Chart',
            data,
            fields: [makeField('Date'), makeField('Spend'), makeField('Department')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Spend: { type: Type.Number, semanticType: 'Revenue', levels: [] },
                Department: { type: Type.String, semanticType: 'Category', levels: departments },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Spend'), color: makeEncodingItem('Department') },
        });
    }

    // 6. Layered (overlapping) — 3 series, transparency needed
    {
        const dates = genDates(40, 2023);
        const regions = ['North', 'South', 'West'];
        const data: any[] = [];
        for (const r of regions) {
            const base = 80 + Math.round(rand() * 120);
            const series = genTrend(40, base, 1.5, 20);
            for (let i = 0; i < dates.length; i++) {
                data.push({ Date: dates[i], Region: r, Orders: series[i] });
            }
        }
        tests.push({
            title: 'Temporal × Quant + Color (layered/overlap)',
            description: '40 dates × 3 regions — overlapping areas, tests transparency',
            tags: ['temporal', 'quantitative', 'color', 'medium'],
            chartType: 'Area Chart',
            data,
            fields: [makeField('Date'), makeField('Orders'), makeField('Region')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Orders: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Region: { type: Type.String, semanticType: 'Category', levels: regions },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Orders'), color: makeEncodingItem('Region') },
        });
    }

    return tests;
}

// ------ Streamgraph ------
export function genStreamgraphTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(920);

    // Helper: smooth random walk
    const genFlow = (n: number, base: number, volatility: number): number[] => {
        const values: number[] = [base];
        let momentum = 0;
        for (let i = 1; i < n; i++) {
            momentum = 0.6 * momentum + (rand() - 0.5) * volatility;
            values.push(Math.round(Math.max(10, values[i - 1] + momentum)));
        }
        return values;
    };

    // 1. Basic streamgraph — 5 genres, shared dates
    {
        const dates = genDates(40, 2020);
        const genres = ['Rock', 'Pop', 'Jazz', 'Electronic', 'Classical'];
        const data: any[] = [];
        for (const g of genres) {
            const base = 100 + Math.round(rand() * 200);
            const series = genFlow(40, base, 30);
            for (let i = 0; i < dates.length; i++) {
                data.push({ Date: dates[i], Genre: g, Listeners: series[i] });
            }
        }
        tests.push({
            title: 'Streamgraph (5 series, 200 pts)',
            description: '40 dates × 5 genres — smooth center-stacked area',
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

    // 2. Large streamgraph — 10 industries, 80 dates
    {
        const dates = genDates(80, 2015);
        const industries = genCategories('Industry', 10);
        const data: any[] = [];
        for (const ind of industries) {
            const base = 200 + Math.round(rand() * 500);
            const series = genFlow(80, base, 40);
            for (let i = 0; i < dates.length; i++) {
                data.push({ Date: dates[i], Industry: ind, Workers: series[i] });
            }
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
