// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Gallery navigation tree — three-layer structure: Section > Category > Page.
 *
 * Consumed by `ChartGallery.tsx` via a persistent sidebar. Each `GalleryPage`
 * declares how it should render (single / dual / triple / quad / static / table),
 * removing the string-prefix sniffing that the old `GALLERY_SECTIONS` required.
 *
 * `TEST_GENERATORS` (same file as `GALLERY_SECTIONS`) is still the single
 * source of chart data — pages reference it by key.
 */

import { OMNI_VIZ_GALLERY_DATA_TABLE_ENTRY, GALLERY_OMNI_VIZ_GENERATOR_KEYS } from './omni-viz-tests';

/** How a page's chart cards should be rendered. */
export type GalleryPageRender =
    | 'single'   // one library (decided by section, e.g. VL or EC)
    | 'dual'     // VL + EC side-by-side
    | 'triple'   // VL + EC + CJS
    | 'quad'     // VL + EC + CJS + GoFish
    | 'table'    // Omni Game dataset preview (not a chart page)
    | 'static';  // React component rendered by id (overview pages)

/** Which single-library renderer to use when `render: 'single'`. */
export type SingleRenderLibrary = 'vegalite' | 'echarts' | 'chartjs' | 'gofish';

/** A leaf page in the navigation tree. */
export interface GalleryPage {
    id: string;                          // stable slug — used in URL hash and as React key
    label: string;
    description?: string;
    render: GalleryPageRender;
    /** Keys into TEST_GENERATORS; order is preserved when rendering. */
    generatorKeys: string[];
    /** Only meaningful when `render === 'single'`. */
    library?: SingleRenderLibrary;
    /** Only meaningful when `render === 'static'` — resolves to a React component. */
    staticPageId?: string;
}

/** A category groups pages under a section (e.g. Chart Types, Features, Overview). */
export interface GalleryCategory {
    id: string;
    label: string;
    description?: string;
    pages: GalleryPage[];
}

/** A top-level section in the sidebar. */
export interface GallerySection {
    id: string;
    label: string;
    description?: string;
    categories: GalleryCategory[];
}

// ---------------------------------------------------------------------------
// VegaLite
// ---------------------------------------------------------------------------

const VEGALITE_CHART_TYPES: GalleryPage[] = [
    { id: 'scatter-plot',       label: 'Scatter Plot',       generatorKeys: ['Scatter Plot'] },
    { id: 'regression',         label: 'Regression',         generatorKeys: ['Regression'] },
    { id: 'bar-chart',          label: 'Bar Chart',          generatorKeys: ['Bar Chart'] },
    { id: 'stacked-bar',        label: 'Stacked Bar Chart',  generatorKeys: ['Stacked Bar Chart'] },
    { id: 'grouped-bar',        label: 'Grouped Bar Chart',  generatorKeys: ['Grouped Bar Chart'] },
    { id: 'histogram',          label: 'Histogram',          generatorKeys: ['Histogram'] },
    { id: 'heatmap',            label: 'Heatmap',            generatorKeys: ['Heatmap'] },
    { id: 'line-chart',         label: 'Line Chart',         generatorKeys: ['Line Chart'] },
    { id: 'dotted-line',        label: 'Dotted Line Chart',  generatorKeys: ['Dotted Line Chart'] },
    { id: 'boxplot',            label: 'Boxplot',            generatorKeys: ['Boxplot'] },
    { id: 'pie-chart',          label: 'Pie Chart',          generatorKeys: ['Pie Chart'] },
    { id: 'ranged-dot-plot',    label: 'Ranged Dot Plot',    generatorKeys: ['Ranged Dot Plot'] },
    { id: 'area-chart',         label: 'Area Chart',         generatorKeys: ['Area Chart'] },
    { id: 'streamgraph',        label: 'Streamgraph',        generatorKeys: ['Streamgraph'] },
    { id: 'lollipop-chart',     label: 'Lollipop Chart',     generatorKeys: ['Lollipop Chart'] },
    { id: 'density-plot',       label: 'Density Plot',       generatorKeys: ['Density Plot'] },
    { id: 'bump-chart',         label: 'Bump Chart',         generatorKeys: ['Bump Chart'] },
    { id: 'candlestick',        label: 'Candlestick Chart', generatorKeys: ['Candlestick Chart'] },
    { id: 'waterfall',          label: 'Waterfall Chart',   generatorKeys: ['Waterfall Chart'] },
    { id: 'strip-plot',         label: 'Strip Plot',         generatorKeys: ['Strip Plot'] },
    { id: 'radar-chart',        label: 'Radar Chart',        generatorKeys: ['Radar Chart'] },
    { id: 'pyramid-chart',      label: 'Pyramid Chart',      generatorKeys: ['Pyramid Chart'] },
    { id: 'rose-chart',         label: 'Rose Chart',         generatorKeys: ['Rose Chart'] },
    { id: 'custom-charts',      label: 'Custom Charts',      generatorKeys: ['Custom Charts'] },
].map(p => ({ ...p, render: 'single' as const, library: 'vegalite' as const }));

const VEGALITE_SECTION: GallerySection = {
    id: 'vegalite',
    label: 'VegaLite',
    description: 'Declarative grammar of graphics; the richest feature set in the gallery.',
    categories: [
        { id: 'chart-types', label: 'Chart Types', pages: VEGALITE_CHART_TYPES },
    ],
};

// ---------------------------------------------------------------------------
// ECharts
// ---------------------------------------------------------------------------

const ECHARTS_CHART_TYPES: GalleryPage[] = [
    { id: 'scatter',     label: 'Scatter',     generatorKeys: ['ECharts: Scatter'] },
    { id: 'line',        label: 'Line',        generatorKeys: ['ECharts: Line'] },
    { id: 'bar',         label: 'Bar',         generatorKeys: ['ECharts: Bar'] },
    { id: 'stacked-bar', label: 'Stacked Bar', generatorKeys: ['ECharts: Stacked Bar'] },
    { id: 'grouped-bar', label: 'Grouped Bar', generatorKeys: ['ECharts: Grouped Bar'] },
    { id: 'area',        label: 'Area',        generatorKeys: ['ECharts: Area'] },
    { id: 'pie',         label: 'Pie',         generatorKeys: ['ECharts: Pie'] },
    { id: 'heatmap',     label: 'Heatmap',     generatorKeys: ['ECharts: Heatmap'] },
    { id: 'histogram',   label: 'Histogram',   generatorKeys: ['ECharts: Histogram'] },
    { id: 'boxplot',     label: 'Boxplot',     generatorKeys: ['ECharts: Boxplot'] },
    { id: 'radar',       label: 'Radar',       generatorKeys: ['ECharts: Radar'] },
    { id: 'candlestick', label: 'Candlestick', generatorKeys: ['ECharts: Candlestick'] },
    { id: 'streamgraph', label: 'Streamgraph', generatorKeys: ['ECharts: Streamgraph'] },
    { id: 'rose',        label: 'Rose',        generatorKeys: ['ECharts: Rose'] },
    { id: 'gauge',       label: 'Gauge',       description: 'ECharts-only', generatorKeys: ['ECharts: Gauge'] },
    { id: 'funnel',      label: 'Funnel',      description: 'ECharts-only', generatorKeys: ['ECharts: Funnel'] },
    { id: 'treemap',     label: 'Treemap',     description: 'ECharts-only', generatorKeys: ['ECharts: Treemap'] },
    { id: 'sunburst',    label: 'Sunburst',    description: 'ECharts-only', generatorKeys: ['ECharts: Sunburst'] },
    { id: 'sankey',      label: 'Sankey',      description: 'ECharts-only', generatorKeys: ['ECharts: Sankey'] },
].map(p => ({ ...p, render: 'single' as const, library: 'echarts' as const }));

const ECHARTS_SECTION: GallerySection = {
    id: 'echarts',
    label: 'ECharts',
    description: 'Series-based imperative library — rich chart types (Gauge, Funnel, Treemap, Sunburst, Sankey).',
    categories: [
        { id: 'chart-types', label: 'Chart Types', pages: ECHARTS_CHART_TYPES },
    ],
};

// ---------------------------------------------------------------------------
// Chart.js
// ---------------------------------------------------------------------------

const CHARTJS_CHART_TYPES: GalleryPage[] = [
    { id: 'scatter',     label: 'Scatter',     generatorKeys: ['Chart.js: Scatter'] },
    { id: 'line',        label: 'Line',        generatorKeys: ['Chart.js: Line'] },
    { id: 'bar',         label: 'Bar',         generatorKeys: ['Chart.js: Bar'] },
    { id: 'stacked-bar', label: 'Stacked Bar', generatorKeys: ['Chart.js: Stacked Bar'] },
    { id: 'grouped-bar', label: 'Grouped Bar', generatorKeys: ['Chart.js: Grouped Bar'] },
    { id: 'area',        label: 'Area',        generatorKeys: ['Chart.js: Area'] },
    { id: 'pie',         label: 'Pie',         generatorKeys: ['Chart.js: Pie'] },
    { id: 'histogram',   label: 'Histogram',   generatorKeys: ['Chart.js: Histogram'] },
    { id: 'radar',       label: 'Radar',       generatorKeys: ['Chart.js: Radar'] },
    { id: 'rose',        label: 'Rose',        generatorKeys: ['Chart.js: Rose'] },
].map(p => ({ ...p, render: 'single' as const, library: 'chartjs' as const }));

const CHARTJS_SECTION: GallerySection = {
    id: 'chartjs',
    label: 'Chart.js',
    description: 'Dataset-based canvas library; approachable API, smaller surface.',
    categories: [
        { id: 'chart-types', label: 'Chart Types', pages: CHARTJS_CHART_TYPES },
    ],
};

// ---------------------------------------------------------------------------
// GoFish
// ---------------------------------------------------------------------------

const GOFISH_CHART_TYPES: GalleryPage[] = [
    // Today all GoFish generators are bundled under a single entry; keep that
    // until the generators are split (migration step 7).
    { id: 'all', label: 'All GoFish Examples', generatorKeys: ['GoFish Basic'], render: 'single', library: 'gofish' },
];

const GOFISH_SECTION: GallerySection = {
    id: 'gofish',
    label: 'GoFish',
    description: 'Compositional data-binding library; experimental backend.',
    categories: [
        { id: 'chart-types', label: 'Chart Types', pages: GOFISH_CHART_TYPES },
    ],
};

// ---------------------------------------------------------------------------
// Features — cross-cutting capabilities, rendered through whichever backend
// currently exercises them.  Facets and Stress have VL + EC variants listed
// together so you can compare how each library handles the same concept.
// ---------------------------------------------------------------------------

/** Shorthand to stamp single-library pages. */
const vl = (p: Omit<GalleryPage, 'render' | 'library'>): GalleryPage =>
    ({ ...p, render: 'single', library: 'vegalite' });
const ec = (p: Omit<GalleryPage, 'render' | 'library'>): GalleryPage =>
    ({ ...p, render: 'single', library: 'echarts' });
const cjs = (p: Omit<GalleryPage, 'render' | 'library'>): GalleryPage =>
    ({ ...p, render: 'single', library: 'chartjs' });

const FEATURES_SEMANTIC: GalleryPage[] = [
    vl({ id: 'semantic-context', label: 'Semantic Context', generatorKeys: ['Semantic Context'] }),
    vl({ id: 'snap-to-bound',    label: 'Snap-to-Bound',    generatorKeys: ['Snap-to-Bound'] }),
];

const FEATURES_FACETS: GalleryPage[] = [
    vl({ id: 'vl-columns',        label: 'VL: Columns',        generatorKeys: ['Facet: Columns'] }),
    vl({ id: 'vl-rows',           label: 'VL: Rows',           generatorKeys: ['Facet: Rows'] }),
    vl({ id: 'vl-cols-rows',      label: 'VL: Cols+Rows',      generatorKeys: ['Facet: Cols+Rows'] }),
    vl({ id: 'vl-small',          label: 'VL: Small',          generatorKeys: ['Facet: Small'] }),
    vl({ id: 'vl-wrap',           label: 'VL: Wrap',           generatorKeys: ['Facet: Wrap'] }),
    vl({ id: 'vl-clip',           label: 'VL: Clip',           generatorKeys: ['Facet: Clip'] }),
    vl({ id: 'vl-overflow-col',   label: 'VL: Overflow Col',   generatorKeys: ['Facet: Overflowed Col'] }),
    vl({ id: 'vl-overflow-colrow',label: 'VL: Overflow Col+Row', generatorKeys: ['Facet: Overflowed Col+Row'] }),
    vl({ id: 'vl-overflow-row',   label: 'VL: Overflow Row',   generatorKeys: ['Facet: Overflowed Row'] }),
    vl({ id: 'vl-dense-line',     label: 'VL: Dense Line',     generatorKeys: ['Facet: Dense Line'] }),
    ec({ id: 'ec-small',          label: 'EC: Small',          generatorKeys: ['ECharts: Facet Small'] }),
    ec({ id: 'ec-wrap',           label: 'EC: Wrap',           generatorKeys: ['ECharts: Facet Wrap'] }),
    ec({ id: 'ec-clip',           label: 'EC: Clip',           generatorKeys: ['ECharts: Facet Clip'] }),
];

const FEATURES_DATES: GalleryPage[] = [
    vl({ id: 'year',       label: 'Year',          generatorKeys: ['Dates: Year'] }),
    vl({ id: 'month',      label: 'Month',         generatorKeys: ['Dates: Month'] }),
    vl({ id: 'year-month', label: 'Year-Month',    generatorKeys: ['Dates: Year-Month'] }),
    vl({ id: 'decade',     label: 'Decade',        generatorKeys: ['Dates: Decade'] }),
    vl({ id: 'datetime',   label: 'Date/DateTime', generatorKeys: ['Dates: Date/DateTime'] }),
    vl({ id: 'hours',      label: 'Hours',         generatorKeys: ['Dates: Hours'] }),
];

const FEATURES_LAYOUT: GalleryPage[] = [
    vl({ id: 'discrete-axis',     label: 'Discrete Axis Sizing', generatorKeys: ['Discrete Axis Sizing'] }),
    vl({ id: 'gas-pressure',      label: 'Gas Pressure (§2)',    generatorKeys: ['Gas Pressure (§2)'] }),
    vl({ id: 'line-area-stretch', label: 'Line/Area Stretch',    generatorKeys: ['Line/Area Stretch'] }),
];

const FEATURES_STRESS: GalleryPage[] = [
    vl({  id: 'vl-overflow',    label: 'VL: Overflow',         generatorKeys: ['Overflow'] }),
    vl({  id: 'vl-elasticity',  label: 'VL: Elasticity',       generatorKeys: ['Elasticity & Stretch'] }),
    ec({  id: 'ec-stress',      label: 'EC: Stress Tests',     generatorKeys: ['ECharts: Stress Tests'] }),
    ec({  id: 'ec-unique',      label: 'EC: Unique Stress',    generatorKeys: ['ECharts: Unique Stress'] }),
    cjs({ id: 'cjs-stress',     label: 'Chart.js: Stress',     generatorKeys: ['Chart.js: Stress Tests'] }),
];

const FEATURES_SECTION: GallerySection = {
    id: 'features',
    label: 'Feature Demonstration',
    description: 'Cross-cutting capabilities. Where a feature exists in multiple libraries, the variants are listed together for comparison.',
    categories: [
        { id: 'semantic', label: 'Semantic',  pages: FEATURES_SEMANTIC },
        { id: 'facets',   label: 'Facets',    pages: FEATURES_FACETS },
        { id: 'dates',    label: 'Dates',     pages: FEATURES_DATES },
        { id: 'layout',   label: 'Layout',    pages: FEATURES_LAYOUT },
        { id: 'stress',   label: 'Stress',    pages: FEATURES_STRESS },
    ],
};

// ---------------------------------------------------------------------------
// Backend Comparison — same TestCase[] rendered through multiple libraries.
// ---------------------------------------------------------------------------

const COMPARISON_BY_CHART_TYPE: GalleryPage[] = [
    // Triple = VL + EC + CJS, using the VegaLite-keyed test set.
    { id: 'scatter',     label: 'Scatter',     generatorKeys: ['Scatter Plot'],         render: 'triple' },
    { id: 'line',        label: 'Line',        generatorKeys: ['Line Chart'],           render: 'triple' },
    { id: 'bar',         label: 'Bar',         generatorKeys: ['Bar Chart'],            render: 'triple' },
    { id: 'stacked-bar', label: 'Stacked Bar', generatorKeys: ['Stacked Bar Chart'],    render: 'triple' },
    { id: 'grouped-bar', label: 'Grouped Bar', generatorKeys: ['Grouped Bar Chart'],    render: 'triple' },
    { id: 'area',        label: 'Area',        generatorKeys: ['Area Chart'],           render: 'triple' },
    { id: 'pie',         label: 'Pie',         generatorKeys: ['Pie Chart'],            render: 'triple' },
    { id: 'histogram',   label: 'Histogram',   generatorKeys: ['Histogram'],            render: 'triple' },
    { id: 'radar',       label: 'Radar',       generatorKeys: ['Radar Chart'],          render: 'triple' },
    { id: 'rose',        label: 'Rose',        generatorKeys: ['Rose Chart'],           render: 'triple' },
];

const COMPARISON_SECTION: GallerySection = {
    id: 'comparison',
    label: 'Backend Comparison',
    description: 'Same input spec rendered through VegaLite / ECharts / Chart.js side-by-side.',
    categories: [
        { id: 'by-chart-type', label: 'By Chart Type', pages: COMPARISON_BY_CHART_TYPE },
    ],
};

// ---------------------------------------------------------------------------
// Demo Scenarios — story-driven, multi-library dataset pages.
// ---------------------------------------------------------------------------

const OMNI_PAGES: GalleryPage[] = [
    {
        id: 'dataset',
        label: 'Dataset',
        render: 'table',
        generatorKeys: [OMNI_VIZ_GALLERY_DATA_TABLE_ENTRY],
    },
    ...GALLERY_OMNI_VIZ_GENERATOR_KEYS.map<GalleryPage>(key => ({
        id: key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        label: key.replace(/^Omni:\s*/, ''),
        render: 'triple',
        generatorKeys: [key],
    })),
];

const REGIONAL_SURVEY_PAGES: GalleryPage[] = [
    { id: 'scatter',     label: 'Scatter',     generatorKeys: ['Gallery: Scatter'],     render: 'triple' },
    { id: 'line',        label: 'Line',        generatorKeys: ['Gallery: Line'],        render: 'triple' },
    { id: 'bar',         label: 'Bar',         generatorKeys: ['Gallery: Bar'],         render: 'triple' },
    { id: 'stacked-bar', label: 'Stacked Bar', generatorKeys: ['Gallery: Stacked Bar'], render: 'triple' },
    { id: 'grouped-bar', label: 'Grouped Bar', generatorKeys: ['Gallery: Grouped Bar'], render: 'triple' },
    { id: 'area',        label: 'Area',        generatorKeys: ['Gallery: Area'],        render: 'triple' },
    { id: 'pie',         label: 'Pie',         generatorKeys: ['Gallery: Pie'],         render: 'triple' },
    { id: 'histogram',   label: 'Histogram',   generatorKeys: ['Gallery: Histogram'],   render: 'triple' },
    { id: 'radar',       label: 'Radar',       generatorKeys: ['Gallery: Radar'],       render: 'triple' },
    { id: 'rose',        label: 'Rose',        generatorKeys: ['Gallery: Rose'],        render: 'triple' },
];

const DEMOS_SECTION: GallerySection = {
    id: 'demos',
    label: 'Demo Scenarios',
    description: 'Story-driven pages that exercise multiple chart types on a single dataset.',
    categories: [
        { id: 'omni-game',        label: 'Omni Game Metrics', pages: OMNI_PAGES },
        { id: 'regional-survey',  label: 'Regional Survey',   pages: REGIONAL_SURVEY_PAGES },
    ],
};

// ---------------------------------------------------------------------------
// Top-level overview section.
// ---------------------------------------------------------------------------

const OVERVIEW_SECTION: GallerySection = {
    id: 'overview',
    label: 'Overview',
    description: 'Gallery landing page — purpose and navigation.',
    categories: [{
        id: 'overview',
        label: 'Overview',
        pages: [{
            id: 'home',
            label: 'Overview',
            render: 'static',
            generatorKeys: [],
            staticPageId: 'home',
        }],
    }],
};

// ---------------------------------------------------------------------------
// Final tree
// ---------------------------------------------------------------------------

export const GALLERY_TREE: GallerySection[] = [
    OVERVIEW_SECTION,
    VEGALITE_SECTION,
    ECHARTS_SECTION,
    CHARTJS_SECTION,
    GOFISH_SECTION,
    FEATURES_SECTION,
    COMPARISON_SECTION,
    DEMOS_SECTION,
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Locate a page by `[sectionId, categoryId, pageId]` path. */
export function findPage(
    path: readonly [string, string, string] | null | undefined,
): { section: GallerySection; category: GalleryCategory; page: GalleryPage } | null {
    if (!path) return null;
    const [sid, cid, pid] = path;
    const section = GALLERY_TREE.find(s => s.id === sid);
    if (!section) return null;
    const category = section.categories.find(c => c.id === cid);
    if (!category) return null;
    const page = category.pages.find(p => p.id === pid);
    if (!page) return null;
    return { section, category, page };
}

/** Default landing path — the Overview home page. */
export const DEFAULT_PATH: readonly [string, string, string] = ['overview', 'overview', 'home'];

/** First page of a section/category (used when user clicks a parent node). */
export function firstPagePath(
    sectionId: string,
    categoryId?: string,
): readonly [string, string, string] | null {
    const section = GALLERY_TREE.find(s => s.id === sectionId);
    if (!section || section.categories.length === 0) return null;
    const category = categoryId
        ? section.categories.find(c => c.id === categoryId) ?? section.categories[0]
        : section.categories[0];
    const page = category.pages[0];
    if (!page) return null;
    return [section.id, category.id, page.id];
}
