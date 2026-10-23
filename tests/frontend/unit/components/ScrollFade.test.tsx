import React, { useRef } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { useScrollFade } from '../../../../src/components/ScrollFade';

const Probe: React.FC = () => {
    const ref = useRef<HTMLDivElement>(null);
    const { moreLeft, moreRight, update } = useScrollFade(ref);
    return <div ref={ref} data-testid="scroller" onScroll={update}>{`${moreLeft}/${moreRight}`}</div>;
};

describe('useScrollFade', () => {
    beforeAll(() => {
        vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    });

    it('marks the sides with content past them when a surface scrolls sideways', () => {
        render(<Probe />);
        const scroller = screen.getByTestId('scroller');
        Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 1024 });
        Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 900 });
        fireEvent.scroll(scroller);
        expect(scroller.textContent).toBe('false/true');
        scroller.scrollLeft = 124;
        fireEvent.scroll(scroller);
        expect(scroller.textContent).toBe('true/false');
    });
});
