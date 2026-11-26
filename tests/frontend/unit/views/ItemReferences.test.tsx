import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { dataFormulatorReducer, dfActions, generateFreshChart } from '../../../../src/app/dfSlice';
import { createDictTable } from '../../../../src/components/ComponentType';
import { invalidateChart, setCachedChart } from '../../../../src/app/chartCache';
import { CompactMarkdown } from '../../../../src/views/InteractionEntryCard';
import { TiptapReportEditor } from '../../../../src/views/TiptapReportEditor';
import { ReportView } from '../../../../src/views/ReportView';

// Blob URLs, as the app draws them (the report editor drops data: images).
const MAP_IMAGE = 'blob:map';
vi.mock('../../../../src/maps/MapSnapshot', async () => {
    const { useEffect } = await import('react');
    return {
        default: ({ onImage }: { onImage: (image: { url: string; width: number; height: number }) => void }) => {
            useEffect(() => onImage({ url: MAP_IMAGE, width: 640, height: 400 }), []);
            return null;
        },
    };
});

const CHART_IMAGE = 'blob:chart';

const sessionStore = () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    const rows = Array.from({ length: 8 }, (_, index) => ({ region: `Region ${index + 1}`, cost: index }));
    store.dispatch(dfActions.insertDerivedTables(createDictTable('sales', rows)));
    const chart = generateFreshChart('sales', 'Bar Chart');
    store.dispatch(dfActions.addChart(chart));
    return { store, chartId: chart.id };
};

const renderMarkdown = (store: ReturnType<typeof sessionStore>['store'], content: string) =>
    render(<Provider store={store}><CompactMarkdown content={content} color="text.primary" /></Provider>);

describe('items by name in agent messages', () => {
    it('draws session://charts and session://tables embeds, and the old chart:// form, in place', () => {
        const { store, chartId } = sessionStore();
        setCachedChart(chartId, { svg: '', fullPngDataUrl: CHART_IMAGE, thumbnailDataUrl: CHART_IMAGE,
            naturalWidth: 400, naturalHeight: 300, specKey: 'k' });
        try {
            const { container } = renderMarkdown(store, `![Trend](session://charts/${chartId})\n\n![Old trend](chart://${chartId})\n\n`
                + '![Sales rows](session://tables/sales)\n\n![Gone](session://tables/nope)\n\n![Notes](session://reports/r1)');
            const charts = container.querySelectorAll(`img[data-chart-id="${chartId}"]`);
            expect(charts).toHaveLength(2);
            charts.forEach(image => expect(image).toHaveAttribute('src', CHART_IMAGE));

            const preview = screen.getByRole('figure', { name: 'Sales rows' });
            expect(within(preview).getByText('region')).toBeTruthy();
            expect(within(preview).getByText('Region 5')).toBeTruthy();
            expect(within(preview).queryByText('Region 6')).toBeNull();
            expect(preview.closest('p')).toBeNull();
            // Unknown tables show their caption; a report has no picture and shows as its caption (here, unknown: plain text).
            expect(screen.getByRole('img', { name: 'Gone' }).textContent).toBe('Gone');
            expect(screen.getByText('Notes').closest('a')).toBeNull();
        } finally {
            invalidateChart(chartId);
        }
    });

    it('draws maps by their file path and by the old map:// form', async () => {
        const { store } = sessionStore();
        renderMarkdown(store, '![Spend](files/spend.map.json)\n\n![Old spend](map://files/old.map.json)');
        await waitFor(() => expect(screen.getByRole('img', { name: 'Spend' })).toHaveAttribute('src', MAP_IMAGE));
        await waitFor(() => expect(screen.getByRole('img', { name: 'Old spend' })).toHaveAttribute('src', MAP_IMAGE));
    });

    it('opens charts, tables and reports from links, and leaves unknown names as text', () => {
        const { store, chartId } = sessionStore();
        store.dispatch(dfActions.saveGeneratedReport({ id: 'r1', content: '# R', selectedChartIds: [], createdAt: 1, status: 'completed' } as any));
        renderMarkdown(store, `See [the chart](session://charts/${chartId}), [the old chart](session/charts/${chartId}.json), `
            + '[the rows](session://tables/sales), [the report](session://reports/r1) and [a lost chart](session://charts/zzz).');
        fireEvent.click(screen.getByRole('link', { name: 'the chart' }));
        expect(store.getState().focusedId).toEqual({ type: 'chart', chartId });
        fireEvent.click(screen.getByRole('link', { name: 'the rows' }));
        expect(store.getState().focusedId).toEqual({ type: 'table', tableId: 'sales' });
        fireEvent.click(screen.getByRole('link', { name: 'the old chart' }));
        expect(store.getState().focusedId).toEqual({ type: 'chart', chartId });
        fireEvent.click(screen.getByRole('link', { name: 'the report' }));
        expect(store.getState().focusedId).toEqual({ type: 'report', reportId: 'r1' });
        expect(store.getState().viewMode).toBe('report');
        expect(screen.queryByRole('link', { name: 'a lost chart' })).toBeNull();
        expect(screen.getByText('a lost chart')).toBeTruthy();
    });
});

describe('items by name in reports', () => {
    it('draws a table embed in the editor, keeps its name, and opens session links when reading', async () => {
        const { store, chartId } = sessionStore();
        const opened: unknown[] = [];
        const { container } = render(<Provider store={store}><TiptapReportEditor editable={false}
            content={`![Sales rows](session://tables/sales)\n\nSee [the chart](session://charts/${chartId}).`}
            onOpenItem={target => opened.push(target)} /></Provider>);
        const preview = await screen.findByRole('figure', { name: 'Sales rows' });
        expect(within(preview).getByText('Region 1')).toBeTruthy();
        const link = await waitFor(() => {
            const element = container.querySelector(`a[href="session://charts/${chartId}"]`);
            expect(element).not.toBeNull();
            return element!;
        });
        act(() => { fireEvent.click(link); });
        expect(opened).toEqual([{ kind: 'chart', id: chartId }]);
    });

    it('draws session://charts and files/….map.json embeds as their old forms are drawn', async () => {
        const { store, chartId } = sessionStore();
        store.dispatch(dfActions.updateChartThumbnail({ chartId, thumbnail: CHART_IMAGE }));
        store.dispatch(dfActions.saveGeneratedReport({ id: 'r1', status: 'completed', createdAt: 1, selectedChartIds: [chartId],
            content: `# R\n\n![Trend](session://charts/${chartId})\n\n![Old trend](chart://${chartId})\n\n`
                + '![Spend](files/spend.map.json)\n\n![Old spend](map://files/old.map.json)\n\n![Sales rows](session://tables/sales)' } as any));
        store.dispatch(dfActions.setFocused({ type: 'report', reportId: 'r1' }));
        const { container } = render(<Provider store={store}><ReportView /></Provider>);
        // Both forms of each embed draw the same picture (the editor's image view shows it by its src).
        await waitFor(() => expect(container.querySelectorAll(`img[src="${CHART_IMAGE}"]`)).toHaveLength(2));
        await waitFor(() => expect(container.querySelectorAll(`img[src="${MAP_IMAGE}"]`)).toHaveLength(2));
        expect(await screen.findByRole('figure', { name: 'Sales rows' })).toBeTruthy();
        expect(container.querySelector('img[src^="session:"], img[src^="files/"]')).toBeNull();
    });
});
