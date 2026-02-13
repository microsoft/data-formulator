// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ChartTestPage — Exhaustive visual test page for Vega-Lite chart assembly.
 *
 * For each chart type, generates synthetic datasets that:
 *   1. Test different x, y, color, column combinations
 *   2. Exhaust temporal, quantitative, ordinal, nominal encoding types
 *   3. Cover small (3-5), medium (10-20), large (50-100+) cardinality
 *   4. Include diverse semantic types (dates, categories, measures, etc.)
 *
 * Each chart type has its own sub-page, navigable via tabs.
 * Charts are rendered directly with vega-embed (bypassing Redux state).
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
    Box, Tabs, Tab, Typography, Paper, Chip, Divider,
} from '@mui/material';
import embed from 'vega-embed';
import { getChartTemplate, CHART_TEMPLATES } from '../components/ChartTemplates';
import { Type } from '../data/types';
import { assembleVegaChart } from '../app/utils';
import { Channel, EncodingItem, FieldItem } from '../components/ComponentType';
import { channels } from '../components/ChartTemplates';
import { AssembleOptions } from '../lib/agents-chart-lib';

// ============================================================================
// Synthetic Data Generators
// ============================================================================

/** Generate an array of sequential dates */
function genDates(n: number, startYear = 2018): string[] {
    const dates: string[] = [];
    const start = new Date(startYear, 0, 1);
    for (let i = 0; i < n; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + Math.floor(i * (365 * 3 / n)));
        dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
}

/** Generate month names */
function genMonths(n: number): string[] {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months.slice(0, Math.min(n, 12));
}

/** Generate year values */
function genYears(n: number, start = 2000): number[] {
    return Array.from({ length: n }, (_, i) => start + i);
}

/** Generate natural-looking date strings like "Jun 12 1998" */
function genNaturalDates(n: number, startYear = 1998): string[] {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dates: string[] = [];
    const start = new Date(startYear, 0, 1);
    for (let i = 0; i < n; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + Math.floor(i * (365 * 5 / n)));
        dates.push(`${monthNames[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')} ${d.getFullYear()}`);
    }
    return dates;
}

/** Generate category names by semantic type */
function genCategories(semanticType: string, n: number): string[] {
    const pools: Record<string, string[]> = {
        Country: ['USA', 'China', 'Japan', 'Germany', 'UK', 'France', 'India', 'Brazil', 'Canada', 'Australia',
            'South Korea', 'Mexico', 'Italy', 'Spain', 'Russia', 'Netherlands', 'Sweden', 'Norway', 'Denmark', 'Finland',
            'Switzerland', 'Belgium', 'Austria', 'Poland', 'Portugal', 'Turkey', 'Argentina', 'Chile', 'Colombia', 'Peru'],
        Company: ['Apple', 'Google', 'Microsoft', 'Amazon', 'Meta', 'Tesla', 'Netflix', 'Adobe', 'Intel', 'Nvidia',
            'Samsung', 'IBM', 'Oracle', 'SAP', 'Salesforce', 'Uber', 'Lyft', 'Spotify', 'Snap', 'Twitter',
            'Palantir', 'Shopify', 'Square', 'Zoom', 'Slack', 'Twilio', 'Datadog', 'Snowflake', 'Confluent', 'MongoDB'],
        Product: ['Laptop', 'Phone', 'Tablet', 'Desktop', 'Monitor', 'Keyboard', 'Mouse', 'Headphones', 'Speaker', 'Camera',
            'TV', 'Router', 'Printer', 'Scanner', 'SSD', 'HDD', 'RAM', 'GPU', 'CPU', 'Motherboard'],
        Category: ['Electronics', 'Clothing', 'Food', 'Books', 'Sports', 'Home', 'Garden', 'Auto', 'Health', 'Beauty',
            'Toys', 'Music', 'Movies', 'Software', 'Games', 'Office', 'Pet', 'Baby', 'Tools', 'Crafts'],
        Department: ['Engineering', 'Sales', 'Marketing', 'HR', 'Finance', 'Legal', 'Operations', 'Support', 'Design', 'Research',
            'QA', 'DevOps', 'Security', 'Analytics', 'Product'],
        Status: ['Active', 'Inactive', 'Pending', 'Completed', 'Failed'],
        Name: ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Hank', 'Ivy', 'Jack',
            'Kate', 'Leo', 'Mona', 'Nick', 'Olivia', 'Pat', 'Quinn', 'Ray', 'Sara', 'Tom',
            'Uma', 'Vic', 'Wendy', 'Xander', 'Yara', 'Zoe', 'Aaron', 'Beth', 'Carl', 'Dana'],
        Director: ['Steven Spielberg', 'James Cameron', 'Chris Columbus', 'George Lucas', 'Peter Jackson',
            'Robert Zemeckis', 'Michael Bay', 'Roland Emmerich', 'Gore Verbinski', 'Tim Burton',
            'Andrew Adamson', 'Sam Raimi', 'Ron Howard', 'Christopher Nolan', 'M. Night Shyamalan',
            'David Yates', 'John Lasseter', 'Carlos Saldanha', 'Andy Wachowski', 'Ridley Scott'],
        MovieTitle: ['The Dark Knight', 'Spider-Man', 'Avatar', 'Titanic', 'Jurassic Park', 'Star Wars',
            'The Matrix', 'Inception', 'Interstellar', 'Gladiator', 'The Avengers', 'Iron Man',
            'Frozen', 'Toy Story', 'Finding Nemo', 'Shrek', 'Cars', 'Up', 'WALL-E', 'Coco',
            'Moana', 'Ratatouille', 'Inside Out', 'Big Hero 6', 'Brave', 'Tangled', 'Zootopia',
            'The Lion King', 'Aladdin', 'Beauty and the Beast'],
    };
    const pool = pools[semanticType] || pools.Category;
    return pool.slice(0, Math.min(n, pool.length));
}

/** Generate n random unique names (first + last) for very large discrete tests */
function genRandomNames(n: number, seed = 777): string[] {
    const firsts = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'William', 'Elizabeth',
        'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Charles', 'Karen',
        'Christopher', 'Lisa', 'Daniel', 'Nancy', 'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra',
        'Steven', 'Ashley', 'Paul', 'Dorothy', 'Andrew', 'Kimberly', 'Joshua', 'Emily', 'Kenneth', 'Donna'];
    const lasts = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
        'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
        'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
        'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores'];
    const rand = seededRandom(seed);
    const names = new Set<string>();
    while (names.size < n) {
        const f = firsts[Math.floor(rand() * firsts.length)];
        const l = lasts[Math.floor(rand() * lasts.length)];
        names.add(`${f} ${l}`);
    }
    return [...names];
}

/** Generate random numeric measure values */
function genMeasure(n: number, min = 10, max = 1000, integers = false): number[] {
    return Array.from({ length: n }, () => {
        const v = min + Math.random() * (max - min);
        return integers ? Math.round(v) : Math.round(v * 100) / 100;
    });
}

/** Seeded random for reproducibility */
function seededRandom(seed: number) {
    return () => {
        seed = (seed * 16807 + 0) % 2147483647;
        return (seed - 1) / 2147483646;
    };
}

// ============================================================================
// Test Case Definition
// ============================================================================

interface TestCase {
    title: string;
    description: string;
    tags: string[];  // e.g., ['temporal', 'large-cardinality', 'color']
    chartType: string;
    data: Record<string, any>[];
    fields: FieldItem[];
    metadata: Record<string, { type: Type; semanticType: string; levels: any[] }>;
    encodingMap: Partial<Record<Channel, EncodingItem>>;
    chartProperties?: Record<string, any>;
    assembleOptions?: AssembleOptions;
}

// ============================================================================
// Test Case Generators per Chart Type
// ============================================================================

function makeField(name: string, tableRef = 'test'): FieldItem {
    return { id: name, name, source: 'original', tableRef };
}

function makeEncodingItem(fieldID: string, opts?: Partial<EncodingItem>): EncodingItem {
    return { fieldID, ...opts };
}

function inferType(values: any[]): Type {
    if (values.length === 0) return Type.String;
    const sample = values.find(v => v != null);
    if (typeof sample === 'number') return Type.Number;
    if (typeof sample === 'boolean') return Type.String;
    if (sample instanceof Date) return Type.Date;
    // Check if string looks like a date
    if (typeof sample === 'string' && !isNaN(Date.parse(sample)) && sample.length > 4) return Type.Date;
    return Type.String;
}

function buildMetadata(data: Record<string, any>[]): Record<string, { type: Type; semanticType: string; levels: any[] }> {
    if (data.length === 0) return {};
    const meta: Record<string, { type: Type; semanticType: string; levels: any[] }> = {};
    for (const key of Object.keys(data[0])) {
        const values = data.map(r => r[key]).filter(v => v != null);
        const type = inferType(values);
        const levels = [...new Set(values)];
        // Assign semantic types heuristically
        let semanticType = '';
        if (type === Type.Date) semanticType = 'Date';
        else if (type === Type.Number) semanticType = 'Quantity';
        else semanticType = 'Category';
        meta[key] = { type, semanticType, levels };
    }
    return meta;
}

// ------ Scatter Plot ------
function genScatterTests(): TestCase[] {
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

    // 5. Dense scatter — coverage-based point sizing (200 points, should have some shrinkage)
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

    // 6. Very dense scatter — 2000 points, should shrink significantly
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
    // Vary cardinality to help decide the max size cap

    // 9. Bubble — 5 points (very sparse, max size should be generous)
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

    // 14. Bubble — ordinal size (few ordered levels)
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

    // 15. Bubble — size with large numeric range (e.g. population 1K to 1B)
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

    // 16. Bubble — size with narrow numeric range (e.g. 90-100)
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
function genLinearRegressionTests(): TestCase[] {
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

// ------ Bar Chart ------
function genBarTests(): TestCase[] {
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

    // 4. Temporal x, quant y (should keep temporal, not convert)
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

    // 5. Natural date format (e.g., "Jun 12 1998") — tests Date.parse detection
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

    // 6. Year (ordinal-like temporal) x, quant y
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

    // 7. Two quantitative axes (tests applyDynamicMarkResizing case 2)
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

    // 8. Nominal x + color (many colors — tests color scheme)
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

    // 9. Swap axis: Quant x, Nominal y (horizontal bar)
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

    // 10. Swap axis: Quant x, Temporal y (horizontal temporal bar)
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

    // 11. Very large discrete (100 random names — tests cutoff)
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

    // 12. Very large discrete, swap axis (horizontal, 100 names)
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

    // 13. Large temporal x (100 dates — tests temporal bar sizing at scale)
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

    // 14. Large temporal x + color (100 dates × 3 categories)
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
function genStackedBarTests(): TestCase[] {
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

    // 5. Quant × Quant + Color (two quantitative axes)
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

    // 6. Swap axis: Quant x, Nominal y + Color (horizontal stacked)
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

    // 7. Swap axis: Quant x, Temporal y + Color (horizontal temporal stack)
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

    // 8. Very large discrete + color (80 random names — tests cutoff)
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

    // 9. Numeric color, small cardinality (4 unique values)
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

    // 10. Numeric color, large cardinality (30 unique values)
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
function genGroupedBarTests(): TestCase[] {
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

    // 2. Two quantitative axes (ensureNominalAxis test)
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

    // 3. No color field (falls back to simple bar)
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

    // 4. Temporal x + color (grouped)
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

    // 5. Quant × Quant + Color (grouped, two quantitative axes)
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

    // 6. Swap axis: Quant x, Nominal y + Color (horizontal grouped)
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

    // 7. Swap axis: Quant x, Temporal y + Color (horizontal temporal grouped)
    {
        const dates = genDates(10, 2022);
        const channels = ['Email', 'SMS', 'Push'];
        const data: any[] = [];
        for (const d of dates) for (const c of channels) {
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
                Channel: { type: Type.String, semanticType: 'Category', levels: channels },
            },
            encodingMap: { x: makeEncodingItem('Sent'), y: makeEncodingItem('Date'), color: makeEncodingItem('Channel') },
        });
    }

    // 8. Very large discrete + color (90 random names — tests cutoff)
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

    // 9. Numeric color, small cardinality (5 unique values)
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

    // 10. Numeric color, large cardinality (50 unique values)
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

    // 11. Continuous numeric color (float values, all unique)
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

// ------ Histogram ------
function genHistogramTests(): TestCase[] {
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

// ------ Heatmap ------
function genHeatmapTests(): TestCase[] {
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

    return tests;
}

// ------ Line Chart ------
function genLineTests(): TestCase[] {
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
function genDottedLineTests(): TestCase[] {
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

// ------ Boxplot ------
function genBoxplotTests(): TestCase[] {
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
                Revenue: { type: Type.Number, semanticType: 'Revenue', levels: [] },
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

// ------ Pie Chart ------
function genPieTests(): TestCase[] {
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
            encodingMap: { theta: makeEncodingItem('Value'), color: makeEncodingItem('Category') },
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
            encodingMap: { theta: makeEncodingItem('Revenue'), color: makeEncodingItem('Product') },
        });
    }

    return tests;
}

// ------ Ranged Dot Plot ------
function genRangedDotPlotTests(): TestCase[] {
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

// ------ Custom Charts (Point, Line, Bar, Rect, Area) ------
function genCustomTests(): TestCase[] {
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

// ------ Area Chart ------
function genAreaTests(): TestCase[] {
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
function genStreamgraphTests(): TestCase[] {
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

// ------ Lollipop Chart ------
function genLollipopTests(): TestCase[] {
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

// ------ Density Plot ------
function genDensityTests(): TestCase[] {
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

// ============================================================================
// Waterfall Chart Test Generators
// ============================================================================

function genWaterfallTests(): TestCase[] {
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

// ============================================================================
// Candlestick Test Generators
// ============================================================================

function genCandlestickTests(): TestCase[] {
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

// ============================================================================
// Facet Test Generators
// ============================================================================

/** Facet cardinality sizes */
const FACET_SIZES = { S: 2, M: 4, L: 8, XL: 12 } as const;
/** Discrete axis cardinality sizes */
const DISCRETE_SIZES = { S: 4, M: 8, L: 20, XL: 50 } as const;

/**
 * Generate facet test cases for a given facet mode (column, row, or column+row).
 * For each combination of facetSize × axisType:
 *   - Continuous × Continuous (scatter in each facet)
 *   - Continuous × Discrete-S/M/L/XL (bar in each facet)
 */
function genFacetTests(
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

function genFacetColumnTests(): TestCase[] { return genFacetTests('column'); }
function genFacetRowTests(): TestCase[] { return genFacetTests('row'); }
function genFacetColRowTests(): TestCase[] { return genFacetTests('column+row'); }

// ------ Overflow / Discrete Value Capping ------
function genOverflowTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(777);

    // Helper: generate N category names
    const cats = (prefix: string, n: number) => {
        const pad = String(n).length;
        return Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(pad, '0')}`);
    };

    // ---- 1. Bar chart: increasing x cardinality ----
    for (const n of [50, 100, 150, 200]) {
        const categories = cats('Cat', n);
        const data = categories.map(c => ({ Category: c, Sales: Math.round(10 + rand() * 500) }));
        tests.push({
            title: `Bar — ${n} x-categories`,
            description: `Bar chart with ${n} discrete x values to test capping`,
            tags: ['overflow', 'bar', `n-${n}`],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Category'), makeField('Sales')],
            metadata: buildMetadata(data),
            encodingMap: { x: makeEncodingItem('Category'), y: makeEncodingItem('Sales') },
        });
    }

    // ---- 2. Horizontal bar: increasing y cardinality ----
    for (const n of [50, 100, 200]) {
        const categories = cats('Item', n);
        const data = categories.map(c => ({ Item: c, Revenue: Math.round(10 + rand() * 800) }));
        tests.push({
            title: `Horiz Bar — ${n} y-categories`,
            description: `Horizontal bar chart with ${n} discrete y values`,
            tags: ['overflow', 'bar', 'horizontal', `n-${n}`],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Item'), makeField('Revenue')],
            metadata: buildMetadata(data),
            encodingMap: { y: makeEncodingItem('Item'), x: makeEncodingItem('Revenue') },
        });
    }

    // ---- 3. Grouped bar: x × color overflow ----
    for (const [xN, colorN] of [[30, 5], [50, 5], [80, 3], [50, 10]] as const) {
        const xCats = cats('Product', xN);
        const colors = cats('Region', colorN);
        const data: any[] = [];
        for (const x of xCats) {
            for (const c of colors) {
                data.push({ Product: x, Region: c, Sales: Math.round(10 + rand() * 400) });
            }
        }
        tests.push({
            title: `Grouped — ${xN}x × ${colorN}color`,
            description: `Grouped bar: ${xN} x-values × ${colorN} color groups = ${xN * colorN} sub-bars`,
            tags: ['overflow', 'grouped', `x-${xN}`, `color-${colorN}`],
            chartType: 'Grouped Bar Chart',
            data,
            fields: [makeField('Product'), makeField('Region'), makeField('Sales')],
            metadata: buildMetadata(data),
            encodingMap: {
                x: makeEncodingItem('Product'),
                y: makeEncodingItem('Sales'),
                color: makeEncodingItem('Region'),
            },
        });
    }

    // ---- 4. Stacked bar: many x values ----
    for (const n of [50, 150]) {
        const xCats = cats('City', n);
        const segments = cats('Seg', 3);
        const data: any[] = [];
        for (const x of xCats) {
            for (const s of segments) {
                data.push({ City: x, Segment: s, Amount: Math.round(10 + rand() * 300) });
            }
        }
        tests.push({
            title: `Stacked — ${n} x-categories`,
            description: `Stacked bar with ${n} x values and 3 segments`,
            tags: ['overflow', 'stacked', `n-${n}`],
            chartType: 'Stacked Bar Chart',
            data,
            fields: [makeField('City'), makeField('Segment'), makeField('Amount')],
            metadata: buildMetadata(data),
            encodingMap: {
                x: makeEncodingItem('City'),
                y: makeEncodingItem('Amount'),
                color: makeEncodingItem('Segment'),
            },
        });
    }

    // ---- 5. Heatmap: large x × large y ----
    for (const [xN, yN] of [[30, 30], [80, 20], [50, 50]] as const) {
        const xCats = cats('Col', xN);
        const yCats = cats('Row', yN);
        const data: any[] = [];
        for (const x of xCats) {
            for (const y of yCats) {
                data.push({ Col: x, Row: y, Value: Math.round(rand() * 100) });
            }
        }
        tests.push({
            title: `Heatmap — ${xN}x × ${yN}y`,
            description: `Heatmap with ${xN}×${yN} = ${xN * yN} cells`,
            tags: ['overflow', 'heatmap', `x-${xN}`, `y-${yN}`],
            chartType: 'Heatmap',
            data,
            fields: [makeField('Col'), makeField('Row'), makeField('Value')],
            metadata: buildMetadata(data),
            encodingMap: {
                x: makeEncodingItem('Col'),
                y: makeEncodingItem('Row'),
                color: makeEncodingItem('Value'),
            },
        });
    }

    // ---- 6. Large color cardinality (numeric on color) ----
    {
        const countries = cats('Country', 5);
        const data: any[] = [];
        for (const c of countries) {
            for (let age = 15; age <= 85; age++) {
                data.push({ Country: c, Age: age, Count: Math.round(50 + rand() * 200) });
            }
        }
        tests.push({
            title: `Color overflow — 71 numeric values`,
            description: `Age 15-85 on color channel (71 unique values)`,
            tags: ['overflow', 'color', 'numeric-color'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Country'), makeField('Age'), makeField('Count')],
            metadata: buildMetadata(data),
            encodingMap: {
                x: makeEncodingItem('Country'),
                y: makeEncodingItem('Count'),
                color: makeEncodingItem('Age'),
            },
        });
    }

    // ---- 7. Boxplot with many categories ----
    for (const n of [50, 120]) {
        const categories = cats('Group', n);
        const data: any[] = [];
        for (const c of categories) {
            for (let i = 0; i < 10; i++) {
                data.push({ Group: c, Score: Math.round(rand() * 100) });
            }
        }
        tests.push({
            title: `Boxplot — ${n} groups`,
            description: `Boxplot with ${n} discrete groups on x-axis`,
            tags: ['overflow', 'boxplot', `n-${n}`],
            chartType: 'Boxplot',
            data,
            fields: [makeField('Group'), makeField('Score')],
            metadata: buildMetadata(data),
            encodingMap: { x: makeEncodingItem('Group'), y: makeEncodingItem('Score') },
        });
    }

    // ---- 8. Faceted + overflow within subplots ----
    {
        const regions = cats('Region', 4);
        const products = cats('Prod', 80);
        const data: any[] = [];
        for (const r of regions) {
            for (const p of products) {
                data.push({ Region: r, Product: p, Sales: Math.round(10 + rand() * 500) });
            }
        }
        tests.push({
            title: `Facet + 80 x-categories`,
            description: `4 column facets each with 80 x-categories`,
            tags: ['overflow', 'facet', 'n-80'],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Region'), makeField('Product'), makeField('Sales')],
            metadata: buildMetadata(data),
            encodingMap: {
                column: makeEncodingItem('Region'),
                x: makeEncodingItem('Product'),
                y: makeEncodingItem('Sales'),
            },
        });
    }

    // ---- 9. Many facet columns with small discrete x ----
    for (const [facetN, xN] of [[8, 3], [12, 4], [15, 2], [20, 3]] as const) {
        const facets = cats('Panel', facetN);
        const xCats = cats('Type', xN);
        const data: any[] = [];
        for (const f of facets) {
            for (const x of xCats) {
                data.push({ Panel: f, Type: x, Value: Math.round(10 + rand() * 300) });
            }
        }
        tests.push({
            title: `${facetN} facets × ${xN} x-bars`,
            description: `${facetN} column facets, each with only ${xN} x-categories — thin subplots`,
            tags: ['overflow', 'facet', 'thin', `facet-${facetN}`, `x-${xN}`],
            chartType: 'Bar Chart',
            data,
            fields: [makeField('Panel'), makeField('Type'), makeField('Value')],
            metadata: buildMetadata(data),
            encodingMap: {
                column: makeEncodingItem('Panel'),
                x: makeEncodingItem('Type'),
                y: makeEncodingItem('Value'),
            },
        });
    }

    return tests;
}

// ------ Elasticity & Stretch Comparison ------
function genElasticityTests(): TestCase[] {
    const tests: TestCase[] = [];
    const rand = seededRandom(999);

    // ========== Helper to build a bar-chart test case with given layout ==========
    function makeBarTest(
        title: string,
        description: string,
        tags: string[],
        xCategories: string[],
        assembleOptions: AssembleOptions,
        facetCategories?: string[],
    ): TestCase {
        const data: Record<string, any>[] = [];
        if (facetCategories) {
            for (const f of facetCategories) {
                for (const x of xCategories) {
                    data.push({ Panel: f, Category: x, Value: Math.round(10 + rand() * 500) });
                }
            }
        } else {
            for (const x of xCategories) {
                data.push({ Category: x, Value: Math.round(10 + rand() * 500) });
            }
        }

        const fields = facetCategories
            ? [makeField('Panel'), makeField('Category'), makeField('Value')]
            : [makeField('Category'), makeField('Value')];

        const encodingMap: Partial<Record<Channel, EncodingItem>> = {
            x: makeEncodingItem('Category'),
            y: makeEncodingItem('Value'),
        };
        if (facetCategories) {
            encodingMap.column = makeEncodingItem('Panel');
        }

        return {
            title,
            description,
            tags,
            chartType: 'Bar Chart',
            data,
            fields,
            metadata: buildMetadata(data),
            encodingMap,
            assembleOptions,
        };
    }

    // =========================================================================
    // Group A: Axis-only (no facets) — compare elasticity / maxStretch
    // =========================================================================
    const mediumCategories = genCategories('Country', 15);
    const largeCategories = genCategories('Name', 30);

    // A1: 15 x-categories — default
    tests.push(makeBarTest(
        '15 bars — default (e=0.5, s=2)',
        '15 x-categories, default axis elasticity & stretch',
        ['axis-only', 'medium', 'default'],
        mediumCategories,
        { elasticity: 0.5, maxStretch: 2 },
    ));

    // A2: 15 x-categories — low elasticity
    tests.push(makeBarTest(
        '15 bars — low axis (e=0.2, s=1.2)',
        '15 x-categories, conservative axis stretch',
        ['axis-only', 'medium', 'low'],
        mediumCategories,
        { elasticity: 0.2, maxStretch: 1.2 },
    ));

    // A3: 15 x-categories — high elasticity
    tests.push(makeBarTest(
        '15 bars — high axis (e=0.8, s=3)',
        '15 x-categories, aggressive axis stretch',
        ['axis-only', 'medium', 'high'],
        mediumCategories,
        { elasticity: 0.8, maxStretch: 3 },
    ));

    // A4: 30 x-categories — default
    tests.push(makeBarTest(
        '30 bars — default (e=0.5, s=2)',
        '30 x-categories, default axis elasticity & stretch',
        ['axis-only', 'large', 'default'],
        largeCategories,
        { elasticity: 0.5, maxStretch: 2 },
    ));

    // A5: 30 x-categories — low
    tests.push(makeBarTest(
        '30 bars — low axis (e=0.2, s=1.2)',
        '30 x-categories, conservative axis stretch',
        ['axis-only', 'large', 'low'],
        largeCategories,
        { elasticity: 0.2, maxStretch: 1.2 },
    ));

    // A6: 30 x-categories — high
    tests.push(makeBarTest(
        '30 bars — high axis (e=0.8, s=3)',
        '30 x-categories, aggressive axis stretch',
        ['axis-only', 'large', 'high'],
        largeCategories,
        { elasticity: 0.8, maxStretch: 3 },
    ));

    // =========================================================================
    // Group B: Facet + axis — compare facet vs axis params independently
    // =========================================================================
    const facets8 = genCategories('Department', 8);
    const bars5 = genCategories('Category', 5);
    const facets12 = genCategories('Company', 12);
    const bars8 = genCategories('Category', 8);

    // B1: 8 facets × 5 bars — all defaults
    tests.push(makeBarTest(
        '8F × 5B — all default',
        '8 column facets, 5 bars each, default axis & facet settings',
        ['facet+axis', 'default'],
        bars5,
        { elasticity: 0.5, maxStretch: 2, facetElasticity: 0.3, facetMaxStretch: 1.5 },
        facets8,
    ));

    // B2: 8 facets × 5 bars — conservative facet, default axis
    tests.push(makeBarTest(
        '8F × 5B — conservative facet (fe=0.15, fs=1.2)',
        '8 column facets, 5 bars, conservative facet stretch, default axis',
        ['facet+axis', 'conservative-facet'],
        bars5,
        { elasticity: 0.5, maxStretch: 2, facetElasticity: 0.15, facetMaxStretch: 1.2 },
        facets8,
    ));

    // B3: 8 facets × 5 bars — aggressive facet, default axis
    tests.push(makeBarTest(
        '8F × 5B — aggressive facet (fe=0.6, fs=2.5)',
        '8 column facets, 5 bars, aggressive facet stretch, default axis',
        ['facet+axis', 'aggressive-facet'],
        bars5,
        { elasticity: 0.5, maxStretch: 2, facetElasticity: 0.6, facetMaxStretch: 2.5 },
        facets8,
    ));

    // B4: 12 facets × 8 bars — all defaults
    tests.push(makeBarTest(
        '12F × 8B — all default',
        '12 column facets, 8 bars each, default settings',
        ['facet+axis', 'large', 'default'],
        bars8,
        { elasticity: 0.5, maxStretch: 2, facetElasticity: 0.3, facetMaxStretch: 1.5 },
        facets12,
    ));

    // B5: 12 facets × 8 bars — conservative facet, aggressive axis
    tests.push(makeBarTest(
        '12F × 8B — tight facet (fe=0.15, fs=1.2), wide axis (e=0.8, s=3)',
        '12 facets, 8 bars, conservative facet + aggressive axis',
        ['facet+axis', 'large', 'mixed-tight-facet'],
        bars8,
        { elasticity: 0.8, maxStretch: 3, facetElasticity: 0.15, facetMaxStretch: 1.2 },
        facets12,
    ));

    // B6: 12 facets × 8 bars — aggressive facet, conservative axis
    tests.push(makeBarTest(
        '12F × 8B — wide facet (fe=0.6, fs=2.5), tight axis (e=0.2, s=1.2)',
        '12 facets, 8 bars, aggressive facet + conservative axis',
        ['facet+axis', 'large', 'mixed-wide-facet'],
        bars8,
        { elasticity: 0.2, maxStretch: 1.2, facetElasticity: 0.6, facetMaxStretch: 2.5 },
        facets12,
    ));

    // B7: 8 facets × 5 bars — no stretch at all
    tests.push(makeBarTest(
        '8F × 5B — no stretch (all 1.0)',
        '8 column facets, 5 bars, stretch disabled',
        ['facet+axis', 'no-stretch'],
        bars5,
        { elasticity: 0, maxStretch: 1, facetElasticity: 0, facetMaxStretch: 1 },
        facets8,
    ));

    return tests;
}

// ------ Strip Plot (Jitter) ------
function genStripPlotTests(): TestCase[] {
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

// ------ Radar Chart ------
function genRadarTests(): TestCase[] {
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

// ============================================================================
// All test generators mapped by chart group
// ============================================================================

const TEST_GENERATORS: Record<string, () => TestCase[]> = {
    'Scatter Plot': genScatterTests,
    'Linear Regression': genLinearRegressionTests,
    'Bar Chart': genBarTests,
    'Stacked Bar Chart': genStackedBarTests,
    'Grouped Bar Chart': genGroupedBarTests,
    'Histogram': genHistogramTests,
    'Heatmap': genHeatmapTests,
    'Line Chart': genLineTests,
    'Dotted Line Chart': genDottedLineTests,
    'Boxplot': genBoxplotTests,
    'Pie Chart': genPieTests,
    'Ranged Dot Plot': genRangedDotPlotTests,
    'Area Chart': genAreaTests,
    'Streamgraph': genStreamgraphTests,
    'Lollipop Chart': genLollipopTests,
    'Density Plot': genDensityTests,
    'Candlestick Chart': genCandlestickTests,
    'Waterfall Chart': genWaterfallTests,
    'Strip Plot': genStripPlotTests,
    'Radar Chart': genRadarTests,
    'Custom Charts': genCustomTests,
    'Facet: Columns': genFacetColumnTests,
    'Facet: Rows': genFacetRowTests,
    'Facet: Cols+Rows': genFacetColRowTests,
    'Overflow': genOverflowTests,
    'Elasticity & Stretch': genElasticityTests,
};

// ============================================================================
// Chart Rendering Component
// ============================================================================

const VegaChart: React.FC<{ testCase: TestCase }> = React.memo(({ testCase }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [error, setError] = useState<string | null>(null);
    const [specJson, setSpecJson] = useState<string>('');

    useEffect(() => {
        if (!containerRef.current) return;

        try {
            // Build encoding map with all channels defaulting to empty
            const fullEncodingMap: Record<string, EncodingItem> = {};
            for (const ch of channels) {
                fullEncodingMap[ch as string] = testCase.encodingMap[ch as Channel] || {};
            }

            const vlSpec = assembleVegaChart(
                testCase.chartType,
                fullEncodingMap as any,
                testCase.fields,
                testCase.data,
                testCase.metadata,
                400,   // baseChartWidth
                300,   // baseChartHeight
                true,  // addTooltips
                testCase.chartProperties,
                1,     // scaleFactor
                testCase.assembleOptions,
            );

            if (!vlSpec) {
                setError('assembleVegaChart returned no spec');
                return;
            }

            setSpecJson(JSON.stringify(vlSpec, null, 2));

            const spec = {
                ...vlSpec as any,
            } as any;

            // Don't set explicit width/height — let config.view.step handle
            // discrete axes (step × count) and config.view.continuousWidth/Height
            // handle continuous axes.  Forcing width/height here overrides step sizing.

            embed(containerRef.current, spec, {
                actions: { export: true, source: true, compiled: true, editor: true },
                renderer: 'svg',
            }).catch(err => {
                setError(`Vega embed error: ${err.message}`);
            });
        } catch (err: any) {
            setError(`Assembly error: ${err.message}`);
        }
    }, [testCase]);

    return (
        <Paper
            elevation={1}
            sx={{
                p: 2, mb: 2, width: 'fit-content', minWidth: 400, maxWidth: '100%',
                border: error ? '2px solid #f44336' : '1px solid #e0e0e0',
            }}
        >
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                {testCase.title}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                {testCase.description}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                {testCase.tags.map(tag => (
                    <Chip key={tag} label={tag} size="small" variant="outlined"
                        sx={{ fontSize: 10, height: 20 }} />
                ))}
            </Box>
            {error ? (
                <Typography color="error" variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>
                    {error}
                </Typography>
            ) : (
                <Box ref={containerRef} sx={{ minHeight: 200 }} />
            )}
            {specJson && (
                <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 11, color: '#888' }}>
                        Vega-Lite Spec
                    </summary>
                    <pre style={{ fontSize: 10, maxHeight: 300, overflow: 'auto', background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
                        {specJson}
                    </pre>
                </details>
            )}
        </Paper>
    );
});

// ============================================================================
// Sub-page for a single chart type
// ============================================================================

const ChartTypeTestPanel: React.FC<{ chartGroup: string }> = ({ chartGroup }) => {
    const tests = useMemo(() => {
        const gen = TEST_GENERATORS[chartGroup];
        return gen ? gen() : [];
    }, [chartGroup]);

    if (tests.length === 0) {
        return (
            <Box sx={{ p: 4, textAlign: 'center' }}>
                <Typography color="text.secondary">No test cases defined for "{chartGroup}"</Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ p: 2, display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'flex-start' }}>
            {tests.map((tc, i) => (
                <VegaChart key={`${chartGroup}-${i}`} testCase={tc} />
            ))}
        </Box>
    );
};

// ============================================================================
// Main Page
// ============================================================================

const ChartTestPage: React.FC = () => {
    const chartGroups = Object.keys(TEST_GENERATORS);
    const [activeTab, setActiveTab] = useState(0);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
            <Box sx={{ px: 3, pt: 2, pb: 1 }}>
                <Typography variant="h5" fontWeight={600}>
                    Chart Assembly Test Page
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={1}>
                    Exhaustive visual tests for Vega-Lite chart assembly, encoding type conversion, dynamic sizing, and color schemes.
                </Typography>
            </Box>

            <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
                <Tabs
                    value={activeTab}
                    onChange={(_, v) => setActiveTab(v)}
                    variant="standard"
                    sx={{
                        minHeight: 36,
                        flexWrap: 'wrap',
                        '& .MuiTabs-flexContainer': { flexWrap: 'wrap' },
                        '& .MuiTab-root': { minHeight: 36, py: 0.5, textTransform: 'none', fontSize: 13 },
                        '& .MuiTabs-indicator': { display: 'none' },
                        '& .Mui-selected': { backgroundColor: 'rgba(0,0,0,0.08)', borderRadius: 1 },
                    }}
                >
                    {chartGroups.map((g, i) => (
                        <Tab key={g} label={g} value={i} />
                    ))}
                </Tabs>
            </Box>

            <Box sx={{ flex: 1, overflow: 'auto', bgcolor: '#fafafa' }}>
                <ChartTypeTestPanel chartGroup={chartGroups[activeTab]} />
            </Box>
        </Box>
    );
};

export default ChartTestPage;
