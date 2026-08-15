// ════════════════════════════════════════════════════════════════════════
// Layout provider — the single global authority on "how big is the app".
//
// Governance is deliberately thin: one measurement, one density, one token
// set. Components then interpret it locally:
//
//   const { tokens, widthClass, px, pickByWidth } = useLayout();
//   sx={{ fontSize: tokens.text.sm, width: px(248) }}
//   const columns = pickByWidth({ compact: 1, standard: 2 }, 3);
//
// `px()` scales any private reference-layout number a component owns, so a
// component never needs a token added on its behalf just to participate.
// ════════════════════════════════════════════════════════════════════════

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
    DENSITY_SCALE,
    clampDensityForViewport,
    layoutFor,
    densityForWidthClass,
    resolveHeightClass,
    resolveWidthClass,
    type Density,
    type HeightClass,
    type LayoutTokens,
    type WidthClass,
} from './layout';

const DENSITY_STORAGE_KEY = 'df_density';

export type DensityPreference = Density | 'auto';

export interface LayoutContextValue {
    width: number;
    height: number;
    widthClass: WidthClass;
    heightClass: HeightClass;
    /** Effective density: the user's preference, else the width class default. */
    density: Density;
    /** Multiplier from the reference layout to the effective density. */
    scale: number;
    tokens: LayoutTokens;
    /** Scale a reference-layout px value a component owns privately. */
    px: (referenceValue: number) => number;
    /** Pick a value by current width class; unlisted classes fall back. */
    pickByWidth: <T,>(byClass: Partial<Record<WidthClass, T>>, fallback: T) => T;
    densityPreference: DensityPreference;
    setDensityPreference: (preference: DensityPreference) => void;
}

const readStoredDensity = (): DensityPreference => {
    try {
        const stored = localStorage.getItem(DENSITY_STORAGE_KEY);
        if (stored === 'compact' || stored === 'reference' || stored === 'comfortable') return stored;
    } catch { /* localStorage unavailable */ }
    return 'auto';
};

const viewportSize = () => ({
    width: typeof window === 'undefined' ? 1440 : window.innerWidth,
    height: typeof window === 'undefined' ? 900 : window.innerHeight,
});

const LayoutContext = createContext<LayoutContextValue | null>(null);

export const LayoutProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [size, setSize] = useState(viewportSize);
    const [densityPreference, setDensityPreferenceState] = useState<DensityPreference>(readStoredDensity);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        let frame = 0;
        const onResize = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => setSize(viewportSize()));
        };
        window.addEventListener('resize', onResize);
        onResize();
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('resize', onResize);
        };
    }, []);

    const setDensityPreference = useCallback((preference: DensityPreference) => {
        setDensityPreferenceState(preference);
        try {
            if (preference === 'auto') localStorage.removeItem(DENSITY_STORAGE_KEY);
            else localStorage.setItem(DENSITY_STORAGE_KEY, preference);
        } catch { /* localStorage unavailable */ }
    }, []);

    const value = useMemo<LayoutContextValue>(() => {
        const widthClass = resolveWidthClass(size.width);
        const heightClass = resolveHeightClass(size.height);
        const requested = densityPreference === 'auto' ? densityForWidthClass(widthClass) : densityPreference;
        const density = clampDensityForViewport(requested, size.width, size.height);
        const scale = DENSITY_SCALE[density];
        const tokens = layoutFor(density);
        return {
            width: size.width,
            height: size.height,
            widthClass,
            heightClass,
            density,
            scale,
            tokens,
            px: (referenceValue: number) => Math.round(referenceValue * scale),
            pickByWidth: (byClass, fallback) => byClass[widthClass] ?? fallback,
            densityPreference,
            setDensityPreference,
        };
    }, [size.width, size.height, densityPreference, setDensityPreference]);

    // Publish to CSS so `src/scss/*` can participate without reading the theme.
    useEffect(() => {
        if (typeof document === 'undefined') return;
        const { tokens, scale } = value;
        const root = document.documentElement.style;
        root.setProperty('--df-scale', String(scale));
        root.setProperty('--df-text-xxs', `${tokens.text.xxs}px`);
        root.setProperty('--df-text-xs', `${tokens.text.xs}px`);
        root.setProperty('--df-text-sm', `${tokens.text.sm}px`);
        root.setProperty('--df-text-md', `${tokens.text.md}px`);
        root.setProperty('--df-text-lg', `${tokens.text.lg}px`);
        root.setProperty('--df-text-xl', `${tokens.text.xl}px`);
        root.setProperty('--df-text-xxl', `${tokens.text.xxl}px`);
        root.setProperty('--df-icon-xs', `${tokens.icon.xs}px`);
        root.setProperty('--df-icon-sm', `${tokens.icon.sm}px`);
        root.setProperty('--df-icon-md', `${tokens.icon.md}px`);
        root.setProperty('--df-icon-lg', `${tokens.icon.lg}px`);
        root.setProperty('--df-icon-xl', `${tokens.icon.xl}px`);
        root.setProperty('--df-button-height-sm', `${Math.round(28 * scale)}px`);
        root.setProperty('--df-button-height-md', `${Math.round(32 * scale)}px`);
        root.setProperty('--df-button-padding-sm', `${Math.round(10 * scale)}px`);
        root.setProperty('--df-button-padding-md', `${Math.round(12 * scale)}px`);
        root.setProperty('--df-button-icon-gap', `${Math.round(6 * scale)}px`);
        root.setProperty('--df-rail', `${tokens.rail}px`);
        root.setProperty('--df-card-width', `${tokens.thread.cardWidth}px`);
        root.setProperty('--df-row-height', `${tokens.grid.rowHeight}px`);
        root.setProperty('--df-app-bar', `${tokens.appBar}px`);
    }, [value]);

    return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
};

/**
 * Global layout state. Falls back to the reference layout when no provider is
 * mounted so isolated components and tests render at today's sizes.
 */
export const useLayout = (): LayoutContextValue => {
    const ctx = useContext(LayoutContext);
    return ctx ?? FALLBACK;
};

const FALLBACK: LayoutContextValue = {
    width: 1440,
    height: 900,
    widthClass: 'standard',
    heightClass: 'standard',
    density: 'reference',
    scale: 1,
    tokens: layoutFor('reference'),
    px: (referenceValue: number) => referenceValue,
    pickByWidth: (byClass, fallback) => byClass.standard ?? fallback,
    densityPreference: 'auto',
    setDensityPreference: () => { /* no provider */ },
};

/**
 * Element-level size and width class.
 *
 * Prefer this over `useLayout()` inside panels: at a 1920px viewport the
 * canvas pane may still be 500px wide, so the viewport class would lie.
 */
export const useContainerSize = (ref: React.RefObject<HTMLElement | null>) => {
    const [size, setSize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        if (typeof ResizeObserver === 'undefined') return;
        let observer: ResizeObserver | null = null;
        let frame = 0;
        // The observed node can mount after this effect runs — the shell swaps
        // the landing view for the workspace once a table exists — and a ref
        // object's identity never changes, so the effect won't re-run on its
        // own. Keep looking until it appears, or the size stays 0 forever.
        const attach = () => {
            const element = ref.current;
            if (!element) {
                frame = requestAnimationFrame(attach);
                return;
            }
            const update = () => {
                const rect = element.getBoundingClientRect();
                setSize(prev => (prev.width === rect.width && prev.height === rect.height
                    ? prev
                    : { width: rect.width, height: rect.height }));
            };
            update();
            observer = new ResizeObserver(update);
            observer.observe(element);
        };
        attach();
        return () => {
            cancelAnimationFrame(frame);
            observer?.disconnect();
        };
    }, [ref]);

    return useMemo(() => ({
        ...size,
        widthClass: resolveWidthClass(size.width),
        heightClass: resolveHeightClass(size.height),
    }), [size]);
};

/**
 * The value once it stops moving. For anything whose consumer is expensive
 * enough that intermediate values are wasted work — a chart recompile, say —
 * where a drag would otherwise fire one per frame.
 */
export const useSettledValue = <T,>(value: T, delay = 200): T => {
    const [settled, setSettled] = useState(value);

    useEffect(() => {
        if (Object.is(value, settled)) return;
        const timer = setTimeout(() => setSettled(value), delay);
        return () => clearTimeout(timer);
    }, [value, settled, delay]);

    return settled;
};
