// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Type } from '../../../data/types';
import { TestCase, makeField, makeEncodingItem } from './types';
import { seededRandom, genDates, genNaturalDates, genYears, genCategories, genRandomNames } from './generators';

// ------ Bar Chart ------
export function genBarTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(100);

    // 1. Nominal x, quant y (small)
    {
        const cats = genCategories('Product', 5);
        const data = cats.map(c => ({ Product: c, Sales: Math.round(100 + rand() * 900) }));
        tests.push({
            title: 'Nominal × Quant (small, 5 bars)',
            description: 'Basic bar chart with 5 products',
            tags: ['nominal', 'quantitative', 'small'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Product'), makeField('Sales')],
            metadata: {
                Product: { type: Type.String, semanticType: 'Product', levels: cats },
                Sales: { type: Type.Number, semanticType: 'Revenue', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Product'), y: makeEncodingItem('Sales') },
        });
    }

    // 2. Nominal x, quant y (medium)
    {
        const cats = genCategories('Country', 20);
        const data = cats.map(c => ({ Country: c, GDP: Math.round(500 + rand() * 19500) }));
        tests.push({
            title: 'Nominal × Quant (medium, 20 bars)',
            description: '20 countries with GDP — tests label rotation',
            tags: ['nominal', 'quantitative', 'medium'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Country'), makeField('GDP')],
            metadata: {
                Country: { type: Type.String, semanticType: 'Country', levels: cats },
                GDP: { type: Type.Number, semanticType: 'Amount', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Country'), y: makeEncodingItem('GDP') },
        });
    }

    // 3. Nominal x, quant y (large — tests discrete cap)
    {
        const cats = genCategories('Name', 30);
        const data = cats.map(c => ({ Name: c, Score: Math.round(10 + rand() * 90) }));
        tests.push({
            title: 'Nominal × Quant (large, 30 bars)',
            description: '30 names — tests discrete cap & thin bar handling',
            tags: ['nominal', 'quantitative', 'large'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Name'), makeField('Score')],
            metadata: {
                Name: { type: Type.String, semanticType: 'Name', levels: cats },
                Score: { type: Type.Number, semanticType: 'Score', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Name'), y: makeEncodingItem('Score') },
        });
    }

    // 4. Temporal x, quant y
    {
        const dates = genDates(24, 2020);
        const data = dates.map(d => ({ Date: d, Revenue: Math.round(1000 + rand() * 5000) }));
        tests.push({
            title: 'Temporal × Quant (24 dates)',
            description: 'Temporal x-axis — tests applyDynamicMarkResizing for bars',
            tags: ['temporal', 'quantitative', 'medium'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Date'), makeField('Revenue')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Revenue: { type: Type.Number, semanticType: 'Revenue', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Revenue') },
        });
    }

    // 5. Natural date format
    {
        const dates = genNaturalDates(15);
        const data = dates.map(d => ({ 'Release Date': d, Profit: Math.round(1e6 + rand() * 1e9) }));
        tests.push({
            title: 'Natural date strings × Quant',
            description: '"Jun 12 1998" format — tests temporal detection via Date.parse',
            tags: ['temporal', 'quantitative', 'medium', 'date-format'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Release Date'), makeField('Profit')],
            metadata: {
                'Release Date': { type: Type.Date, semanticType: 'Date', levels: [] },
                Profit: { type: Type.Number, semanticType: 'Amount', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Release Date'), y: makeEncodingItem('Profit') },
        });
    }

    // 6. Year x, quant y
    {
        const years = genYears(8, 2015);
        const data = years.map(y => ({ Year: y, Emissions: Math.round(100 + rand() * 500) }));
        tests.push({
            title: 'Year × Quant (small, 8 years)',
            description: 'Year numbers — should be temporal, ordinal threshold test',
            tags: ['temporal', 'quantitative', 'small'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Year'), makeField('Emissions')],
            metadata: {
                Year: { type: Type.Number, semanticType: 'Year', levels: years },
                Emissions: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Year'), y: makeEncodingItem('Emissions') },
        });
    }

    // 7. Two quantitative axes
    {
        const data = Array.from({ length: 20 }, (_, i) => ({
            Temperature: 10 + rand() * 30,
            Humidity: 20 + rand() * 80,
        }));
        tests.push({
            title: 'Quant × Quant (two quantitative)',
            description: 'Both axes quantitative — tests dynamic mark resizing',
            tags: ['quantitative', 'medium'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Temperature'), makeField('Humidity')],
            metadata: {
                Temperature: { type: Type.Number, semanticType: 'Temperature', levels: [] },
                Humidity: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Temperature'), y: makeEncodingItem('Humidity') },
        });
    }

    // 8. Nominal x + color (many colors)
    {
        const directors = genCategories('Director', 20);
        const movies = genCategories('MovieTitle', 30);
        const data: any[] = [];
        for (const dir of directors) {
            const nMovies = 2 + Math.floor(rand() * 5);
            for (let m = 0; m < nMovies; m++) {
                data.push({
                    Director: dir,
                    Title: movies[Math.floor(rand() * movies.length)],
                    Profit: Math.round(-1e8 + rand() * 2e9),
                });
            }
        }
        tests.push({
            title: 'Nominal × Quant + Many Colors',
            description: '20 directors, 30 movie titles as color — tests color scheme saturation',
            tags: ['nominal', 'quantitative', 'color', 'large'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Director'), makeField('Profit'), makeField('Title')],
            metadata: {
                Director: { type: Type.String, semanticType: 'Name', levels: directors },
                Profit: { type: Type.Number, semanticType: 'Amount', levels: [] },
                Title: { type: Type.String, semanticType: 'Category', levels: movies },
            },
            encodingMap: { x: makeEncodingItem('Director'), y: makeEncodingItem('Profit'), color: makeEncodingItem('Title') },
        });
    }

    // 9. Swap axis: horizontal bar
    {
        const cats = genCategories('Country', 10);
        const data = cats.map(c => ({ Country: c, Population: Math.round(1e6 + rand() * 1.4e9) }));
        tests.push({
            title: 'Quant × Nominal (horizontal, 10 bars)',
            description: 'Swapped axes — horizontal bar chart',
            tags: ['nominal', 'quantitative', 'swap-axis', 'medium'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Population'), makeField('Country')],
            metadata: {
                Population: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Country: { type: Type.String, semanticType: 'Country', levels: cats },
            },
            encodingMap: { x: makeEncodingItem('Population'), y: makeEncodingItem('Country') },
        });
    }

    // 10. Swap axis: horizontal temporal bar
    {
        const dates = genDates(18, 2020);
        const data = dates.map(d => ({ Date: d, Sales: Math.round(500 + rand() * 3000) }));
        tests.push({
            title: 'Quant × Temporal (horizontal, 18 dates)',
            description: 'Swapped axes — temporal on y-axis',
            tags: ['temporal', 'quantitative', 'swap-axis', 'medium'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Sales'), makeField('Date')],
            metadata: {
                Sales: { type: Type.Number, semanticType: 'Revenue', levels: [] },
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Sales'), y: makeEncodingItem('Date') },
        });
    }

    // 11. Very large discrete (100 random names)
    {
        const names = genRandomNames(100, 1001);
        const data = names.map(n => ({ Name: n, Value: Math.round(10 + rand() * 500) }));
        tests.push({
            title: 'Nominal × Quant (very large, 100 bars)',
            description: '100 random names — tests discrete cutoff filtering',
            tags: ['nominal', 'quantitative', 'very-large', 'cutoff'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Name'), makeField('Value')],
            metadata: {
                Name: { type: Type.String, semanticType: 'Name', levels: names },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Name'), y: makeEncodingItem('Value') },
        });
    }

    // 12. Very large discrete, swap axis
    {
        const names = genRandomNames(100, 1002);
        const data = names.map(n => ({ Name: n, Score: Math.round(10 + rand() * 200) }));
        tests.push({
            title: 'Quant × Nominal (horizontal, 100 bars)',
            description: '100 random names on y-axis — tests cutoff on swapped axis',
            tags: ['nominal', 'quantitative', 'very-large', 'cutoff', 'swap-axis'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Score'), makeField('Name')],
            metadata: {
                Score: { type: Type.Number, semanticType: 'Score', levels: [] },
                Name: { type: Type.String, semanticType: 'Name', levels: names },
            },
            encodingMap: { x: makeEncodingItem('Score'), y: makeEncodingItem('Name') },
        });
    }

    // 13. Large temporal x (100 dates)
    {
        const dates = genDates(100, 2015);
        const data = dates.map(d => ({ Date: d, Value: Math.round(50 + rand() * 500) }));
        tests.push({
            title: 'Temporal × Quant (large, 100 dates)',
            description: '100 dates — tests dynamic bar sizing for large temporal axis',
            tags: ['temporal', 'quantitative', 'very-large'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Date'), makeField('Value')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Value') },
        });
    }

    // 14. Large temporal x + color
    {
        const dates = genDates(100, 2015);
        const cats = ['Alpha', 'Beta', 'Gamma'];
        const data: any[] = [];
        for (const d of dates) for (const c of cats) {
            data.push({ Date: d, Category: c, Amount: Math.round(100 + rand() * 1000) });
        }
        tests.push({
            title: 'Temporal × Quant + Color (large, 300 bars)',
            description: '100 dates × 3 categories — large temporal with color',
            tags: ['temporal', 'quantitative', 'color', 'very-large'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Date'), makeField('Amount'), makeField('Category')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Amount: { type: Type.Number, semanticType: 'Amount', levels: [] },
                Category: { type: Type.String, semanticType: 'Category', levels: cats },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Amount'), color: makeEncodingItem('Category') },
        });
    }

    return tests;
}

// ------ Stacked Bar Chart ------
export function genStackedBarTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(200);

    // 1. Small nominal + color
    {
        const regions = genCategories('Country', 4);
        const products = genCategories('Product', 3);
        const data: any[] = [];
        for (const r of regions) for (const p of products) {
            data.push({ Region: r, Product: p, Sales: Math.round(100 + rand() * 500) });
        }
        tests.push({
            title: 'Nominal × Quant + Color (small stack)',
            description: '4 regions × 3 products — basic stacked bar',
            tags: ['nominal', 'quantitative', 'color', 'small'],
            chartType: 'Stacked Bar Chart',
            data,
            fields: [makeField('Region'), makeField('Sales'), makeField('Product')],
            metadata: {
                Region: { type: Type.String, semanticType: 'Country', levels: regions },
                Sales: { type: Type.Number, semanticType: 'Revenue', levels: [] },
                Product: { type: Type.String, semanticType: 'Product', levels: products },
            },
            encodingMap: { x: makeEncodingItem('Region'), y: makeEncodingItem('Sales'), color: makeEncodingItem('Product') },
        });
    }

    // 2. Temporal x + color (medium)
    {
        const years = genYears(10, 2013);
        const segments = ['Online', 'Retail', 'Wholesale'];
        const data: any[] = [];
        for (const y of years) for (const s of segments) {
            data.push({ Year: y, Channel: s, Revenue: Math.round(500 + rand() * 3000) });
        }
        tests.push({
            title: 'Year × Quant + Color (stacked temporal)',
            description: '10 years × 3 segments — temporal stacked bar',
            tags: ['temporal', 'quantitative', 'color', 'medium'],
            chartType: 'Stacked Bar Chart',
            data,
            fields: [makeField('Year'), makeField('Revenue'), makeField('Channel')],
            metadata: {
                Year: { type: Type.Number, semanticType: 'Year', levels: years },
                Revenue: { type: Type.Number, semanticType: 'Revenue', levels: [] },
                Channel: { type: Type.String, semanticType: 'Category', levels: segments },
            },
            encodingMap: { x: makeEncodingItem('Year'), y: makeEncodingItem('Revenue'), color: makeEncodingItem('Channel') },
        });
    }

    // 3. Large nominal + many colors
    {
        const depts = genCategories('Department', 15);
        const statuses = genCategories('Status', 5);
        const data: any[] = [];
        for (const d of depts) for (const s of statuses) {
            data.push({ Department: d, Status: s, Count: Math.round(5 + rand() * 50) });
        }
        tests.push({
            title: 'Nominal × Quant + Color (large stack)',
            description: '15 departments × 5 statuses',
            tags: ['nominal', 'quantitative', 'color', 'large'],
            chartType: 'Stacked Bar Chart',
            data,
            fields: [makeField('Department'), makeField('Count'), makeField('Status')],
            metadata: {
                Department: { type: Type.String, semanticType: 'Department', levels: depts },
                Count: { type: Type.Number, semanticType: 'Count', levels: [] },
                Status: { type: Type.String, semanticType: 'Status', levels: statuses },
            },
            encodingMap: { x: makeEncodingItem('Department'), y: makeEncodingItem('Count'), color: makeEncodingItem('Status') },
        });
    }

    // 4. Temporal x (ISO dates) + color
    {
        const dates = genDates(20, 2019);
        const fuels = ['Coal', 'Gas', 'Solar', 'Wind'];
        const data: any[] = [];
        for (const d of dates) for (const f of fuels) {
            data.push({ Date: d, Fuel: f, Output: Math.round(200 + rand() * 800) });
        }
        tests.push({
            title: 'Temporal × Quant + Color (stacked dates)',
            description: '20 dates × 4 fuels — tests applyDynamicMarkResizing for stacked bars',
            tags: ['temporal', 'quantitative', 'color', 'medium'],
            chartType: 'Stacked Bar Chart',
            data,
            fields: [makeField('Date'), makeField('Output'), makeField('Fuel')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Output: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Fuel: { type: Type.String, semanticType: 'Category', levels: fuels },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Output'), color: makeEncodingItem('Fuel') },
        });
    }

    // 5. Quant × Quant + Color
    {
        const types = ['A', 'B', 'C'];
        const data: any[] = [];
        for (let i = 0; i < 30; i++) {
            data.push({
                Temperature: Math.round(10 + rand() * 35),
                Energy: Math.round(50 + rand() * 500),
                Type: types[Math.floor(rand() * types.length)],
            });
        }
        tests.push({
            title: 'Quant × Quant + Color (stacked)',
            description: 'Both axes quantitative — tests dynamic mark resizing for stacked bars',
            tags: ['quantitative', 'color', 'medium', 'dtype-conversion'],
            chartType: 'Stacked Bar Chart',
            data,
            fields: [makeField('Temperature'), makeField('Energy'), makeField('Type')],
            metadata: {
                Temperature: { type: Type.Number, semanticType: 'Temperature', levels: [] },
                Energy: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Type: { type: Type.String, semanticType: 'Category', levels: types },
            },
            encodingMap: { x: makeEncodingItem('Temperature'), y: makeEncodingItem('Energy'), color: makeEncodingItem('Type') },
        });
    }

    // 6. Swap axis: horizontal stacked
    {
        const cats = genCategories('Country', 8);
        const segments = ['Import', 'Export', 'Domestic'];
        const data: any[] = [];
        for (const c of cats) for (const s of segments) {
            data.push({ Country: c, Segment: s, Value: Math.round(100 + rand() * 1000) });
        }
        tests.push({
            title: 'Quant × Nominal + Color (horizontal stack)',
            description: '8 countries × 3 segments — horizontal stacked bar',
            tags: ['nominal', 'quantitative', 'color', 'swap-axis', 'medium'],
            chartType: 'Stacked Bar Chart',
            data,
            fields: [makeField('Value'), makeField('Country'), makeField('Segment')],
            metadata: {
                Value: { type: Type.Number, semanticType: 'Amount', levels: [] },
                Country: { type: Type.String, semanticType: 'Country', levels: cats },
                Segment: { type: Type.String, semanticType: 'Category', levels: segments },
            },
            encodingMap: { x: makeEncodingItem('Value'), y: makeEncodingItem('Country'), color: makeEncodingItem('Segment') },
        });
    }

    // 7. Swap axis: horizontal temporal stack
    {
        const dates = genDates(15, 2018);
        const sources = ['Web', 'Mobile', 'API'];
        const data: any[] = [];
        for (const d of dates) for (const s of sources) {
            data.push({ Date: d, Source: s, Requests: Math.round(500 + rand() * 5000) });
        }
        tests.push({
            title: 'Quant × Temporal + Color (horizontal stack)',
            description: '15 dates on y-axis × 3 sources — horizontal temporal stacked',
            tags: ['temporal', 'quantitative', 'color', 'swap-axis', 'medium'],
            chartType: 'Stacked Bar Chart',
            data,
            fields: [makeField('Requests'), makeField('Date'), makeField('Source')],
            metadata: {
                Requests: { type: Type.Number, semanticType: 'Count', levels: [] },
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Source: { type: Type.String, semanticType: 'Category', levels: sources },
            },
            encodingMap: { x: makeEncodingItem('Requests'), y: makeEncodingItem('Date'), color: makeEncodingItem('Source') },
        });
    }

    // 8. Very large discrete + color
    {
        const names = genRandomNames(80, 2001);
        const tiers = ['Gold', 'Silver', 'Bronze'];
        const data: any[] = [];
        for (const n of names) for (const t of tiers) {
            data.push({ Name: n, Tier: t, Points: Math.round(10 + rand() * 300) });
        }
        tests.push({
            title: 'Nominal × Quant + Color (very large, 80 names)',
            description: '80 random names × 3 tiers — tests discrete cutoff for stacked bars',
            tags: ['nominal', 'quantitative', 'color', 'very-large', 'cutoff'],
            chartType: 'Stacked Bar Chart',
            data,
            fields: [makeField('Name'), makeField('Points'), makeField('Tier')],
            metadata: {
                Name: { type: Type.String, semanticType: 'Name', levels: names },
                Points: { type: Type.Number, semanticType: 'Score', levels: [] },
                Tier: { type: Type.String, semanticType: 'Category', levels: tiers },
            },
            encodingMap: { x: makeEncodingItem('Name'), y: makeEncodingItem('Points'), color: makeEncodingItem('Tier') },
        });
    }

    // 9. Numeric color, small cardinality
    {
        const cats = genCategories('Country', 6);
        const data: any[] = [];
        for (const c of cats) for (let q = 1; q <= 4; q++) {
            data.push({ Country: c, Quarter: q, Revenue: Math.round(500 + rand() * 3000) });
        }
        tests.push({
            title: 'Nominal × Quant + Numeric Color (small, 4 values)',
            description: 'Quarter number (1-4) on color — numeric on color for stacked bar',
            tags: ['nominal', 'quantitative', 'color', 'numeric-color', 'small'],
            chartType: 'Stacked Bar Chart',
            data,
            fields: [makeField('Country'), makeField('Revenue'), makeField('Quarter')],
            metadata: {
                Country: { type: Type.String, semanticType: 'Country', levels: cats },
                Revenue: { type: Type.Number, semanticType: 'Revenue', levels: [] },
                Quarter: { type: Type.Number, semanticType: 'Rank', levels: [1, 2, 3, 4] },
            },
            encodingMap: { x: makeEncodingItem('Country'), y: makeEncodingItem('Revenue'), color: makeEncodingItem('Quarter') },
        });
    }

    // 10. Numeric color, large cardinality
    {
        const cats = genCategories('Product', 5);
        const data: any[] = [];
        for (const c of cats) for (let day = 1; day <= 30; day++) {
            data.push({ Product: c, Day: day, Sales: Math.round(50 + rand() * 500) });
        }
        tests.push({
            title: 'Nominal × Quant + Numeric Color (large, 30 values)',
            description: 'Day (1-30) on color — many numeric values on color for stacked bar',
            tags: ['nominal', 'quantitative', 'color', 'numeric-color', 'large'],
            chartType: 'Stacked Bar Chart',
            data,
            fields: [makeField('Product'), makeField('Sales'), makeField('Day')],
            metadata: {
                Product: { type: Type.String, semanticType: 'Product', levels: cats },
                Sales: { type: Type.Number, semanticType: 'Revenue', levels: [] },
                Day: { type: Type.Number, semanticType: 'Quantity', levels: Array.from({ length: 30 }, (_, i) => i + 1) },
            },
            encodingMap: { x: makeEncodingItem('Product'), y: makeEncodingItem('Sales'), color: makeEncodingItem('Day') },
        });
    }

    return tests;
}

// ------ Grouped Bar Chart ------
export function genGroupedBarTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(300);

    // 1. Small nominal + color
    {
        const cats = genCategories('Category', 4);
        const years = ['2022', '2023', '2024'];
        const data: any[] = [];
        for (const c of cats) for (const y of years) {
            data.push({ Category: c, Year: y, Revenue: Math.round(200 + rand() * 800) });
        }
        tests.push({
            title: 'Nominal × Quant + Color (grouped, small)',
            description: '4 categories × 3 years',
            tags: ['nominal', 'quantitative', 'color', 'small'],
            chartType: 'Grouped Bar Chart',
            data,
            fields: [makeField('Category'), makeField('Revenue'), makeField('Year')],
            metadata: {
                Category: { type: Type.String, semanticType: 'Category', levels: cats },
                Revenue: { type: Type.Number, semanticType: 'Revenue', levels: [] },
                Year: { type: Type.String, semanticType: 'Year', levels: years },
            },
            encodingMap: { x: makeEncodingItem('Category'), y: makeEncodingItem('Revenue'), color: makeEncodingItem('Year') },
        });
    }

    // 2. Two quantitative axes
    {
        const data = Array.from({ length: 15 }, () => ({
            Score: Math.round(rand() * 100),
            Grade: Math.round(1 + rand() * 4),
            Level: ['A', 'B', 'C'][Math.floor(rand() * 3)],
        }));
        tests.push({
            title: 'Two Quant + Color (ensureNominalAxis)',
            description: 'Both axes quantitative — tests nominal conversion',
            tags: ['quantitative', 'color', 'medium'],
            chartType: 'Grouped Bar Chart',
            data,
            fields: [makeField('Score'), makeField('Grade'), makeField('Level')],
            metadata: {
                Score: { type: Type.Number, semanticType: 'Score', levels: [] },
                Grade: { type: Type.Number, semanticType: 'Rank', levels: [] },
                Level: { type: Type.String, semanticType: 'Category', levels: ['A', 'B', 'C'] },
            },
            encodingMap: { x: makeEncodingItem('Grade'), y: makeEncodingItem('Score'), color: makeEncodingItem('Level') },
        });
    }

    // 3. No color field
    {
        const cats = genCategories('Country', 8);
        const data = cats.map(c => ({ Country: c, Population: Math.round(1e6 + rand() * 1.4e9) }));
        tests.push({
            title: 'Grouped bar, no color (fallback)',
            description: '8 countries, no color — should behave like simple bar',
            tags: ['nominal', 'quantitative', 'small'],
            chartType: 'Grouped Bar Chart',
            data,
            fields: [makeField('Country'), makeField('Population')],
            metadata: {
                Country: { type: Type.String, semanticType: 'Country', levels: cats },
                Population: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Country'), y: makeEncodingItem('Population') },
        });
    }

    // 4. Temporal x + color
    {
        const dates = genDates(12, 2021);
        const metrics = ['Revenue', 'Cost', 'Profit'];
        const data: any[] = [];
        for (const d of dates) for (const m of metrics) {
            data.push({ Date: d, Metric: m, Amount: Math.round(100 + rand() * 2000) });
        }
        tests.push({
            title: 'Temporal × Quant + Color (grouped dates)',
            description: '12 dates × 3 metrics — tests applyDynamicMarkResizing for grouped bars',
            tags: ['temporal', 'quantitative', 'color', 'medium'],
            chartType: 'Grouped Bar Chart',
            data,
            fields: [makeField('Date'), makeField('Amount'), makeField('Metric')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Amount: { type: Type.Number, semanticType: 'Amount', levels: [] },
                Metric: { type: Type.String, semanticType: 'Category', levels: metrics },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Amount'), color: makeEncodingItem('Metric') },
        });
    }

    // 5. Quant × Quant + Color
    {
        const regions = ['North', 'South', 'East', 'West'];
        const data: any[] = [];
        for (let i = 0; i < 20; i++) {
            data.push({
                Price: Math.round(10 + rand() * 90),
                Demand: Math.round(100 + rand() * 900),
                Region: regions[Math.floor(rand() * regions.length)],
            });
        }
        tests.push({
            title: 'Quant × Quant + Color (grouped)',
            description: 'Both axes quantitative — tests ensureNominalAxis + dynamic sizing',
            tags: ['quantitative', 'color', 'medium', 'dtype-conversion'],
            chartType: 'Grouped Bar Chart',
            data,
            fields: [makeField('Price'), makeField('Demand'), makeField('Region')],
            metadata: {
                Price: { type: Type.Number, semanticType: 'Price', levels: [] },
                Demand: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Region: { type: Type.String, semanticType: 'Category', levels: regions },
            },
            encodingMap: { x: makeEncodingItem('Price'), y: makeEncodingItem('Demand'), color: makeEncodingItem('Region') },
        });
    }

    // 6. Swap axis: horizontal grouped
    {
        const products = genCategories('Product', 6);
        const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
        const data: any[] = [];
        for (const p of products) for (const q of quarters) {
            data.push({ Product: p, Quarter: q, Sales: Math.round(200 + rand() * 2000) });
        }
        tests.push({
            title: 'Quant × Nominal + Color (horizontal grouped)',
            description: '6 products × 4 quarters — horizontal grouped bar',
            tags: ['nominal', 'quantitative', 'color', 'swap-axis', 'medium'],
            chartType: 'Grouped Bar Chart',
            data,
            fields: [makeField('Sales'), makeField('Product'), makeField('Quarter')],
            metadata: {
                Sales: { type: Type.Number, semanticType: 'Revenue', levels: [] },
                Product: { type: Type.String, semanticType: 'Product', levels: products },
                Quarter: { type: Type.String, semanticType: 'Category', levels: quarters },
            },
            encodingMap: { x: makeEncodingItem('Sales'), y: makeEncodingItem('Product'), color: makeEncodingItem('Quarter') },
        });
    }

    // 7. Swap axis: horizontal temporal grouped
    {
        const dates = genDates(10, 2022);
        const channelsList = ['Email', 'SMS', 'Push'];
        const data: any[] = [];
        for (const d of dates) for (const c of channelsList) {
            data.push({ Date: d, Channel: c, Sent: Math.round(1000 + rand() * 10000) });
        }
        tests.push({
            title: 'Quant × Temporal + Color (horizontal grouped)',
            description: '10 dates on y-axis × 3 channels — horizontal temporal grouped',
            tags: ['temporal', 'quantitative', 'color', 'swap-axis', 'medium'],
            chartType: 'Grouped Bar Chart',
            data,
            fields: [makeField('Sent'), makeField('Date'), makeField('Channel')],
            metadata: {
                Sent: { type: Type.Number, semanticType: 'Count', levels: [] },
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Channel: { type: Type.String, semanticType: 'Category', levels: channelsList },
            },
            encodingMap: { x: makeEncodingItem('Sent'), y: makeEncodingItem('Date'), color: makeEncodingItem('Channel') },
        });
    }

    // 8. Very large discrete + color
    {
        const names = genRandomNames(90, 3001);
        const levels = ['Junior', 'Senior', 'Lead'];
        const data: any[] = [];
        for (const n of names) for (const l of levels) {
            data.push({ Employee: n, Level: l, Salary: Math.round(30000 + rand() * 120000) });
        }
        tests.push({
            title: 'Nominal × Quant + Color (very large, 90 names)',
            description: '90 random names × 3 levels — tests discrete cutoff for grouped bars',
            tags: ['nominal', 'quantitative', 'color', 'very-large', 'cutoff'],
            chartType: 'Grouped Bar Chart',
            data,
            fields: [makeField('Employee'), makeField('Salary'), makeField('Level')],
            metadata: {
                Employee: { type: Type.String, semanticType: 'Name', levels: names },
                Salary: { type: Type.Number, semanticType: 'Amount', levels: [] },
                Level: { type: Type.String, semanticType: 'Category', levels: levels },
            },
            encodingMap: { x: makeEncodingItem('Employee'), y: makeEncodingItem('Salary'), color: makeEncodingItem('Level') },
        });
    }

    // 9. Numeric color, small cardinality
    {
        const cats = genCategories('Product', 6);
        const data: any[] = [];
        for (const c of cats) for (let rating = 1; rating <= 5; rating++) {
            data.push({ Product: c, Rating: rating, Sales: Math.round(100 + rand() * 900) });
        }
        tests.push({
            title: 'Nominal × Quant + Numeric Color (small, 5 values)',
            description: 'Rating (1-5) on color — numeric field with small cardinality on color channel',
            tags: ['nominal', 'quantitative', 'color', 'numeric-color', 'small'],
            chartType: 'Grouped Bar Chart',
            data,
            fields: [makeField('Product'), makeField('Sales'), makeField('Rating')],
            metadata: {
                Product: { type: Type.String, semanticType: 'Product', levels: cats },
                Sales: { type: Type.Number, semanticType: 'Revenue', levels: [] },
                Rating: { type: Type.Number, semanticType: 'Rank', levels: [1, 2, 3, 4, 5] },
            },
            encodingMap: { x: makeEncodingItem('Product'), y: makeEncodingItem('Sales'), color: makeEncodingItem('Rating') },
        });
    }

    // 10. Numeric color, large cardinality
    {
        const cats = genCategories('Country', 8);
        const data: any[] = [];
        for (const c of cats) for (let age = 20; age < 70; age++) {
            data.push({ Country: c, Age: age, Count: Math.round(10 + rand() * 200) });
        }
        tests.push({
            title: 'Nominal × Quant + Numeric Color (large, 50 values)',
            description: 'Age (20-69) on color — numeric field with large cardinality on color channel',
            tags: ['nominal', 'quantitative', 'color', 'numeric-color', 'large'],
            chartType: 'Grouped Bar Chart',
            data,
            fields: [makeField('Country'), makeField('Count'), makeField('Age')],
            metadata: {
                Country: { type: Type.String, semanticType: 'Country', levels: cats },
                Count: { type: Type.Number, semanticType: 'Count', levels: [] },
                Age: { type: Type.Number, semanticType: 'Quantity', levels: Array.from({ length: 50 }, (_, i) => 20 + i) },
            },
            encodingMap: { x: makeEncodingItem('Country'), y: makeEncodingItem('Count'), color: makeEncodingItem('Age') },
        });
    }

    // 11. Continuous numeric color
    {
        const cats = genCategories('Category', 5);
        const data: any[] = [];
        for (const c of cats) for (let i = 0; i < 10; i++) {
            data.push({ Category: c, Value: Math.round(rand() * 500), Temperature: Math.round(rand() * 4000) / 100 });
        }
        tests.push({
            title: 'Nominal × Quant + Continuous Color',
            description: 'Continuous float on color — should be treated as quantitative gradient, not grouped',
            tags: ['nominal', 'quantitative', 'color', 'numeric-color', 'continuous'],
            chartType: 'Grouped Bar Chart',
            data,
            fields: [makeField('Category'), makeField('Value'), makeField('Temperature')],
            metadata: {
                Category: { type: Type.String, semanticType: 'Category', levels: cats },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Temperature: { type: Type.Number, semanticType: 'Temperature', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Category'), y: makeEncodingItem('Value'), color: makeEncodingItem('Temperature') },
        });
    }

    return tests;
}
