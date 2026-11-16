// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Render demo story covers: each job draws one chart of a story seed (its state.json and table rows) the way the
 * canvas assembles it (Flint, the chart's semantics, the site's theme), as a PNG at 2x.
 *
 *   node scripts/render-story-covers.mjs jobs.json
 *
 * jobs.json: { "theme": <Flint ThemeSpec or preset id>, "jobs": [{ "state": "<seed>/state.json", "chart": 0,
 *   "rows": "<rows>.json", "out": "<file>.png", "width": 665, "height": 480, "crop": true }] }
 * The demos' make_covers.py writes it (py-src/data_formulator/demos/unesco/make_covers.py).
 */

import fs from 'fs';
import { createCanvas } from 'canvas';
import { assembleVegaLite } from 'flint-chart';
import * as vega from 'vega';
import * as vl from 'vega-lite';

import { choroplethRegion, keepUnmatchedRegions } from '../../../../src/app/chartMaps.ts';
import { mergeableLayerSorts, resolveColumnSorts } from '../../../../src/app/chartSort.ts';

/** A long category axis gets at least this much room per category, so its labels do not overlap. */
const MIN_STEP = 12;

function assemble(state, chart, rows, theme, width, height) {
    const items = state.conceptShelfItems || [];
    const encodings = {};
    for (const [channel, encoding] of Object.entries(chart.encodingMap || {})) {
        const field = encoding.fieldID ? items.find(item => item.id === encoding.fieldID) : undefined;
        encodings[channel] = { field: field?.name, type: encoding.dtype, aggregate: encoding.aggregate,
            sortOrder: encoding.sortOrder, sortBy: encoding.sortBy, scheme: encoding.scheme };
    }
    Object.assign(encodings, resolveColumnSorts(encodings, rows));
    // As the canvas does (assembleVegaChart): fields with a semantic type, and their display names.
    const fields = (state.tableSemantics || []).find(info => info.tableId === chart.tableRef)?.fields || {};
    const semanticTypes = {};
    const displayNames = {};
    for (const [name, info] of Object.entries(fields)) {
        const { displayName: _displayName, authored: _authored, ...annotation } = info;
        if (info.semanticType) semanticTypes[name] = Object.keys(annotation).length === 1 ? info.semanticType : annotation;
        if (info.displayName) displayNames[name] = info.displayName;
    }
    const spec = assembleVegaLite({
        data: { values: rows },
        semantic_types: semanticTypes,
        chart_spec: {
            chartType: chart.chartType, encodings,
            ...(chart.title ? { title: chart.title } : {}), ...(chart.subtitle ? { subtitle: chart.subtitle } : {}),
            baseSize: { width: Math.round(width * 0.93), height: Math.round(height * 0.93) }, canvasSize: { width, height },
            chartProperties: choroplethRegion(chart.chartType, encodings, rows, chart.config),
        },
        options: {},
        ...(theme ? { theme_spec: theme } : {}),
        ...(Object.keys(displayNames).length ? { field_display_names: displayNames } : {}),
    });
    for (const key of ['width', 'height']) {
        if (typeof spec[key]?.step === 'number' && spec[key].step < MIN_STEP) spec[key] = { step: MIN_STEP };
    }
    return mergeableLayerSorts(keepUnmatchedRegions(spec));
}

async function render(job, theme) {
    const state = JSON.parse(fs.readFileSync(job.state, 'utf8'));
    const chart = state.charts[job.chart];
    if (!chart) throw new Error(`${job.state} has no chart ${job.chart}`);
    const rows = JSON.parse(fs.readFileSync(job.rows, 'utf8'));
    const spec = assemble(state, chart, rows, theme, job.width, job.height);
    const view = new vega.View(vega.parse(vl.compile(spec).spec), { renderer: 'none' });
    try {
        await view.runAsync();
        let canvas = await view.toCanvas(2);
        // A tall chart (a long ranking) keeps its top, like a card showing its first rows.
        if (job.crop && canvas.height > job.height * 2) {
            const top = createCanvas(canvas.width, job.height * 2);
            top.getContext('2d').drawImage(canvas, 0, 0);
            canvas = top;
        }
        fs.writeFileSync(job.out, canvas.toBuffer('image/png'));
        console.log(`${job.out} (${chart.chartType}, ${canvas.width}x${canvas.height})`);
    } finally {
        view.finalize();
    }
}

const { theme, jobs } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const job of jobs) await render(job, theme);
