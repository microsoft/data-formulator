import { describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { createTheme, Menu, MenuItem, ThemeProvider } from '@mui/material';

import { LayoutProvider, menuPaperSlotProps, useLayout } from '../../../../src/app/LayoutProvider';
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
    it('carries surface typography across a menu portal without adopting icon button sizing', () => {
        render(<div style={{ fontSize: 18 }}><button style={{ fontSize: 24 }}>Open menu</button></div>);
        const anchor = screen.getByRole('button', { name: 'Open menu' });
        const props = menuPaperSlotProps({ open: true, anchorEl: anchor });
        expect(props.style).toEqual({ '--df-menu-font-size': 'max(0.875rem, var(--df-text-md, 13px), 18px)' });
        expect(menuPaperSlotProps({ open: true, anchorEl: () => anchor })).toEqual(props);
        anchor.parentElement!.style.fontSize = '20px';
        expect(menuPaperSlotProps({ open: true, anchorEl: anchor }).style)
            .toEqual({ '--df-menu-font-size': 'max(0.875rem, var(--df-text-md, 13px), 20px)' });
    });

    it('keeps a readable fallback when no contextual menu anchor is available', () => {
        expect(menuPaperSlotProps({ open: false, anchorEl: null }).style)
            .toEqual({ '--df-menu-font-size': 'max(0.875rem, var(--df-text-md, 13px), 0px)' });
    });

    it('applies contextual sizing through MUI default props to portaled menu paper', () => {
        const surface = render(<div style={{ fontSize: 18 }}><button>Menu anchor</button></div>);
        const anchor = screen.getByRole('button', { name: 'Menu anchor' });
        vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
            x: 20, y: 20, top: 20, left: 20, bottom: 52, right: 100, width: 80, height: 32, toJSON: () => ({}),
        });
        const theme = createTheme({ components: { MuiMenu: { defaultProps: { slotProps: { paper: menuPaperSlotProps } } } } });
        render(<ThemeProvider theme={theme}><Menu open anchorEl={anchor}><MenuItem>Action</MenuItem></Menu></ThemeProvider>);
        const paper = screen.getByRole('menu').closest<HTMLElement>('.MuiPaper-root')!;
        expect(surface.container.contains(paper)).toBe(false);
        expect(paper.style.getPropertyValue('--df-menu-font-size'))
            .toBe('max(0.875rem, var(--df-text-md, 13px), 18px)');
    });

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
        expect(document.documentElement.style.getPropertyValue('--df-button-height-sm')).toBe('28px');
        expect(document.documentElement.style.getPropertyValue('--df-button-padding-sm')).toBe('10px');
    });

    it('scales button geometry with spacious layouts', () => {
        renderAt(3840, 2160);
        expect(probe().density).toBe('spacious');
        expect(document.documentElement.style.getPropertyValue('--df-button-height-sm')).toBe('36px');
        expect(document.documentElement.style.getPropertyValue('--df-button-height-md')).toBe('42px');
        expect(document.documentElement.style.getPropertyValue('--df-button-icon-gap')).toBe('8px');
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
