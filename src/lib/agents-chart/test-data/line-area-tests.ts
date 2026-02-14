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
