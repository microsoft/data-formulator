// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Type } from '../../../data/types';
import { Channel, EncodingItem } from '../../../components/ComponentType';
import { TestCase, DateFormat, makeField, makeEncodingItem } from './types';
import { seededRandom } from './generators';

// ---------------------------------------------------------------------------
// Shared helper: generate test cases from date format definitions × chart types
// ---------------------------------------------------------------------------
export function genDateTests(dateFormats: DateFormat[], seed: number): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(seed);

    const chartConfigs: { chartType: string; needsColor: boolean }[] = [
        { chartType: 'Bar Chart', needsColor: false },
        { chartType: 'Line Chart', needsColor: false },
        { chartType: 'Scatter Plot', needsColor: false },
        { chartType: 'Area Chart', needsColor: false },
        { chartType: 'Stacked Bar Chart', needsColor: true },
    ];
    const colorCategories = ['Alpha', 'Beta', 'Gamma'];

    for (const fmt of dateFormats) {
        for (const cfg of chartConfigs) {
            const data: Record<string, any>[] = [];
            for (const v of fmt.values) {
                if (cfg.needsColor) {
                    for (const cat of colorCategories) {
                        data.push({ [fmt.fieldName]: v, Value: Math.round(50 + rand() * 500), Category: cat });
                    }
                } else {
                    data.push({ [fmt.fieldName]: v, Value: Math.round(50 + rand() * 500) });
                }
            }

            const fields = [makeField(fmt.fieldName), makeField('Value')];
            const metadata: Record<string, { type: Type; semanticType: string; levels: any[] }> = {
                [fmt.fieldName]: { type: fmt.expectedType, semanticType: fmt.semanticType, levels: fmt.values },
                Value: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            };
            const encodingMap: Partial<Record<Channel, EncodingItem>> = {
                x: makeEncodingItem(fmt.fieldName),
                y: makeEncodingItem('Value'),
            };

            if (cfg.needsColor) {
                fields.push(makeField('Category'));
                metadata.Category = { type: Type.String, semanticType: 'Category', levels: colorCategories };
                encodingMap.color = makeEncodingItem('Category');
            }

            tests.push({
                title: `${fmt.label} → ${cfg.chartType}`,
                description: `${fmt.description} (${fmt.values.length} values)`,
                tags: ['date-format', fmt.semanticType.toLowerCase(), cfg.chartType.toLowerCase().replace(/ /g, '-')],
                chartType: cfg.chartType,
                data,
                fields,
                metadata,
                encodingMap,
            });
        }
    }
    return tests;
}

// ---------------------------------------------------------------------------
// 1. Year — all representations
// ---------------------------------------------------------------------------
export function genDateYearTests(): TestCase[] {
    return genDateTests([
        {
            label: 'Year (string)',
            description: 'Years as 4-digit strings: "2000", "2001", …',
            values: Array.from({ length: 12 }, (_, i) => String(2000 + i)),
            fieldName: 'Year',
            expectedType: Type.String,
            semanticType: 'Year',
        },
        {
            label: 'Year (number)',
            description: 'Years as integers: 2000, 2001, …',
            values: Array.from({ length: 12 }, (_, i) => 2000 + i),
            fieldName: 'Year',
            expectedType: Type.Number,
            semanticType: 'Year',
        },
        {
            label: 'Year (ISO date)',
            description: 'Years as ISO strings: "2000-01-01", "2001-01-01", …',
            values: Array.from({ length: 12 }, (_, i) => `${2000 + i}-01-01`),
            fieldName: 'Date',
            expectedType: Type.Date,
            semanticType: 'Date',
        },
        {
            label: 'Year (UTC ms)',
            description: 'Years as UTC timestamps in ms: 946684800000, …',
            values: Array.from({ length: 12 }, (_, i) => new Date(2000 + i, 0, 1).getTime()),
            fieldName: 'Timestamp',
            expectedType: Type.Number,
            semanticType: 'Timestamp',
        },
        {
            label: 'Year (2-digit string)',
            description: 'Two-digit years: "98", "99", "00", "01", …',
            values: Array.from({ length: 10 }, (_, i) => String((98 + i) % 100).padStart(2, '0')),
            fieldName: 'Year',
            expectedType: Type.String,
            semanticType: 'Year',
        },
        {
            label: 'Fiscal Year (FY YYYY)',
            description: 'Fiscal years: "FY 2018", "FY 2019", …',
            values: Array.from({ length: 8 }, (_, i) => `FY ${2018 + i}`),
            fieldName: 'FiscalYear',
            expectedType: Type.String,
            semanticType: 'Year',
        },
    ], 8801);
}

// ---------------------------------------------------------------------------
// 2. Month only
// ---------------------------------------------------------------------------
export function genDateMonthTests(): TestCase[] {
    return genDateTests([
        {
            label: 'Month (English)',
            description: 'Month short names: "Jan", "Feb", …',
            values: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
            fieldName: 'Month',
            expectedType: Type.String,
            semanticType: 'Month',
        },
        {
            label: 'Month (full English)',
            description: 'Full month names: "January", "February", …',
            values: ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'],
            fieldName: 'Month',
            expectedType: Type.String,
            semanticType: 'Month',
        },
        {
            label: 'Month (number)',
            description: 'Months as integers: 1, 2, …, 12',
            values: Array.from({ length: 12 }, (_, i) => i + 1),
            fieldName: 'Month',
            expectedType: Type.Number,
            semanticType: 'Month',
        },
    ], 8802);
}

// ---------------------------------------------------------------------------
// 3. Year-Month
// ---------------------------------------------------------------------------
export function genDateYearMonthTests(): TestCase[] {
    return genDateTests([
        {
            label: 'Year-Month (YYYY-MM, 1 year)',
            description: 'Year-month strings within one year: "2020-01", …, "2020-12"',
            values: Array.from({ length: 12 }, (_, i) => `2020-${String(i + 1).padStart(2, '0')}`),
            fieldName: 'Date',
            expectedType: Type.Date,
            semanticType: 'Date',
        },
        {
            label: 'Year-Month (YYYY-MM, 3 years)',
            description: 'Year-month strings spanning 3 years: "2020-01", …, "2022-12"',
            values: (() => {
                const vals: string[] = [];
                for (let y = 2020; y <= 2022; y++)
                    for (let m = 1; m <= 12; m++)
                        vals.push(`${y}-${String(m).padStart(2, '0')}`);
                return vals;
            })(),
            fieldName: 'Date',
            expectedType: Type.Date,
            semanticType: 'Date',
        },
        {
            label: 'Year-Month (Mon YYYY, 1 year)',
            description: 'Natural year-month within one year: "Jan 2020", …, "Dec 2020"',
            values: (() => {
                const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                return months.map(m => `${m} 2020`);
            })(),
            fieldName: 'Date',
            expectedType: Type.Date,
            semanticType: 'Date',
        },
        {
            label: 'Year-Month (Mon YYYY, 5 years)',
            description: 'Natural year-month spanning 5 years: "Jan 2018", …, "Dec 2022"',
            values: (() => {
                const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                const vals: string[] = [];
                for (let y = 2018; y <= 2022; y++)
                    for (const m of months) vals.push(`${m} ${y}`);
                return vals;
            })(),
            fieldName: 'Date',
            expectedType: Type.Date,
            semanticType: 'Date',
        },
        {
            label: 'Quarter (Q# YYYY)',
            description: 'Quarter strings: "Q1 2020", "Q2 2020", …',
            values: (() => {
                const quarters: string[] = [];
                for (let y = 2018; y <= 2023; y++) {
                    for (let q = 1; q <= 4; q++) quarters.push(`Q${q} ${y}`);
                }
                return quarters;
            })(),
            fieldName: 'Quarter',
            expectedType: Type.String,
            semanticType: 'Quarter',
        },
        {
            label: 'Week (Wk ##)',
            description: 'Week labels: "Wk 01", "Wk 02", …, "Wk 24"',
            values: Array.from({ length: 24 }, (_, i) => `Wk ${String(i + 1).padStart(2, '0')}`),
            fieldName: 'Week',
            expectedType: Type.String,
            semanticType: 'Week',
        },
    ], 8803);
}

// ---------------------------------------------------------------------------
// 4. Decade
// ---------------------------------------------------------------------------
export function genDateDecadeTests(): TestCase[] {
    return genDateTests([
        {
            label: 'Decade (XXXXs)',
            description: 'Decades as strings with "s": "1950s", "1960s", …',
            values: Array.from({ length: 8 }, (_, i) => `${1950 + i * 10}s`),
            fieldName: 'Decade',
            expectedType: Type.String,
            semanticType: 'Decade',
        },
        {
            label: 'Decade (string)',
            description: 'Decades as plain strings: "1950", "1960", …',
            values: Array.from({ length: 8 }, (_, i) => String(1950 + i * 10)),
            fieldName: 'Decade',
            expectedType: Type.String,
            semanticType: 'Decade',
        },
        {
            label: 'Decade (number)',
            description: 'Decades as integers: 1950, 1960, …',
            values: Array.from({ length: 8 }, (_, i) => 1950 + i * 10),
            fieldName: 'Decade',
            expectedType: Type.Number,
            semanticType: 'Decade',
        },
    ], 8804);
}

// ---------------------------------------------------------------------------
// 5. Date / DateTime
// ---------------------------------------------------------------------------
export function genDateDateTimeTests(): TestCase[] {
    return genDateTests([
        {
            label: 'Date (ISO YYYY-MM-DD, 1 year)',
            description: 'ISO date strings within one year: "2020-01-15", "2020-02-15", …',
            values: Array.from({ length: 12 }, (_, i) => `2020-${String(i + 1).padStart(2, '0')}-15`),
            fieldName: 'Date',
            expectedType: Type.Date,
            semanticType: 'Date',
        },
        {
            label: 'Date (ISO YYYY-MM-DD, 3 years)',
            description: 'ISO date strings spanning 3 years: "2020-01-15", …, "2022-12-15"',
            values: (() => {
                const vals: string[] = [];
                for (let y = 2020; y <= 2022; y++)
                    for (let m = 1; m <= 12; m++)
                        vals.push(`${y}-${String(m).padStart(2, '0')}-15`);
                return vals;
            })(),
            fieldName: 'Date',
            expectedType: Type.Date,
            semanticType: 'Date',
        },
        {
            label: 'Date (Mon DD YYYY)',
            description: 'Natural date: "Jan 15 2020", "Feb 15 2020", …',
            values: (() => {
                const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                return months.map(m => `${m} 15 2020`);
            })(),
            fieldName: 'Date',
            expectedType: Type.Date,
            semanticType: 'Date',
        },
        {
            label: 'Date (MM/DD/YYYY)',
            description: 'US date format: "01/15/2020", "02/15/2020", …',
            values: Array.from({ length: 12 }, (_, i) => `${String(i + 1).padStart(2, '0')}/15/2020`),
            fieldName: 'Date',
            expectedType: Type.Date,
            semanticType: 'Date',
        },
        {
            label: 'Date (DD.MM.YYYY)',
            description: 'European date: "15.01.2020", "15.02.2020", …',
            values: Array.from({ length: 12 }, (_, i) => `15.${String(i + 1).padStart(2, '0')}.2020`),
            fieldName: 'Date',
            expectedType: Type.String,
            semanticType: 'Date',
        },
        {
            label: 'DateTime (ISO 8601)',
            description: 'Full datetime: "2020-01-01T08:00:00", …',
            values: Array.from({ length: 10 }, (_, i) => `2020-01-${String(i + 1).padStart(2, '0')}T${String(8 + i).padStart(2, '0')}:00:00`),
            fieldName: 'DateTime',
            expectedType: Type.Date,
            semanticType: 'DateTime',
        },
    ], 8805);
}

// ---------------------------------------------------------------------------
// 6. Hours — within a day and across days
// ---------------------------------------------------------------------------
export function genDateHoursTests(): TestCase[] {
    return genDateTests([
        {
            label: 'Hours (same day)',
            description: 'Hourly data within one day: "2020-01-15T00:00", …, "2020-01-15T23:00"',
            values: Array.from({ length: 24 }, (_, i) => `2020-01-15T${String(i).padStart(2, '0')}:00:00`),
            fieldName: 'DateTime',
            expectedType: Type.Date,
            semanticType: 'DateTime',
        },
        {
            label: 'Hours (across days)',
            description: 'Hourly data across 3 days: "2020-01-01T00:00", …',
            values: Array.from({ length: 24 }, (_, i) => {
                const day = Math.floor(i / 8) + 1;
                const hour = i % 8 + 8;
                return `2020-01-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00`;
            }),
            fieldName: 'DateTime',
            expectedType: Type.Date,
            semanticType: 'DateTime',
        },
        {
            label: 'Hours (UTC ms, same day)',
            description: 'Hourly timestamps in ms for one day',
            values: Array.from({ length: 24 }, (_, i) => new Date(2020, 0, 15, i).getTime()),
            fieldName: 'Timestamp',
            expectedType: Type.Number,
            semanticType: 'Timestamp',
        },
        {
            label: 'Minutes (same hour)',
            description: 'Per-minute data within one hour: "2020-01-15T10:00", …, "2020-01-15T10:59"',
            values: Array.from({ length: 30 }, (_, i) => `2020-01-15T10:${String(i * 2).padStart(2, '0')}:00`),
            fieldName: 'DateTime',
            expectedType: Type.Date,
            semanticType: 'DateTime',
        },
    ], 8806);
}
