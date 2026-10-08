// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// DF app runtime: injected as an inline script into sandboxed HTML apps.
// Runs inside an opaque-origin iframe with no network access; data is read
// through postMessage requests that the host validates against the manifest.
(function () {
    'use strict';
    var config = window.__DF_APP_CONFIG__ || {};
    var channel = config.channel;
    var manifest = Object.freeze({
        version: 1,
        title: (config.manifest && config.manifest.title) || '',
        tables: Object.freeze(((config.manifest && config.manifest.tables) || []).slice()),
    });
    var theme = config.theme || {};
    var pending = new Map();
    var sequence = 0;
    var views = new WeakMap();
    var resolveReady;
    var ready = new Promise(function (resolve) { resolveReady = resolve; });
    var vega = window.vega;
    var vegaLite = window.vegaLite;

    function send(type, payload) {
        var message = Object.assign({ dfApp: channel, type: type }, payload || {});
        window.parent.postMessage(message, config.hostOrigin || '*');
    }

    window.addEventListener('message', function (event) {
        // The host posts from the top page's realm; the container is also host-owned.
        if (event.source !== window.parent && event.source !== window.top) return;
        var data = event.data;
        if (!data || data.dfApp !== channel) return;
        if (data.type === 'init') {
            resolveReady();
        } else if (data.type === 'result' && pending.has(data.id)) {
            var request = pending.get(data.id);
            pending.delete(data.id);
            if (data.error) request.reject(new Error(data.error));
            else request.resolve({ rows: data.rows || [], totalRowCount: data.totalRowCount || 0 });
        }
    });

    function describe(error) {
        if (error && typeof error === 'object') return String(error.message || error);
        return String(error);
    }

    window.addEventListener('error', function (event) {
        send('error', { message: describe(event.error || event.message), line: event.lineno || 0 });
    });
    window.addEventListener('unhandledrejection', function (event) {
        send('error', { message: describe(event.reason) });
    });

    function query(table, options) {
        if (manifest.tables.indexOf(table) < 0) {
            var message = 'Table "' + table + '" is not declared in the app manifest.';
            send('error', { message: 'DF.query: ' + message });
            return Promise.reject(new Error(message));
        }
        return ready.then(function () {
            return new Promise(function (resolve, reject) {
                var id = ++sequence;
                pending.set(id, { resolve: resolve, reject: reject });
                send('query', { id: id, table: table, options: options || {} });
            });
        });
    }

    function table(name, options) {
        return query(name, { limit: options && options.limit }).then(function (result) { return result.rows; });
    }

    function chartConfig() {
        // Match DF's own charts: 10px labels, 11px axis/legend titles, 13px chart title.
        var size = theme.textSize || {};
        var labelSize = size.xxs || 10;
        var titleSize = size.xs || 11;
        return {
            font: theme.font,
            background: null,
            padding: 4,
            view: { stroke: null },
            range: { category: theme.palette },
            mark: { color: theme.palette && theme.palette[0] },
            axis: {
                labelColor: theme.muted, titleColor: theme.muted, labelFontSize: labelSize, titleFontSize: titleSize,
                titleFontWeight: 500, gridColor: 'rgba(0, 0, 0, 0.08)', domainColor: theme.border, tickColor: theme.border,
                labelOverlap: true, labelLimit: 160,
            },
            legend: {
                labelColor: theme.text, titleColor: theme.muted, labelFontSize: labelSize, titleFontSize: titleSize,
                titleFontWeight: 500, symbolSize: 80, labelLimit: 200,
            },
            header: { labelColor: theme.text, titleColor: theme.muted, labelFontSize: titleSize, titleFontSize: titleSize },
            title: { color: theme.text, fontSize: size.md || 13, fontWeight: 600, anchor: 'start', subtitleColor: theme.muted, subtitleFontSize: titleSize },
            text: { color: theme.text, fontSize: labelSize },
        };
    }

    function chart(target, spec, options) {
        var element = typeof target === 'string' ? document.querySelector(target) : target;
        if (!element) return Promise.reject(new Error('DF.chart target not found: ' + target));
        if (!vega || !vegaLite) return Promise.reject(new Error('Chart runtime is unavailable.'));
        try {
            var previous = views.get(element);
            if (previous) previous.finalize();
            var themed = Object.assign({}, spec, { config: Object.assign(chartConfig(), spec && spec.config) });
            if (themed.width === 'container' && !themed.autosize) themed.autosize = { type: 'fit-x', contains: 'padding' };
            var compiled = spec && spec.$schema && /\/vega\/v\d/.test(spec.$schema) ? themed : vegaLite.compile(themed).spec;
            var view = new vega.View(vega.parse(compiled), {
                renderer: (options && options.renderer) || 'svg',
                container: element,
                hover: true,
            });
            views.set(element, view);
            return view.runAsync();
        } catch (error) {
            return Promise.reject(error);
        }
    }

    function finite(value) {
        var number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
        return typeof number === 'number' && isFinite(number) ? number : null;
    }

    function formatter(options) {
        try { return new Intl.NumberFormat(undefined, options); } catch (error) { return new Intl.NumberFormat(); }
    }

    // Display helpers; each returns an em dash for missing or non-numeric values.
    var format = Object.freeze({
        number: function (value, digits) {
            var number = finite(value);
            if (number === null) return '\u2014';
            var places = typeof digits === 'number' ? digits : Math.abs(number) >= 100 ? 0 : Math.abs(number) >= 1 ? 1 : 2;
            return formatter({ minimumFractionDigits: typeof digits === 'number' ? digits : 0, maximumFractionDigits: places }).format(number);
        },
        compact: function (value, digits) {
            var number = finite(value);
            if (number === null) return '\u2014';
            return formatter({ notation: 'compact', maximumFractionDigits: typeof digits === 'number' ? digits : 1 }).format(number);
        },
        percent: function (value, digits) {
            var number = finite(value);
            if (number === null) return '\u2014';
            return formatter({ style: 'percent', maximumFractionDigits: typeof digits === 'number' ? digits : 1 }).format(number);
        },
        delta: function (value, digits) {
            var number = finite(value);
            if (number === null) return '\u2014';
            return (number > 0 ? '+' : number < 0 ? '\u2212' : '') + format.number(Math.abs(number), digits);
        },
        date: function (value, options) {
            if (value === null || value === undefined || value === '') return '\u2014';
            var date = value instanceof Date ? value : new Date(value);
            if (isNaN(date.getTime())) return String(value);
            // Date-only strings parse as UTC midnight; format them in UTC so they don't shift a day.
            var dateOnly = typeof value === 'string' && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(value.trim());
            var formatOptions = Object.assign({}, options || { year: 'numeric', month: 'short', day: 'numeric' },
                dateOnly ? { timeZone: 'UTC' } : {});
            return new Intl.DateTimeFormat(undefined, formatOptions).format(date);
        },
    });

    // Axis-free trend line for KPI tiles; the x type is inferred from the data.
    function sparkline(target, rows, options) {
        var x = options && options.x;
        var y = options && options.y;
        if (!x || !y) return Promise.reject(new Error('DF.sparkline needs {x, y} field names.'));
        var sample = (rows || []).find(function (row) { return row && row[x] !== null && row[x] !== undefined; });
        var xType = sample && typeof sample[x] === 'string' && !isNaN(Date.parse(sample[x])) ? 'temporal'
            : sample && typeof sample[x] === 'string' ? 'ordinal' : 'quantitative';
        var color = (options && options.color) || (theme.palette && theme.palette[0]) || theme.primary;
        var element = typeof target === 'string' ? document.querySelector(target) : target;
        var height = (options && options.height) || (element && element.clientHeight) || 36;
        var encoding = {
            x: { field: x, type: xType, axis: null, scale: xType === 'ordinal' ? undefined : { nice: false } },
            y: { field: y, type: 'quantitative', axis: null, stack: null, scale: { zero: false } },
        };
        var points = (rows || []).filter(function (row) { return row && row[y] !== null && row[y] !== undefined; });
        return chart(element || target, {
            data: { values: rows || [] }, width: 'container', height: height, padding: { top: 3, bottom: 1, left: 0, right: 3 },
            autosize: { type: 'fit', contains: 'padding' },
            layer: [
                { mark: { type: 'area', color: color, opacity: 0.12, interpolate: 'monotone', y2: 'height', clip: true }, encoding: encoding },
                { mark: { type: 'line', color: color, strokeWidth: 1.5, interpolate: 'monotone' }, encoding: Object.assign({}, encoding, {
                    tooltip: [{ field: x, type: xType }, { field: y, type: 'quantitative', format: ',.2~f' }],
                }) },
                { data: { values: points.slice(-1) }, mark: { type: 'circle', color: color, size: 22, opacity: 1 }, encoding: encoding },
            ],
            config: { view: { stroke: null } },
        });
    }

    // Keep the kit's slider fill (--df-fill-pct) in step with range inputs.
    function syncRange(input) {
        var min = input.min === '' ? 0 : Number(input.min);
        var max = input.max === '' ? 100 : Number(input.max);
        var pct = max > min ? (Number(input.value) - min) / (max - min) * 100 : 0;
        input.style.setProperty('--df-fill-pct', Math.max(0, Math.min(100, pct)) + '%');
    }
    function syncRanges() {
        Array.prototype.forEach.call(document.querySelectorAll('input[type=range]'), syncRange);
    }
    document.addEventListener('input', function (event) {
        var target = event.target;
        if (target && target.matches && target.matches('input[type=range]')) syncRange(target);
    }, true);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncRanges);
    else syncRanges();
    ready.then(function () { setTimeout(syncRanges, 0); });

    window.DF = Object.freeze({
        ready: ready,
        manifest: manifest,
        theme: Object.freeze(Object.assign({}, theme)),
        query: query,
        table: table,
        chart: chart,
        sparkline: sparkline,
        format: format,
        // For errors the app catches itself (e.g. a React error boundary), which
        // never reach window.onerror.
        reportError: function (message) { send('error', { message: describe(message) }); },
        vega: vega,
        vegaLite: vegaLite,
    });

    send('hello', {});
})();
