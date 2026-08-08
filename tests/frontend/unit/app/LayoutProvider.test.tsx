import { describe, expect, it } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import { LayoutProvider, useLayout } from '../../../../src/app/LayoutProvider';
import { MIN_SUPPORTED, REFERENCE, maxThreadColumnsForWidth, threadPaneWidthFor } from '../../../../src/app/layout';

const Probe: React.FC = () => {
    const { widthClass, heightClass, density, scale, tokens } = useLayout();
    return (
        <div
            data-testid="probe"
            data-width-class={widthClass}
            data-height-class={heightClass}
            data-density={density}
            data-scale={scale}
            data-text-sm={tokens.text.sm}
        />
    );
};

const renderAt = (width: number, height: number) => {
    window.innerWidth = width;
    window.innerHeight = height;
    const result = render(<LayoutProvider><Probe /></LayoutProvider>);
    act(() => { window.dispatchEvent(new Event('resize')); });
    return result;
};

const probe = () => screen.getByTestId('probe').dataset;

describe('LayoutProvider', () => {
    it('classifies the minimum supported viewport as compact and short', () => {
        renderAt(MIN_SUPPORTED.width, MIN_SUPPORTED.height);
        expect(probe().widthClass).toBe('compact');
        expect(probe().heightClass).toBe('short');
        expect(probe().density).toBe('compact');
    });

    it('leaves a standard desktop at the reference layout', () => {
        renderAt(1440, 900);
        expect(probe().widthClass).toBe('standard');
        expect(probe().density).toBe('reference');
        expect(probe().scale).toBe('1');
        expect(probe().textSm).toBe(String(REFERENCE.text.sm));
    });

    it('publishes the scale to CSS so stylesheets can follow', () => {
        renderAt(1440, 900);
        expect(document.documentElement.style.getPropertyValue('--df-text-sm'))
            .toBe(`${REFERENCE.text.sm}px`);
    });
});

describe('shell allocation at the floor', () => {
    // The split container is what the Allotment actually gets: the viewport
    // less the rail, the sidebar and the shell's own margins.
    const splitWidth = (viewport: number, sidebar: number) =>
        viewport - REFERENCE.rail - sidebar - REFERENCE.shellChrome;

    it('seats one thread column and still clears the canvas minimum', () => {
        const columns = maxThreadColumnsForWidth(splitWidth(MIN_SUPPORTED.width, 0));
        expect(columns).toBe(1);

        const used = REFERENCE.rail + threadPaneWidthFor(columns)
            + REFERENCE.canvas.min + REFERENCE.shellChrome;
        expect(used).toBeLessThanOrEqual(MIN_SUPPORTED.width);
    });

    it('gives a wide screen more columns without starving the canvas', () => {
        const width = splitWidth(1920, REFERENCE.sidebar.default);
        const columns = maxThreadColumnsForWidth(width);
        expect(columns).toBeGreaterThan(1);
        expect(width - threadPaneWidthFor(columns)).toBeGreaterThanOrEqual(REFERENCE.canvas.min);
    });
});
