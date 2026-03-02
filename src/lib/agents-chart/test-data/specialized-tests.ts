// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Type } from '../../../data/types';
import { Channel, EncodingItem } from '../../../components/ComponentType';
import { TestCase, makeField, makeEncodingItem, buildMetadata } from './types';
import { seededRandom, genDates, genMonths, genCategories } from './generators';

// ------ Heatmap ------
export function genHeatmapTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(500);

    // 1. Small nominal × nominal
    {
        const xs = genCategories('Category', 5);
        const ys = genMonths(6);
        const data: any[] = [];
        for (const x of xs) for (const y of ys) {
            data.push({ Category: x, Month: y, Value: Math.round(rand() * 100) });
        }
        tests.push({
            title: 'Nominal × Nominal (small, 5×6)',
            description: '5 categories × 6 months — basic heatmap',
            tags: ['nominal', 'ordinal', 'color', 'small'],
            chartType: 'Heatmap',
            data,
            fields: [makeField('Category'), makeField('Month'), makeField('Value')],
            metadata: {
                Category: { type: Type.String, semanticType: 'Category', levels: xs },
                Month: { type: Type.String, semanticType: 'Month', levels: ys },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Category'), y: makeEncodingItem('Month'), color: makeEncodingItem('Value') },
        });
    }

    // 2. Quantitative × quantitative (tests applyDynamicMarkResizing with nominalThreshold)
    {
        const xs = Array.from({ length: 10 }, (_, i) => i * 10);
        const ys = Array.from({ length: 8 }, (_, i) => i * 5);
        const data: any[] = [];
        for (const x of xs) for (const y of ys) {
            data.push({ X: x, Y: y, Density: Math.round(rand() * 100) });
        }
        tests.push({
            title: 'Quant × Quant (small cardinality → nominal)',
            description: '10×8 grid — should convert to nominal (≤20 threshold)',
            tags: ['quantitative', 'small', 'dtype-conversion'],
            chartType: 'Heatmap',
            data,
            fields: [makeField('X'), makeField('Y'), makeField('Density')],
            metadata: {
                X: { type: Type.Number, semanticType: 'Quantity', levels: xs },
                Y: { type: Type.Number, semanticType: 'Quantity', levels: ys },
                Density: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('X'), y: makeEncodingItem('Y'), color: makeEncodingItem('Density') },
        });
    }

    // 3. Large quantitative (should resize rect, not convert)
    {
        const data: any[] = [];
        for (let x = 0; x < 50; x++) for (let y = 0; y < 30; y++) {
            data.push({ Hour: x, Day: y, Activity: Math.round(rand() * 100) });
        }
        tests.push({
            title: 'Quant × Quant (large cardinality → resize)',
            description: '50×30 grid — should resize rect width/height, not convert to nominal',
            tags: ['quantitative', 'large', 'dtype-conversion'],
            chartType: 'Heatmap',
            data,
            fields: [makeField('Hour'), makeField('Day'), makeField('Activity')],
            metadata: {
                Hour: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Day: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Activity: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Hour'), y: makeEncodingItem('Day'), color: makeEncodingItem('Activity') },
        });
    }

    // 4. Temporal × nominal
    {
        const months = genMonths(12);
        const products = genCategories('Product', 6);
        const data: any[] = [];
        for (const m of months) for (const p of products) {
            data.push({ Month: m, Product: p, Sales: Math.round(rand() * 1000) });
        }
        tests.push({
            title: 'Ordinal × Nominal (12×6)',
            description: '12 months × 6 products',
            tags: ['ordinal', 'nominal', 'color', 'medium'],
            chartType: 'Heatmap',
            data,
            fields: [makeField('Month'), makeField('Product'), makeField('Sales')],
            metadata: {
                Month: { type: Type.String, semanticType: 'Month', levels: months },
                Product: { type: Type.String, semanticType: 'Product', levels: products },
                Sales: { type: Type.Number, semanticType: 'Revenue', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Month'), y: makeEncodingItem('Product'), color: makeEncodingItem('Sales') },
        });
    }

    // 5. Large temporal × nominal (80 dates × 5 categories)
    {
        const dates = genDates(80, 2016);
        const cats = genCategories('Category', 5);
        const data: any[] = [];
        for (const d of dates) for (const c of cats) {
            data.push({ Date: d, Category: c, Intensity: Math.round(rand() * 100) });
        }
        tests.push({
            title: 'Temporal × Nominal (large, 80×5)',
            description: '80 dates × 5 categories — tests large temporal heatmap with rect sizing',
            tags: ['temporal', 'nominal', 'color', 'very-large'],
            chartType: 'Heatmap',
            data,
            fields: [makeField('Date'), makeField('Category'), makeField('Intensity')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Category: { type: Type.String, semanticType: 'Category', levels: cats },
                Intensity: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Category'), color: makeEncodingItem('Intensity') },
        });
    }

    // 6. Nominal × large temporal (swapped, 5 × 80 dates on y)
    {
        const dates = genDates(80, 2016);
        const cats = genCategories('Product', 5);
        const data: any[] = [];
        for (const c of cats) for (const d of dates) {
            data.push({ Product: c, Date: d, Score: Math.round(rand() * 100) });
        }
        tests.push({
            title: 'Nominal × Temporal (large, 5×80)',
            description: '5 products × 80 dates on y-axis — large temporal on y',
            tags: ['nominal', 'temporal', 'color', 'very-large', 'swap-axis'],
            chartType: 'Heatmap',
            data,
            fields: [makeField('Product'), makeField('Date'), makeField('Score')],
            metadata: {
                Product: { type: Type.String, semanticType: 'Product', levels: cats },
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Score: { type: Type.Number, semanticType: 'Score', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Product'), y: makeEncodingItem('Date'), color: makeEncodingItem('Score') },
        });
    }

    // 7. Large temporal × large temporal (60×40 date grid)
    {
        const xDates = genDates(60, 2018);
        const yDates = genDates(40, 2020);
        const data: any[] = [];
        for (const xd of xDates) for (const yd of yDates) {
            data.push({ StartDate: xd, EndDate: yd, Correlation: Math.round(-100 + rand() * 200) / 100 });
        }
        tests.push({
            title: 'Temporal × Temporal (large, 60×40)',
            description: '60×40 date grid — both axes temporal, tests rect sizing on both',
            tags: ['temporal', 'color', 'very-large'],
            chartType: 'Heatmap',
            data,
            fields: [makeField('StartDate'), makeField('EndDate'), makeField('Correlation')],
            metadata: {
                StartDate: { type: Type.Date, semanticType: 'Date', levels: [] },
                EndDate: { type: Type.Date, semanticType: 'Date', levels: [] },
                Correlation: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('StartDate'), y: makeEncodingItem('EndDate'), color: makeEncodingItem('Correlation') },
        });
    }

    // 8. Asymmetric discrete: 5 categories on Y × 80 categories on X (400 cells)
    {
        const xCats = Array.from({ length: 80 }, (_, i) => `C${String(i + 1).padStart(2, '0')}`);
        const yCats = genCategories('Category', 5);
        const data: any[] = [];
        for (const x of xCats) for (const y of yCats) data.push({ Category: x, Group: y, Value: Math.round(rand() * 100) });
        tests.push({
            title: 'Nominal × Nominal (asymmetric wide, 80×5)',
            description: '80 categories on X × 5 on Y (400 cells) — tests wide asymmetric discrete axes',
            tags: ['nominal', 'color', 'asymmetric', 'very-large'],
            chartType: 'Heatmap',
            data,
            fields: [makeField('Category'), makeField('Group'), makeField('Value')],
            metadata: buildMetadata(data),
            encodingMap: { x: makeEncodingItem('Category'), y: makeEncodingItem('Group'), color: makeEncodingItem('Value') },
        });
    }

    // 9. Asymmetric discrete: 80 categories on Y × 5 categories on X (400 cells)
    {
        const xCats = genCategories('Category', 5);
        const yCats = Array.from({ length: 80 }, (_, i) => `C${String(i + 1).padStart(2, '0')}`);
        const data: any[] = [];
        for (const x of xCats) for (const y of yCats) data.push({ Group: x, Category: y, Value: Math.round(rand() * 100) });
        tests.push({
            title: 'Nominal × Nominal (asymmetric tall, 5×80)',
            description: '5 categories on X × 80 on Y (400 cells) — tests tall asymmetric discrete axes',
            tags: ['nominal', 'color', 'asymmetric', 'very-large'],
            chartType: 'Heatmap',
            data,
            fields: [makeField('Group'), makeField('Category'), makeField('Value')],
            metadata: buildMetadata(data),
            encodingMap: { x: makeEncodingItem('Group'), y: makeEncodingItem('Category'), color: makeEncodingItem('Value') },
        });
    }

    return tests;
}

// ------ Pie Chart ------
export function genPieTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(800);

    // 1. Small
    {
        const cats = genCategories('Category', 4);
        const data = cats.map(c => ({ Category: c, Value: Math.round(100 + rand() * 500) }));
        tests.push({
            title: 'Pie (small, 4 slices)',
            description: '4 categories',
            tags: ['nominal', 'quantitative', 'small'],
            chartType: 'Pie Chart',
            data,
            fields: [makeField('Category'), makeField('Value')],
            metadata: {
                Category: { type: Type.String, semanticType: 'Category', levels: cats },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { size: makeEncodingItem('Value'), color: makeEncodingItem('Category') },
        });
    }

    // 2. Medium
    {
        const cats = genCategories('Product', 10);
        const data = cats.map(c => ({ Product: c, Revenue: Math.round(1000 + rand() * 9000) }));
        tests.push({
            title: 'Pie (medium, 10 slices)',
            description: '10 products — tests color scheme at boundary',
            tags: ['nominal', 'quantitative', 'medium'],
            chartType: 'Pie Chart',
            data,
            fields: [makeField('Product'), makeField('Revenue')],
            metadata: {
                Product: { type: Type.String, semanticType: 'Product', levels: cats },
                Revenue: { type: Type.Number, semanticType: 'Revenue', levels: [] },
            },
            encodingMap: { size: makeEncodingItem('Revenue'), color: makeEncodingItem('Product') },
        });
    }

    // 3. Large — 25 slices (text overlay should be disabled)
    {
        const cats = genCategories('Region', 25);
        const data = cats.map(c => ({ Region: c, Sales: Math.round(500 + rand() * 5000) }));
        tests.push({
            title: 'Pie (large, 25 slices)',
            description: '25 regions — too many slices for text overlay, legend + tooltip only',
            tags: ['nominal', 'quantitative', 'large', 'stress'],
            chartType: 'Pie Chart',
            data,
            fields: [makeField('Region'), makeField('Sales')],
            metadata: {
                Region: { type: Type.String, semanticType: 'Category', levels: cats },
                Sales: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { size: makeEncodingItem('Sales'), color: makeEncodingItem('Region') },
        });
    }

    // 4. Skewed — one dominant slice + several tiny ones
    {
        const cats = ['Dominant', 'Small-A', 'Small-B', 'Small-C', 'Tiny-1', 'Tiny-2'];
        const vals = [5000, 200, 180, 150, 30, 20];
        const data = cats.map((c, i) => ({ Category: c, Value: vals[i] }));
        tests.push({
            title: 'Pie (skewed, 6 slices)',
            description: 'One dominant slice ~90%, tests circumference pressure with effective bar count',
            tags: ['nominal', 'quantitative', 'skewed'],
            chartType: 'Pie Chart',
            data,
            fields: [makeField('Category'), makeField('Value')],
            metadata: {
                Category: { type: Type.String, semanticType: 'Category', levels: cats },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { size: makeEncodingItem('Value'), color: makeEncodingItem('Category') },
        });
    }

    return tests;
}

// ------ Ranged Dot Plot ------
export function genRangedDotPlotTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(850);

    {
        const cats = genCategories('Country', 8);
        const data: any[] = [];
        for (const c of cats) {
            data.push({ Country: c, Value: Math.round(30 + rand() * 40), Metric: 'Min' });
            data.push({ Country: c, Value: Math.round(60 + rand() * 40), Metric: 'Max' });
        }
        tests.push({
            title: 'Ranged Dot Plot (8 items)',
            description: '8 countries with min/max range',
            tags: ['nominal', 'quantitative', 'color', 'small'],
            chartType: 'Ranged Dot Plot',
            data,
            fields: [makeField('Value'), makeField('Country'), makeField('Metric')],
            metadata: {
                Country: { type: Type.String, semanticType: 'Country', levels: cats },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Metric: { type: Type.String, semanticType: 'Category', levels: ['Min', 'Max'] },
            },
            encodingMap: { x: makeEncodingItem('Value'), y: makeEncodingItem('Country'), color: makeEncodingItem('Metric') },
        });
    }

    return tests;
}

// ------ Lollipop Chart ------
export function genLollipopTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(930);

    // 1. Nominal × Quant (vertical lollipop)
    {
        const countries = ['USA', 'China', 'Japan', 'Germany', 'UK', 'France', 'India', 'Brazil'];
        const data = countries.map(c => ({ Country: c, GDP: Math.round(500 + rand() * 20000) }));
        tests.push({
            title: 'Nominal × Quant (vertical lollipop)',
            description: '8 countries — rule from 0 to value + dot',
            tags: ['nominal', 'quantitative', 'small'],
            chartType: 'Lollipop Chart',
            data,
            fields: [makeField('Country'), makeField('GDP')],
            metadata: {
                Country: { type: Type.String, semanticType: 'Country', levels: countries },
                GDP: { type: Type.Number, semanticType: 'GDP', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Country'), y: makeEncodingItem('GDP') },
        });
    }

    // 2. Nominal × Quant + Color
    {
        const items = genCategories('Product', 10);
        const data = items.map(p => ({
            Product: p,
            Sales: Math.round(100 + rand() * 900),
            Region: rand() > 0.5 ? 'East' : 'West',
        }));
        tests.push({
            title: 'Nominal × Quant + Color (10 items)',
            description: 'Products with color-coded region',
            tags: ['nominal', 'quantitative', 'color', 'medium'],
            chartType: 'Lollipop Chart',
            data,
            fields: [makeField('Product'), makeField('Sales'), makeField('Region')],
            metadata: {
                Product: { type: Type.String, semanticType: 'Category', levels: items },
                Sales: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Region: { type: Type.String, semanticType: 'Category', levels: ['East', 'West'] },
            },
            encodingMap: { x: makeEncodingItem('Product'), y: makeEncodingItem('Sales'), color: makeEncodingItem('Region') },
        });
    }

    // 3. Horizontal lollipop (quant on x, nominal on y)
    {
        const departments = ['Engineering', 'Marketing', 'Sales', 'Support', 'HR', 'Finance'];
        const data = departments.map(d => ({ Department: d, Score: Math.round(40 + rand() * 60) }));
        tests.push({
            title: 'Quant × Nominal (horizontal lollipop)',
            description: '6 departments — horizontal layout',
            tags: ['nominal', 'quantitative', 'small'],
            chartType: 'Lollipop Chart',
            data,
            fields: [makeField('Score'), makeField('Department')],
            metadata: {
                Score: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Department: { type: Type.String, semanticType: 'Category', levels: departments },
            },
            encodingMap: { x: makeEncodingItem('Score'), y: makeEncodingItem('Department') },
        });
    }

    // 4. Color + Column facet
    {
        const regions = ['North', 'South'];
        const categories = genCategories('Item', 6);
        const data: any[] = [];
        for (const r of regions) {
            for (const c of categories) {
                data.push({
                    Item: c,
                    Revenue: Math.round(200 + rand() * 800),
                    Region: r,
                    Tier: rand() > 0.5 ? 'Premium' : 'Standard',
                });
            }
        }
        tests.push({
            title: 'Color + Column Facet',
            description: '6 items × 2 regions faceted, color by tier',
            tags: ['nominal', 'quantitative', 'color', 'facet', 'medium'],
            chartType: 'Lollipop Chart',
            data,
            fields: [makeField('Item'), makeField('Revenue'), makeField('Region'), makeField('Tier')],
            metadata: {
                Item: { type: Type.String, semanticType: 'Category', levels: categories },
                Revenue: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Region: { type: Type.String, semanticType: 'Category', levels: regions },
                Tier: { type: Type.String, semanticType: 'Category', levels: ['Premium', 'Standard'] },
            },
            encodingMap: {
                x: makeEncodingItem('Item'),
                y: makeEncodingItem('Revenue'),
                color: makeEncodingItem('Tier'),
                column: makeEncodingItem('Region'),
            },
        });
    }

    return tests;
}

// ------ Custom Charts (Point, Line, Bar, Rect, Area) ------
export function genCustomTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(900);

    // Custom Point
    {
        const data = Array.from({ length: 50 }, () => ({
            X: Math.round(rand() * 100),
            Y: Math.round(rand() * 100),
            Size: Math.round(rand() * 50),
        }));
        tests.push({
            title: 'Custom Point (50 pts)',
            description: 'Basic custom point with size encoding',
            tags: ['quantitative', 'size', 'medium'],
            chartType: 'Custom Point',
            data,
            fields: [makeField('X'), makeField('Y'), makeField('Size')],
            metadata: {
                X: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Y: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Size: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('X'), y: makeEncodingItem('Y'), size: makeEncodingItem('Size') },
        });
    }

    // Custom Bar
    {
        const cats = genCategories('Status', 5);
        const data = cats.map(c => ({ Status: c, Count: Math.round(10 + rand() * 100) }));
        tests.push({
            title: 'Custom Bar (5 bars)',
            description: 'Status × Count',
            tags: ['nominal', 'quantitative', 'small'],
            chartType: 'Custom Bar',
            data,
            fields: [makeField('Status'), makeField('Count')],
            metadata: {
                Status: { type: Type.String, semanticType: 'Status', levels: cats },
                Count: { type: Type.Number, semanticType: 'Count', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Status'), y: makeEncodingItem('Count') },
        });
    }

    // Custom Area
    {
        const dates = genDates(40, 2022);
        const data = dates.map((d, i) => ({ Date: d, Value: Math.round(50 + rand() * 200 + i * 2) }));
        tests.push({
            title: 'Custom Area (40 pts)',
            description: 'Temporal area chart',
            tags: ['temporal', 'quantitative', 'medium'],
            chartType: 'Custom Area',
            data,
            fields: [makeField('Date'), makeField('Value')],
            metadata: {
                Date: { type: Type.Date, semanticType: 'Date', levels: [] },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Date'), y: makeEncodingItem('Value') },
        });
    }

    return tests;
}

// ------ Waterfall Chart ------
export function genWaterfallTests(): TestCase[] {
    const tests: TestCase[] = [];

    // 1. Simple P&L waterfall — no explicit type column (auto-inferred)
    {
        const data = [
            { Category: 'Revenue',       Amount: 1000 },
            { Category: 'COGS',          Amount: -400 },
            { Category: 'Gross Profit',  Amount: -150 },
            { Category: 'Operating Exp', Amount: -200 },
            { Category: 'Tax',           Amount: -80 },
            { Category: 'Net Income',    Amount: 170 },
        ];
        tests.push({
            title: 'Simple P&L (6 steps, auto type)',
            description: 'Auto-detects first=start, last=end, rest=delta',
            tags: ['nominal', 'small'],
            chartType: 'Waterfall Chart',
            data,
            fields: [makeField('Category'), makeField('Amount')],
            metadata: {
                Category: { type: Type.String, semanticType: 'Category', levels: data.map(d => d.Category) },
                Amount: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Category'), y: makeEncodingItem('Amount') },
        });
    }

    // 2. With explicit Type column (start/delta/end)
    {
        const data = [
            { Step: 'Starting Balance', Value:  5000, Type: 'start' },
            { Step: 'Sales',            Value:  2200, Type: 'delta' },
            { Step: 'Returns',          Value:  -350, Type: 'delta' },
            { Step: 'Payroll',          Value: -1800, Type: 'delta' },
            { Step: 'Rent',             Value:  -600, Type: 'delta' },
            { Step: 'Marketing',        Value:  -400, Type: 'delta' },
            { Step: 'Ending Balance',   Value:  4050, Type: 'end' },
        ];
        tests.push({
            title: 'Explicit Type Column (7 steps)',
            description: 'User-provided start/delta/end type field',
            tags: ['nominal', 'color', 'small'],
            chartType: 'Waterfall Chart',
            data,
            fields: [makeField('Step'), makeField('Value'), makeField('Type')],
            metadata: {
                Step: { type: Type.String, semanticType: 'Category', levels: data.map(d => d.Step) },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Type: { type: Type.String, semanticType: 'Category', levels: ['start', 'delta', 'end'] },
            },
            encodingMap: {
                x: makeEncodingItem('Step'),
                y: makeEncodingItem('Value'),
                color: makeEncodingItem('Type'),
            },
        });
    }

    // 3. Budget variance (all deltas — no start/end)
    {
        const data = [
            { Department: 'Engineering',  Variance: 120 },
            { Department: 'Sales',        Variance: -45 },
            { Department: 'Marketing',    Variance: -80 },
            { Department: 'Operations',   Variance: 35 },
            { Department: 'HR',           Variance: -20 },
            { Department: 'Finance',      Variance: 15 },
            { Department: 'Support',      Variance: -30 },
            { Department: 'Total',        Variance: -5 },
        ];
        tests.push({
            title: 'Budget Variance (8 depts)',
            description: 'Mixed positive/negative deltas with auto start/end',
            tags: ['nominal', 'medium'],
            chartType: 'Waterfall Chart',
            data,
            fields: [makeField('Department'), makeField('Variance')],
            metadata: {
                Department: { type: Type.String, semanticType: 'Category', levels: data.map(d => d.Department) },
                Variance: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Department'), y: makeEncodingItem('Variance') },
        });
    }

    // 4. Larger waterfall — monthly cash flow
    {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const amounts = [500, 200, -150, 300, -100, -250, 400, 150, -300, 200, -50, 100];
        const data = [
            { Month: 'Opening', Amount: 10000, Type: 'start' },
            ...months.map((m, i) => ({ Month: m, Amount: amounts[i], Type: 'delta' })),
            { Month: 'Closing', Amount: 11000, Type: 'end' },
        ];
        tests.push({
            title: 'Monthly Cash Flow (14 steps)',
            description: '12 months with opening & closing balances',
            tags: ['nominal', 'color', 'medium'],
            chartType: 'Waterfall Chart',
            data,
            fields: [makeField('Month'), makeField('Amount'), makeField('Type')],
            metadata: {
                Month: { type: Type.String, semanticType: 'Category', levels: data.map(d => d.Month) },
                Amount: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Type: { type: Type.String, semanticType: 'Category', levels: ['start', 'delta', 'end'] },
            },
            encodingMap: {
                x: makeEncodingItem('Month'),
                y: makeEncodingItem('Amount'),
                color: makeEncodingItem('Type'),
            },
        });
    }

    return tests;
}

// ------ Candlestick Chart ------
export function genCandlestickTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(950);

    // Helper: generate OHLC data
    function genOHLC(days: number, startPrice: number) {
        const data: any[] = [];
        let price = startPrice;
        const baseDate = new Date('2024-01-02');
        for (let i = 0; i < days; i++) {
            const date = new Date(baseDate);
            date.setDate(baseDate.getDate() + i);
            const change = (rand() - 0.48) * 4;  // slight upward bias
            const open = Math.round(price * 100) / 100;
            const close = Math.round((price + change) * 100) / 100;
            const high = Math.round((Math.max(open, close) + rand() * 2) * 100) / 100;
            const low = Math.round((Math.min(open, close) - rand() * 2) * 100) / 100;
            data.push({
                Date: date.toISOString().slice(0, 10),
                Open: open, High: high, Low: low, Close: close,
            });
            price = close;
        }
        return data;
    }

    // 1. 30-day stock price
    {
        const data = genOHLC(30, 150);
        tests.push({
            title: '30-day OHLC',
            description: 'One month of stock data — classic candlestick',
            tags: ['temporal', 'quantitative', 'small'],
            chartType: 'Candlestick Chart',
            data,
            fields: [makeField('Date'), makeField('Open'), makeField('High'), makeField('Low'), makeField('Close')],
            metadata: {
                Date: { type: Type.String, semanticType: 'Date', levels: [] },
                Open: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                High: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Low: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Close: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: {
                x: makeEncodingItem('Date'),
                open: makeEncodingItem('Open'),
                high: makeEncodingItem('High'),
                low: makeEncodingItem('Low'),
                close: makeEncodingItem('Close'),
            },
        });
    }

    // 2. 90-day (denser candles)
    {
        const data = genOHLC(90, 50);
        tests.push({
            title: '90-day OHLC (dense)',
            description: 'Three months — tests bar width auto-sizing',
            tags: ['temporal', 'quantitative', 'medium'],
            chartType: 'Candlestick Chart',
            data,
            fields: [makeField('Date'), makeField('Open'), makeField('High'), makeField('Low'), makeField('Close')],
            metadata: {
                Date: { type: Type.String, semanticType: 'Date', levels: [] },
                Open: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                High: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Low: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Close: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: {
                x: makeEncodingItem('Date'),
                open: makeEncodingItem('Open'),
                high: makeEncodingItem('High'),
                low: makeEncodingItem('Low'),
                close: makeEncodingItem('Close'),
            },
        });
    }

    // 3. Penny stock (low prices, high volatility)
    {
        const data = genOHLC(20, 3);
        tests.push({
            title: 'Penny stock (20 days)',
            description: 'Low prices near zero — tests scale: {zero: false}',
            tags: ['temporal', 'quantitative', 'small'],
            chartType: 'Candlestick Chart',
            data,
            fields: [makeField('Date'), makeField('Open'), makeField('High'), makeField('Low'), makeField('Close')],
            metadata: {
                Date: { type: Type.String, semanticType: 'Date', levels: [] },
                Open: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                High: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Low: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Close: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: {
                x: makeEncodingItem('Date'),
                open: makeEncodingItem('Open'),
                high: makeEncodingItem('High'),
                low: makeEncodingItem('Low'),
                close: makeEncodingItem('Close'),
            },
        });
    }

    // 4. Multi-stock column facet
    {
        const tickers = ['AAPL', 'GOOG', 'MSFT'];
        const data: any[] = [];
        for (const ticker of tickers) {
            const startPrice = ticker === 'AAPL' ? 180 : ticker === 'GOOG' ? 140 : 350;
            let price = startPrice;
            const baseDate = new Date('2024-03-01');
            for (let i = 0; i < 20; i++) {
                const date = new Date(baseDate);
                date.setDate(baseDate.getDate() + i);
                const change = (rand() - 0.48) * 4;
                const open = Math.round(price * 100) / 100;
                const close = Math.round((price + change) * 100) / 100;
                const high = Math.round((Math.max(open, close) + rand() * 2) * 100) / 100;
                const low = Math.round((Math.min(open, close) - rand() * 2) * 100) / 100;
                data.push({ Date: date.toISOString().slice(0, 10), Ticker: ticker, Open: open, High: high, Low: low, Close: close });
                price = close;
            }
        }
        tests.push({
            title: 'Multi-stock facet (3 tickers)',
            description: '3 stocks side-by-side — faceted by ticker',
            tags: ['temporal', 'quantitative', 'facet', 'medium'],
            chartType: 'Candlestick Chart',
            data,
            fields: [makeField('Date'), makeField('Ticker'), makeField('Open'), makeField('High'), makeField('Low'), makeField('Close')],
            metadata: {
                Date: { type: Type.String, semanticType: 'Date', levels: [] },
                Ticker: { type: Type.String, semanticType: 'Category', levels: tickers },
                Open: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                High: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Low: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Close: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: {
                x: makeEncodingItem('Date'),
                open: makeEncodingItem('Open'),
                high: makeEncodingItem('High'),
                low: makeEncodingItem('Low'),
                close: makeEncodingItem('Close'),
                column: makeEncodingItem('Ticker'),
            },
        });
    }

    return tests;
}

// ------ Radar Chart ------
export function genRadarTests(): TestCase[] {
    const tests: TestCase[] = [];

    // 1. Single entity, 5 axes (long format)
    {
        const data = [
            { Player: 'Player A', Metric: 'Speed', Value: 85 },
            { Player: 'Player A', Metric: 'Shooting', Value: 70 },
            { Player: 'Player A', Metric: 'Passing', Value: 90 },
            { Player: 'Player A', Metric: 'Dribbling', Value: 80 },
            { Player: 'Player A', Metric: 'Defense', Value: 60 },
        ];
        tests.push({
            title: 'Single Player Stats (5 axes)',
            description: 'One polygon, 5 numeric dimensions, long format',
            tags: ['radar', 'single'],
            chartType: 'Radar Chart',
            data,
            fields: [makeField('Player'), makeField('Metric'), makeField('Value')],
            metadata: buildMetadata(data),
            encodingMap: { x: makeEncodingItem('Metric'), y: makeEncodingItem('Value'), color: makeEncodingItem('Player') },
        });
    }

    // 2. Two entities comparison
    {
        const data = [
            { Team: 'Team A', Metric: 'Attack', Value: 85 },
            { Team: 'Team A', Metric: 'Defense', Value: 70 },
            { Team: 'Team A', Metric: 'Midfield', Value: 78 },
            { Team: 'Team A', Metric: 'Speed', Value: 90 },
            { Team: 'Team A', Metric: 'Stamina', Value: 65 },
            { Team: 'Team A', Metric: 'Tactics', Value: 80 },
            { Team: 'Team B', Metric: 'Attack', Value: 72 },
            { Team: 'Team B', Metric: 'Defense', Value: 88 },
            { Team: 'Team B', Metric: 'Midfield', Value: 82 },
            { Team: 'Team B', Metric: 'Speed', Value: 68 },
            { Team: 'Team B', Metric: 'Stamina', Value: 85 },
            { Team: 'Team B', Metric: 'Tactics', Value: 75 },
        ];
        tests.push({
            title: 'Two Teams Comparison (6 axes)',
            description: 'Two overlapping polygons, long format',
            tags: ['radar', 'comparison'],
            chartType: 'Radar Chart',
            data,
            fields: [makeField('Team'), makeField('Metric'), makeField('Value')],
            metadata: buildMetadata(data),
            encodingMap: { x: makeEncodingItem('Metric'), y: makeEncodingItem('Value'), color: makeEncodingItem('Team') },
        });
    }

    // 3. Three entities, no fill
    {
        const data = [
            { Product: 'Widget', Metric: 'Quality', Value: 90 },
            { Product: 'Widget', Metric: 'Price', Value: 60 },
            { Product: 'Widget', Metric: 'Durability', Value: 80 },
            { Product: 'Widget', Metric: 'Design', Value: 75 },
            { Product: 'Widget', Metric: 'Support', Value: 85 },
            { Product: 'Gadget', Metric: 'Quality', Value: 70 },
            { Product: 'Gadget', Metric: 'Price', Value: 85 },
            { Product: 'Gadget', Metric: 'Durability', Value: 65 },
            { Product: 'Gadget', Metric: 'Design', Value: 90 },
            { Product: 'Gadget', Metric: 'Support', Value: 50 },
            { Product: 'Doohickey', Metric: 'Quality', Value: 80 },
            { Product: 'Doohickey', Metric: 'Price', Value: 70 },
            { Product: 'Doohickey', Metric: 'Durability', Value: 90 },
            { Product: 'Doohickey', Metric: 'Design', Value: 60 },
            { Product: 'Doohickey', Metric: 'Support', Value: 70 },
        ];
        tests.push({
            title: 'Product Comparison (unfilled)',
            description: 'Three polygons, filled=false, long format',
            tags: ['radar', 'multi', 'config'],
            chartType: 'Radar Chart',
            data,
            fields: [makeField('Product'), makeField('Metric'), makeField('Value')],
            metadata: buildMetadata(data),
            encodingMap: { x: makeEncodingItem('Metric'), y: makeEncodingItem('Value'), color: makeEncodingItem('Product') },
            chartProperties: { filled: false },
        });
    }

    // 4. Faceted radar — one radar per region
    {
        const data = [
            { Region: 'North', Metric: 'Sales', Value: 80 },
            { Region: 'North', Metric: 'Profit', Value: 65 },
            { Region: 'North', Metric: 'Growth', Value: 90 },
            { Region: 'North', Metric: 'Retention', Value: 70 },
            { Region: 'South', Metric: 'Sales', Value: 60 },
            { Region: 'South', Metric: 'Profit', Value: 85 },
            { Region: 'South', Metric: 'Growth', Value: 50 },
            { Region: 'South', Metric: 'Retention', Value: 75 },
            { Region: 'East', Metric: 'Sales', Value: 70 },
            { Region: 'East', Metric: 'Profit', Value: 72 },
            { Region: 'East', Metric: 'Growth', Value: 68 },
            { Region: 'East', Metric: 'Retention', Value: 88 },
        ];
        tests.push({
            title: 'Faceted Radar by Region',
            description: 'One radar per region via column facet',
            tags: ['radar', 'facet'],
            chartType: 'Radar Chart',
            data,
            fields: [makeField('Region'), makeField('Metric'), makeField('Value')],
            metadata: buildMetadata(data),
            encodingMap: { x: makeEncodingItem('Metric'), y: makeEncodingItem('Value'), column: makeEncodingItem('Region') },
        });
    }

    // 5. Long labels — test that labels don't overlap the chart
    {
        const data = [
            { Category: 'Customer Satisfaction Score', Assessment: 'Product A', Score: 82 },
            { Category: 'Annual Revenue Growth Rate', Assessment: 'Product A', Score: 91 },
            { Category: 'Employee Retention', Assessment: 'Product A', Score: 74 },
            { Category: 'Market Share Percentage', Assessment: 'Product A', Score: 68 },
            { Category: 'Net Promoter Score', Assessment: 'Product A', Score: 88 },
            { Category: 'Customer Satisfaction Score', Assessment: 'Product B', Score: 70 },
            { Category: 'Annual Revenue Growth Rate', Assessment: 'Product B', Score: 65 },
            { Category: 'Employee Retention', Assessment: 'Product B', Score: 85 },
            { Category: 'Market Share Percentage', Assessment: 'Product B', Score: 78 },
            { Category: 'Net Promoter Score', Assessment: 'Product B', Score: 60 },
        ];
        tests.push({
            title: 'Long Labels (5 axes)',
            description: 'Labels with long text should not overlap the radar',
            tags: ['radar', 'labels'],
            chartType: 'Radar Chart',
            data,
            fields: [makeField('Category'), makeField('Assessment'), makeField('Score')],
            metadata: buildMetadata(data),
            encodingMap: { x: makeEncodingItem('Category'), y: makeEncodingItem('Score'), color: makeEncodingItem('Assessment') },
        });
    }

    // 6. Many axes with long labels (8)
    {
        const metrics = [
            'Overall User Experience', 'First Contentful Paint',
            'Time to Interactive', 'Cumulative Layout Shift',
            'Server Response Time', 'Error Rate per Minute',
            'Database Query Latency', 'API Throughput',
        ];
        const data = metrics.flatMap(m => [
            { App: 'Frontend', KPI: m, Rating: Math.round(50 + Math.random() * 50) },
            { App: 'Backend', KPI: m, Rating: Math.round(40 + Math.random() * 60) },
        ]);
        tests.push({
            title: 'Many Axes + Long Labels (8 axes)',
            description: '8 axes with verbose labels, two groups',
            tags: ['radar', 'labels', 'many-axes'],
            chartType: 'Radar Chart',
            data,
            fields: [makeField('App'), makeField('KPI'), makeField('Rating')],
            metadata: buildMetadata(data),
            encodingMap: { x: makeEncodingItem('KPI'), y: makeEncodingItem('Rating'), color: makeEncodingItem('App') },
        });
    }

    // 7. Many many metrics (12 axes)
    {
        const metrics = [
            'Revenue', 'Profit Margin', 'Customer Retention',
            'Brand Awareness', 'Market Penetration', 'Product Quality',
            'Employee Engagement', 'Innovation Index', 'Supply Chain Efficiency',
            'Digital Transformation', 'Sustainability Rating', 'Compliance Score',
        ];
        const data = metrics.flatMap(m => [
            { Division: 'Americas', Factor: m, Score: Math.round(30 + Math.random() * 70) },
            { Division: 'EMEA', Factor: m, Score: Math.round(30 + Math.random() * 70) },
            { Division: 'APAC', Factor: m, Score: Math.round(30 + Math.random() * 70) },
        ]);
        tests.push({
            title: 'Many Metrics (12 axes)',
            description: '12 axes with 3 groups — tests label crowding',
            tags: ['radar', 'labels', 'crowded'],
            chartType: 'Radar Chart',
            data,
            fields: [makeField('Division'), makeField('Factor'), makeField('Score')],
            metadata: buildMetadata(data),
            encodingMap: { x: makeEncodingItem('Factor'), y: makeEncodingItem('Score'), color: makeEncodingItem('Division') },
        });
    }

    return tests;
}

// ------ Pyramid Chart ------
export function genPyramidTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(777);

    // Helper to generate long-format pyramid data from two groups
    const makeLongData = (categories: string[], groupA: string, groupB: string, valField: string, minA: number, rangeA: number, minB: number, rangeB: number) => {
        const data: any[] = [];
        for (const cat of categories) {
            data.push({ [valField]: Math.round(minA + rand() * rangeA), Group: groupA, Category: cat });
            data.push({ [valField]: Math.round(minB + rand() * rangeB), Group: groupB, Category: cat });
        }
        return data;
    };

    // 1. Classic population pyramid — Age Group × Gender × Population
    {
        const ageGroups = ['0-9', '10-19', '20-29', '30-39', '40-49', '50-59', '60-69', '70-79', '80+'];
        const data: any[] = [];
        for (const ag of ageGroups) {
            data.push({ 'Age Group': ag, Gender: 'Male', Population: Math.round(500 + rand() * 4500) });
            data.push({ 'Age Group': ag, Gender: 'Female', Population: Math.round(500 + rand() * 4500) });
        }
        tests.push({
            title: 'Population pyramid (9 age groups)',
            description: 'Classic population pyramid — long format with Gender as color',
            tags: ['nominal', 'quantitative', 'color', 'small'],
            chartType: 'Pyramid Chart',
            data,
            fields: [makeField('Age Group'), makeField('Population'), makeField('Gender')],
            metadata: {
                'Age Group': { type: Type.String, semanticType: 'Category', levels: ageGroups },
                Population: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Gender: { type: Type.String, semanticType: 'Category', levels: ['Male', 'Female'] },
            },
            encodingMap: { y: makeEncodingItem('Age Group'), x: makeEncodingItem('Population'), color: makeEncodingItem('Gender') },
        });
    }

    // 2. Workforce pyramid
    {
        const grades = ['Junior', 'Mid-level', 'Senior', 'Lead', 'Manager', 'Director'];
        const data: any[] = [];
        for (const g of grades) {
            data.push({ Grade: g, Type: 'Full-Time', Count: Math.round(20 + rand() * 200) });
            data.push({ Grade: g, Type: 'Part-Time', Count: Math.round(10 + rand() * 80) });
        }
        tests.push({
            title: 'Workforce pyramid (6 grades)',
            description: 'Grade levels on y, Count on x, Full-Time vs Part-Time as color',
            tags: ['nominal', 'quantitative', 'color', 'small'],
            chartType: 'Pyramid Chart',
            data,
            fields: [makeField('Grade'), makeField('Count'), makeField('Type')],
            metadata: {
                Grade: { type: Type.String, semanticType: 'Category', levels: grades },
                Count: { type: Type.Number, semanticType: 'Count', levels: [] },
                Type: { type: Type.String, semanticType: 'Category', levels: ['Full-Time', 'Part-Time'] },
            },
            encodingMap: { y: makeEncodingItem('Grade'), x: makeEncodingItem('Count'), color: makeEncodingItem('Type') },
        });
    }

    // 3. Survey responses
    {
        const levels = ['Very Low', 'Low', 'Medium', 'High', 'Very High'];
        const data: any[] = [];
        for (const lv of levels) {
            data.push({ 'Satisfaction Level': lv, Response: 'Agree', Count: Math.round(50 + rand() * 300) });
            data.push({ 'Satisfaction Level': lv, Response: 'Disagree', Count: Math.round(30 + rand() * 250) });
        }
        tests.push({
            title: 'Survey pyramid (5 levels)',
            description: 'Satisfaction levels — Agree vs Disagree',
            tags: ['ordinal', 'quantitative', 'color', 'small'],
            chartType: 'Pyramid Chart',
            data,
            fields: [makeField('Satisfaction Level'), makeField('Count'), makeField('Response')],
            metadata: {
                'Satisfaction Level': { type: Type.String, semanticType: 'Category', levels: levels },
                Count: { type: Type.Number, semanticType: 'Count', levels: [] },
                Response: { type: Type.String, semanticType: 'Category', levels: ['Agree', 'Disagree'] },
            },
            encodingMap: { y: makeEncodingItem('Satisfaction Level'), x: makeEncodingItem('Count'), color: makeEncodingItem('Response') },
        });
    }

    // 4. Income bracket pyramid (medium)
    {
        const brackets = ['<$20K', '$20-30K', '$30-40K', '$40-50K', '$50-60K', '$60-70K',
            '$70-80K', '$80-90K', '$90-100K', '$100-120K', '$120-150K', '$150K+'];
        const data: any[] = [];
        for (const b of brackets) {
            data.push({ 'Income Bracket': b, Area: 'Urban', Count: Math.round(100 + rand() * 3000) });
            data.push({ 'Income Bracket': b, Area: 'Rural', Count: Math.round(80 + rand() * 2000) });
        }
        tests.push({
            title: 'Income pyramid (12 brackets)',
            description: '12 income bands — Urban vs Rural',
            tags: ['ordinal', 'quantitative', 'color', 'medium'],
            chartType: 'Pyramid Chart',
            data,
            fields: [makeField('Income Bracket'), makeField('Count'), makeField('Area')],
            metadata: {
                'Income Bracket': { type: Type.String, semanticType: 'Category', levels: brackets },
                Count: { type: Type.Number, semanticType: 'Count', levels: [] },
                Area: { type: Type.String, semanticType: 'Category', levels: ['Urban', 'Rural'] },
            },
            encodingMap: { y: makeEncodingItem('Income Bracket'), x: makeEncodingItem('Count'), color: makeEncodingItem('Area') },
        });
    }

    // 5. Education pyramid
    {
        const degrees = ['High School', 'Associate', 'Bachelor', 'Master', 'Doctorate'];
        const data: any[] = [];
        for (const d of degrees) {
            data.push({ 'Degree Level': d, Outcome: 'Admitted', Count: Math.round(200 + rand() * 5000) });
            data.push({ 'Degree Level': d, Outcome: 'Rejected', Count: Math.round(100 + rand() * 3000) });
        }
        tests.push({
            title: 'Education pyramid (5 degrees)',
            description: 'Degree levels — Admitted vs Rejected applicants',
            tags: ['ordinal', 'quantitative', 'color', 'small'],
            chartType: 'Pyramid Chart',
            data,
            fields: [makeField('Degree Level'), makeField('Count'), makeField('Outcome')],
            metadata: {
                'Degree Level': { type: Type.String, semanticType: 'Category', levels: degrees },
                Count: { type: Type.Number, semanticType: 'Count', levels: [] },
                Outcome: { type: Type.String, semanticType: 'Category', levels: ['Admitted', 'Rejected'] },
            },
            encodingMap: { y: makeEncodingItem('Degree Level'), x: makeEncodingItem('Count'), color: makeEncodingItem('Outcome') },
        });
    }

    // 6. Country comparison
    {
        const countries = genCategories('Country', 10);
        const data: any[] = [];
        for (const c of countries) {
            data.push({ Country: c, Direction: 'Import', Value: Math.round(1000 + rand() * 50000) });
            data.push({ Country: c, Direction: 'Export', Value: Math.round(1000 + rand() * 50000) });
        }
        tests.push({
            title: 'Trade pyramid (10 countries)',
            description: '10 countries — Import vs Export trade values',
            tags: ['nominal', 'quantitative', 'color', 'medium'],
            chartType: 'Pyramid Chart',
            data,
            fields: [makeField('Country'), makeField('Value'), makeField('Direction')],
            metadata: {
                Country: { type: Type.String, semanticType: 'Country', levels: countries },
                Value: { type: Type.Number, semanticType: 'Amount', levels: [] },
                Direction: { type: Type.String, semanticType: 'Category', levels: ['Import', 'Export'] },
            },
            encodingMap: { y: makeEncodingItem('Country'), x: makeEncodingItem('Value'), color: makeEncodingItem('Direction') },
        });
    }

    // 7. Large cardinality (20 age bands)
    {
        const ageBands = Array.from({ length: 20 }, (_, i) => {
            const lo = i * 5;
            const hi = lo + 4;
            return `${lo}-${hi}`;
        });
        const data: any[] = [];
        for (const ag of ageBands) {
            data.push({ 'Age Band': ag, Gender: 'Male', Population: Math.round(200 + rand() * 8000) });
            data.push({ 'Age Band': ag, Gender: 'Female', Population: Math.round(200 + rand() * 8000) });
        }
        tests.push({
            title: 'Overstretch pyramid (20 age bands)',
            description: '20 fine-grained age bands — tests y-axis elastic overstretch',
            tags: ['nominal', 'quantitative', 'color', 'large', 'overstretch'],
            chartType: 'Pyramid Chart',
            data,
            fields: [makeField('Age Band'), makeField('Population'), makeField('Gender')],
            metadata: {
                'Age Band': { type: Type.String, semanticType: 'Category', levels: ageBands },
                Population: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Gender: { type: Type.String, semanticType: 'Category', levels: ['Male', 'Female'] },
            },
            encodingMap: { y: makeEncodingItem('Age Band'), x: makeEncodingItem('Population'), color: makeEncodingItem('Gender') },
        });
    }

    // 8. Negative values — should trigger warning
    {
        const ageGroups = ['0-14', '15-29', '30-44', '45-59', '60-74', '75+'];
        const data: any[] = [];
        for (const ag of ageGroups) {
            data.push({ 'Age Group': ag, Gender: 'Male', Population: Math.round(-500 + rand() * 4000) });
            data.push({ 'Age Group': ag, Gender: 'Female', Population: Math.round(-300 + rand() * 3500) });
        }
        tests.push({
            title: 'Negative values warning (6 groups)',
            description: 'Some values are negative — should trigger negative-value warnings',
            tags: ['nominal', 'quantitative', 'color', 'small', 'warning', 'negative'],
            chartType: 'Pyramid Chart',
            data,
            fields: [makeField('Age Group'), makeField('Population'), makeField('Gender')],
            metadata: {
                'Age Group': { type: Type.String, semanticType: 'Category', levels: ageGroups },
                Population: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Gender: { type: Type.String, semanticType: 'Category', levels: ['Male', 'Female'] },
            },
            encodingMap: { y: makeEncodingItem('Age Group'), x: makeEncodingItem('Population'), color: makeEncodingItem('Gender') },
        });
    }

    return tests;
}

// ------ Rose Chart (Nightingale / Coxcomb) ------
export function genRoseTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(1100);

    // 1. Basic rose — wind directions × speed
    {
        const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const data = directions.map(d => ({ Direction: d, Speed: Math.round(5 + rand() * 25) }));
        tests.push({
            title: 'Rose (basic, 8 directions)',
            description: 'Wind speed by compass direction — classic coxcomb',
            tags: ['nominal', 'quantitative', 'small'],
            chartType: 'Rose Chart',
            data,
            fields: [makeField('Direction'), makeField('Speed')],
            metadata: {
                Direction: { type: Type.String, semanticType: 'Category', levels: directions },
                Speed: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Direction'), y: makeEncodingItem('Speed') },
            chartProperties: { alignment: 'center' },
        });
    }

    // 2. Stacked rose — wind directions × speed × season
    {
        const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const seasons = ['Spring', 'Summer', 'Autumn', 'Winter'];
        const data: any[] = [];
        for (const d of directions) {
            for (const s of seasons) {
                data.push({ Direction: d, Speed: Math.round(3 + rand() * 20), Season: s });
            }
        }
        tests.push({
            title: 'Stacked Rose (8 dirs × 4 seasons)',
            description: 'Wind speed stacked by season — polar stacked bar',
            tags: ['nominal', 'quantitative', 'color', 'stacked'],
            chartType: 'Rose Chart',
            data,
            fields: [makeField('Direction'), makeField('Speed'), makeField('Season')],
            metadata: {
                Direction: { type: Type.String, semanticType: 'Category', levels: directions },
                Speed: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Season: { type: Type.String, semanticType: 'Category', levels: seasons },
            },
            encodingMap: { x: makeEncodingItem('Direction'), y: makeEncodingItem('Speed'), color: makeEncodingItem('Season') },
            chartProperties: { alignment: 'center' },
        });
    }

    // 3. Rose with many categories
    {
        const cats = genCategories('Category', 12);
        const data = cats.map(c => ({ Category: c, Value: Math.round(10 + rand() * 90) }));
        tests.push({
            title: 'Rose (medium, 12 categories)',
            description: '12 categories — tests angular spacing with more slices',
            tags: ['nominal', 'quantitative', 'medium'],
            chartType: 'Rose Chart',
            data,
            fields: [makeField('Category'), makeField('Value')],
            metadata: {
                Category: { type: Type.String, semanticType: 'Category', levels: cats },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Category'), y: makeEncodingItem('Value') },
        });
    }

    // 4. Rose with color stacking and many groups
    {
        const products = genCategories('Product', 6);
        const regions = ['North', 'South', 'East', 'West'];
        const data: any[] = [];
        for (const p of products) {
            for (const r of regions) {
                data.push({ Product: p, Sales: Math.round(100 + rand() * 900), Region: r });
            }
        }
        tests.push({
            title: 'Stacked Rose (6 products × 4 regions)',
            description: 'Product sales stacked by region',
            tags: ['nominal', 'quantitative', 'color', 'stacked', 'medium'],
            chartType: 'Rose Chart',
            data,
            fields: [makeField('Product'), makeField('Sales'), makeField('Region')],
            metadata: {
                Product: { type: Type.String, semanticType: 'Product', levels: products },
                Sales: { type: Type.Number, semanticType: 'Revenue', levels: [] },
                Region: { type: Type.String, semanticType: 'Category', levels: regions },
            },
            encodingMap: { x: makeEncodingItem('Product'), y: makeEncodingItem('Sales'), color: makeEncodingItem('Region') },
        });
    }

    // 5. Rose with inner radius (donut-rose)
    {
        const months = genMonths(12);
        const data = months.map(m => ({ Month: m, Rainfall: Math.round(20 + rand() * 150) }));
        tests.push({
            title: 'Donut Rose (12 months, innerRadius)',
            description: 'Monthly rainfall with inner radius — donut style rose',
            tags: ['ordinal', 'quantitative', 'properties'],
            chartType: 'Rose Chart',
            data,
            fields: [makeField('Month'), makeField('Rainfall')],
            metadata: {
                Month: { type: Type.String, semanticType: 'Month', levels: months },
                Rainfall: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Month'), y: makeEncodingItem('Rainfall') },
            chartProperties: { innerRadius: 40 },
        });
    }

    // 6. Rose with padAngle
    {
        const departments = genCategories('Department', 8);
        const data = departments.map(d => ({ Department: d, Score: Math.round(50 + rand() * 50) }));
        tests.push({
            title: 'Rose with gap (padAngle)',
            description: 'Departments with angle padding between slices',
            tags: ['nominal', 'quantitative', 'properties'],
            chartType: 'Rose Chart',
            data,
            fields: [makeField('Department'), makeField('Score')],
            metadata: {
                Department: { type: Type.String, semanticType: 'Department', levels: departments },
                Score: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { x: makeEncodingItem('Department'), y: makeEncodingItem('Score') },
            chartProperties: { padAngle: 0.03 },
        });
    }

    // 7. Faceted rose — directions by year (column facet)
    {
        const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const years = ['2022', '2023', '2024'];
        const data: any[] = [];
        for (const yr of years) {
            for (const d of directions) {
                data.push({ Direction: d, Speed: Math.round(4 + rand() * 20), Year: yr });
            }
        }
        tests.push({
            title: 'Faceted Rose (column)',
            description: 'Wind rose per year — faceted by column',
            tags: ['nominal', 'quantitative', 'facet'],
            chartType: 'Rose Chart',
            data,
            fields: [makeField('Direction'), makeField('Speed'), makeField('Year')],
            metadata: {
                Direction: { type: Type.String, semanticType: 'Direction', levels: directions },
                Speed: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Year: { type: Type.String, semanticType: 'Year', levels: years },
            },
            encodingMap: { x: makeEncodingItem('Direction'), y: makeEncodingItem('Speed'), column: makeEncodingItem('Year') },
            chartProperties: { alignment: 'center' },
        });
    }

    // 8. Faceted stacked rose — directions × season, faceted by location
    {
        const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const seasons = ['Spring', 'Summer', 'Autumn', 'Winter'];
        const locations = ['Coastal', 'Inland'];
        const data: any[] = [];
        for (const loc of locations) {
            for (const d of directions) {
                for (const s of seasons) {
                    data.push({ Direction: d, Speed: Math.round(3 + rand() * 18), Season: s, Location: loc });
                }
            }
        }
        tests.push({
            title: 'Faceted Stacked Rose (column)',
            description: 'Stacked wind rose by season, faceted by location',
            tags: ['nominal', 'quantitative', 'color', 'stacked', 'facet'],
            chartType: 'Rose Chart',
            data,
            fields: [makeField('Direction'), makeField('Speed'), makeField('Season'), makeField('Location')],
            metadata: {
                Direction: { type: Type.String, semanticType: 'Direction', levels: directions },
                Speed: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Season: { type: Type.String, semanticType: 'Category', levels: seasons },
                Location: { type: Type.String, semanticType: 'Category', levels: locations },
            },
            encodingMap: {
                x: makeEncodingItem('Direction'), y: makeEncodingItem('Speed'),
                color: makeEncodingItem('Season'), column: makeEncodingItem('Location'),
            },
            chartProperties: { alignment: 'center' },
        });
    }

    // 9. Faceted rose — monthly rainfall by region (3 regions)
    {
        const months = genMonths(12);
        const regions = ['North', 'Central', 'South'];
        const data: any[] = [];
        for (const r of regions) {
            for (const m of months) {
                data.push({ Month: m, Rainfall: Math.round(10 + rand() * 140), Region: r });
            }
        }
        tests.push({
            title: 'Faceted Rose (monthly × region)',
            description: 'Monthly rainfall rose faceted by region',
            tags: ['ordinal', 'quantitative', 'facet'],
            chartType: 'Rose Chart',
            data,
            fields: [makeField('Month'), makeField('Rainfall'), makeField('Region')],
            metadata: {
                Month: { type: Type.String, semanticType: 'Month', levels: months },
                Rainfall: { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Region: { type: Type.String, semanticType: 'Category', levels: regions },
            },
            encodingMap: { x: makeEncodingItem('Month'), y: makeEncodingItem('Rainfall'), column: makeEncodingItem('Region') },
        });
    }

    return tests;
}
