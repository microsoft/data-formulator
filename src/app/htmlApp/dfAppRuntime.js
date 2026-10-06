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
            return Promise.reject(new Error('Table "' + table + '" is not declared in the app manifest.'));
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
        return {
            font: theme.font,
            background: null,
            view: { stroke: null },
            range: { category: theme.palette },
            axis: { labelColor: theme.muted, titleColor: theme.text, gridColor: theme.border, domainColor: theme.border, tickColor: theme.border },
            legend: { labelColor: theme.text, titleColor: theme.text },
            title: { color: theme.text },
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

    window.DF = Object.freeze({
        ready: ready,
        manifest: manifest,
        theme: Object.freeze(Object.assign({}, theme)),
        query: query,
        table: table,
        chart: chart,
        vega: vega,
        vegaLite: vegaLite,
    });

    send('hello', {});
})();
