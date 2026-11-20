import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    charts: [
        { id: 'chart-1', chartType: 'Bar Chart' },
        { id: 'chart-table', chartType: 'Table' },
    ],
    cache: {} as Record<string, { fullPngDataUrl: string }>,
}));

vi.mock('react-redux', () => ({ useSelector: (selector: any) => selector({}) }));
vi.mock('../../../../src/app/dfSlice', () => ({ dfSelectors: { getAllCharts: () => mocks.charts } }));
vi.mock('../../../../src/app/chartCache', () => ({ getCachedChart: (id: string) => mocks.cache[id] }));
vi.mock('../../../../src/app/workspaceService', () => ({ readWorkspaceTextFile: vi.fn() }));

import { AgentViewHost } from '../../../../src/views/AgentViewHost';

// jsdom loads no images: a picture "loads" at once at a small size, so it is sent as it is.
class LoadedImage {
    width = 300;
    height = 200;
    onload: (() => void) | null = null;
    set src(_: string) { setTimeout(() => this.onload?.()); }
}

describe('AgentViewHost', () => {
    it('answers with each chart\'s current picture, and says why a chart has none', async () => {
        vi.stubGlobal('Image', LoadedImage);
        mocks.cache['chart-1'] = { fullPngDataUrl: 'data:image/png;base64,AAAA' };
        const onDone = vi.fn();
        render(<AgentViewHost request={{ id: 'r1', targets: [
            { path: 'session/charts/chart-1.json', kind: 'chart', id: 'chart-1' },
            { path: 'session/charts/chart-table.json', kind: 'chart', id: 'chart-table' },
        ] }} onDone={onDone} />);

        await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1), { timeout: 5000 });
        expect(onDone.mock.calls[0][0]).toEqual([
            { path: 'session/charts/chart-1.json', image: 'data:image/png;base64,AAAA', density: 2 },
            { path: 'session/charts/chart-table.json', error: 'a Table chart has no picture' },
        ]);
    });
});
