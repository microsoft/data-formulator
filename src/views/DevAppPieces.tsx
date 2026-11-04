// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** The app pieces on /dev: every @df/chart component in a real sandboxed app, and the canvas while an app is written. */

import React, { useEffect, useState } from 'react';
import { Box, ToggleButton, ToggleButtonGroup } from '@mui/material';

import { ReactAppPreview } from './ReactAppPreview';
import { ArtifactDraftView } from './ArtifactDraft';
import { maskAppCode } from '../app/appDraft';
import type { Density } from '../app/reactApp/runtime/density';

const GALLERY_CODE = `import { useState } from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';
import {
  AppHeader, BarList, DataTable, DateRange, FilterBar, FlintChart, FocusChips, NumberRange, Search, Segmented,
  Sparkline, TargetBar, ValueChips, ValueSelect,
} from '@df/chart';

const REGIONS = ['North', 'South', 'East', 'West'];
const CATEGORIES = ['Furniture', 'Office', 'Technology'];
const COUNTRIES = ['Brazil', 'Canada', 'China', 'Egypt', 'France', 'Germany', 'India', 'Japan', 'Kenya', 'Mexico', 'Spain'];
const sales = [];
for (let m = 0; m < 24; m++) {
  const month = (2023 + Math.floor(m / 12)) + '-' + String((m % 12) + 1).padStart(2, '0');
  REGIONS.forEach((region, r) => CATEGORIES.forEach((category, c) => {
    const revenue = Math.round((40 + r * 9 + c * 14 + m * (1.2 + c * 0.6) + Math.sin(m / 1.7 + r) * 7) * 1000);
    sales.push({ month, region, category, revenue, profit: Math.round(revenue * (0.08 + c * 0.05 - r * 0.01)) });
  }));
}
const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0);
const months = [...new Set(sales.map(row => row.month))];
const byRegion = REGIONS.map(region => ({ region, revenue: sum(sales.filter(row => row.region === region), 'revenue') }));
const byMonth = months.map(month => ({ month, revenue: sum(sales.filter(row => row.month === month), 'revenue') }));

function Piece({ name, width, children }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, width, maxWidth: '100%', boxSizing: 'border-box' }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, fontFamily: 'monospace' }}>{name}</Typography>
      {children}
    </Paper>
  );
}

export default function App() {
  const [region, setRegion] = useState('');
  const [few, setFew] = useState(['Office']);
  const [many, setMany] = useState(['Japan', 'Kenya']);
  const [measure, setMeasure] = useState('revenue');
  const [text, setText] = useState('');
  const [period, setPeriod] = useState(null);
  const [years, setYears] = useState(null);
  const [range, setRange] = useState(null);
  const [focus, setFocus] = useState({ region: { in: ['West'] }, revenue: { range: [20000, 90000] } });
  const [barFocus, setBarFocus] = useState(null);
  const [chartFocus, setChartFocus] = useState(null);
  return (
    <Box sx={{ p: 2, display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-start' }}>
      <Piece name="AppHeader" width={720}>
        <AppHeader kicker="Sales" title="West led a year of growth" deck="Revenue by region and category, USD."
          period={[months[0], months[months.length - 1]]} source="illustrative sales data"
          where={{ region, category: few }} labels={{ region: 'Region', category: 'Category' }} />
      </Piece>
      <Piece name="ValueSelect" width={220}>
        <ValueSelect label="Region" options={REGIONS} allLabel="All regions" value={region} onChange={setRegion} />
      </Piece>
      <Piece name="Segmented" width={300}>
        <Segmented label="Measure" options={[{ value: 'revenue', label: 'Revenue' }, { value: 'profit', label: 'Profit' }, { value: 'orders', label: 'Orders' }]}
          value={measure} onChange={setMeasure} />
      </Piece>
      <Piece name="ValueChips" width={320}>
        <ValueChips label="Category" options={CATEGORIES} value={few} onChange={setFew} />
      </Piece>
      <Piece name="ValueChips · many" width={300}>
        <ValueChips label="Country" options={COUNTRIES} value={many} onChange={setMany} />
      </Piece>
      <Piece name="Search" width={220}>
        <Search label="Product" value={text} onChange={setText} />
      </Piece>
      <Piece name="FilterBar" width={760}>
        <FilterBar>
          <ValueSelect label="Region" options={REGIONS} value={region} onChange={setRegion} />
          <ValueChips label="Category" options={CATEGORIES} value={few} onChange={setFew} />
          <NumberRange label="Order revenue" min={0} max={130000} format="compact" value={range} onChange={setRange} width={200} />
        </FilterBar>
      </Piece>
      <Piece name="NumberRange" width={260}>
        <NumberRange label="Order revenue" min={0} max={130000} format="compact" value={range} onChange={setRange} />
      </Piece>
      <Piece name="DateRange" width={300}>
        <DateRange min={months[0]} max={months[months.length - 1]} value={period} onChange={setPeriod} />
      </Piece>
      <Piece name="DateRange · year" width={260}>
        <DateRange label="Years" min={2015} max={2024} granularity="year" value={years} onChange={setYears} />
      </Piece>
      <Piece name="FlintChart" width={440}>
        <FlintChart chartType="Bar Chart" data={byRegion} encodings={{ x: 'region', y: 'revenue' }} height={240}
          select focus={chartFocus} onFocus={setChartFocus} />
      </Piece>
      <Piece name="BarList" width={300}>
        <BarList data={byRegion} label="region" value="revenue" format="compact" focus={barFocus} onFocus={setBarFocus} />
      </Piece>
      <Piece name="TargetBar" width={260}>
        <Stack spacing={1.5}>
          <TargetBar value={16.2e6} target={15e6} />
          <TargetBar value={14.3e6} target={15e6} />
          <TargetBar value={4.1} target={3.5} label="3.5 days" goodDirection="down" />
        </Stack>
      </Piece>
      <Piece name="Sparkline" width={220}>
        <Sparkline data={byMonth} x="month" y="revenue" height={48} />
      </Piece>
      <Piece name="FocusChips" width={320}>
        <FocusChips focus={focus} onChange={setFocus} labels={{ revenue: 'Revenue' }} />
      </Piece>
      <Piece name="DataTable" width={560}>
        <DataTable
          data={sales.filter(row => row.month === '2024-12')}
          groupBy="region"
          maxHeight={240}
          columns={[
            { field: 'region', label: 'Region' },
            { field: 'category', label: 'Category' },
            { field: 'revenue', label: 'Revenue', format: 'compact', bar: true, total: 'sum' },
            { field: 'profit', label: 'Profit', format: 'compact', heat: true, total: 'sum' },
          ]}
        />
      </Piece>
    </Box>
  );
}
`;

const GALLERY = `// @df-app {"version": 2, "title": "Components", "tables": []}\n${GALLERY_CODE}`;

const toggleSx = { textTransform: 'none', py: 0.25, fontSize: 11 } as const;

/** Every @df/chart component, scattered, with plain MUI defaults (no AppTheme). */
export function AppComponentsGallery() {
    const [density, setDensity] = useState<Density>('compact');
    return <Box sx={{ width: '100%' }}>
        <ToggleButtonGroup size="small" exclusive value={density} aria-label="Density" sx={{ mb: 1 }}
            onChange={(_event, next) => next && setDensity(next)}>
            <ToggleButton value="compact" sx={toggleSx}>compact</ToggleButton>
            <ToggleButton value="normal" sx={toggleSx}>normal</ToggleButton>
        </ToggleButtonGroup>
        <Box data-app-frame sx={{ height: 1060, position: 'relative', border: 1, borderColor: 'divider', overflow: 'hidden', bgcolor: 'background.paper' }}>
            <ReactAppPreview source={GALLERY} title="Components" density={density} />
        </Box>
    </Box>;
}

/** The canvas while the agent writes an app (its code going by, masked) or a map, replaying the gallery's code. */
export function AppDraftDemo() {
    const [tool, setTool] = useState<'write_app' | 'write_map'>('write_app');
    const [written, setWritten] = useState(0);
    const [startedAt, setStartedAt] = useState(() => Date.now());
    const charsPerSecond = 400;
    useEffect(() => {
        let start = Date.now();
        setWritten(0);
        setStartedAt(start);
        const timer = setInterval(() => {
            const chars = Math.round((Date.now() - start) * charsPerSecond / 1000);
            if (chars >= GALLERY_CODE.length + charsPerSecond * 1.5) {
                start = Date.now();
                setStartedAt(start);
                setWritten(0);
            } else {
                setWritten(chars);
            }
        }, 120);
        return () => clearInterval(timer);
    }, [tool]);
    const { lines, lineCount } = maskAppCode(GALLERY_CODE.slice(0, written));
    return <Box sx={{ border: 1, borderColor: 'divider' }}>
        <ToggleButtonGroup size="small" exclusive value={tool} aria-label="Artifact" sx={{ m: 1 }}
            onChange={(_event, next) => next && setTool(next)}>
            <ToggleButton value="write_app" sx={toggleSx}>write_app</ToggleButton>
            <ToggleButton value="write_map" sx={toggleSx}>write_map</ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ width: 560, height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ArtifactDraftView key={tool} tool={tool} title="Sales explorer"
                lines={tool === 'write_map' ? [] : lines} lineCount={lineCount} startedAt={startedAt} />
        </Box>
    </Box>;
}
