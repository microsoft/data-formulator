// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Small hand-drawn sketches for the /dev/design layer titles, in Flint's design-page style (flint-chart
 * site/src/talk/sketch.ts): tapered brush strokes with a gentle wobble and watercolour washes, drawn on a
 * 240 x 180 board and scaled to the box. The brush outline is a small stand-in for perfect-freehand.
 */

import React, { useEffect, useRef } from 'react';

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];
export type LayerSketchKind = 'connector' | 'discovery' | 'harness' | 'interaction';

const C = {
    card: '#ffffff',
    ink: '#1f2a33',
    ink2: '#52606b',
    soft: '#9aa3a8',
    amber: '#f4b41a',
    red: '#e4572e',
    blue: '#2f6db5',
    teal: '#2a9d8f',
};

const BW = 240;
const BH = 180;
/** Strokes a little heavier than the video's, so they read at icon size. */
const T = 1.45;

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function hash(...xs: number[]): number {
    let h = 2166136261;
    for (const x of xs) {
        h ^= Math.floor(x * 1000); h = Math.imul(h, 16777619);
        h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995);
    }
    return ((h >>> 0) % 1000003) / 1000003;
}

function rng(seed: number): () => number {
    let a = Math.floor(seed * 4294967296) >>> 0;
    return () => {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function resample(pts: Pt[], step: number): Pt[] {
    const out: Pt[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
        for (let k = 1; k <= n; k++) out.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]);
    }
    return out;
}

function wobbleOffsets(seed: number, n: number, amp: number): Pt[] {
    const r = rng(hash(seed));
    const f1 = 0.05 + r() * 0.08, f2 = 0.17 + r() * 0.15, p1 = r() * 6.28, p2 = r() * 6.28;
    return Array.from({ length: n }, (_, i) => [
        amp * (Math.sin(i * f1 + p1) * 0.7 + Math.sin(i * f2 + p2) * 0.3),
        amp * (Math.cos(i * f1 * 1.3 + p2) * 0.7 + Math.cos(i * f2 * 0.8 + p1) * 0.3),
    ] as Pt);
}

interface StrokeOptions { w?: number; color?: string; seed?: number; alpha?: number; wobble?: number; bend?: number; head?: number }

/** A brush stroke along `pts`: tapered at both ends, a little thicker in the middle, slightly wobbly. */
function stroke(ctx: Ctx, pts: Pt[], o: StrokeOptions = {}): void {
    const { w = 4, color = C.ink, seed = 0, alpha = 1, wobble = 1.1 } = o;
    if (pts.length < 2) return;
    const dense = resample(pts, 4);
    const off = wobbleOffsets(seed, dense.length, wobble);
    const path = dense.map(([x, y], i) => [x + off[i][0], y + off[i][1]] as Pt);
    const lengths = [0];
    for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
    const total = lengths[lengths.length - 1] || 1;
    const startTaper = Math.min(w * 2.5, total * 0.4), endTaper = Math.min(w * 2, total * 0.4);
    const pressure = rng(hash(seed, 7));
    let p = 0.85;
    const left: Pt[] = [], right: Pt[] = [];
    path.forEach(([x, y], i) => {
        const [ax, ay] = path[Math.max(0, i - 1)], [bx, by] = path[Math.min(path.length - 1, i + 1)];
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const nx = -(by - ay) / len, ny = (bx - ax) / len;
        p = lerp(p, 0.75 + pressure() * 0.35, 0.15);
        const s = lengths[i];
        const taper = Math.min(1, s / startTaper, (total - s) / endTaper);
        const half = (w / 2) * p * (0.25 + 0.75 * Math.sqrt(Math.max(0, taper)));
        left.push([x + nx * half, y + ny * half]);
        right.push([x - nx * half, y - ny * half]);
    });
    const outline = [...left, ...right.reverse()];
    ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i++) {
        const [x0, y0] = outline[i - 1], [x1, y1] = outline[i];
        ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    }
    ctx.closePath(); ctx.fill(); ctx.restore();
}

function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, o: StrokeOptions = {}): Pt[] {
    const bend = o.bend ?? 0;
    const nx = -(y2 - y1), ny = x2 - x1, nl = Math.hypot(nx, ny) || 1;
    const pts: Pt[] = [];
    for (let i = 0; i <= 12; i++) {
        const k = i / 12, b = Math.sin(k * Math.PI) * bend;
        pts.push([lerp(x1, x2, k) + nx / nl * b, lerp(y1, y2, k) + ny / nl * b]);
    }
    stroke(ctx, pts, o);
    return pts;
}

function arrow(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, o: StrokeOptions = {}): void {
    const pts = line(ctx, x1, y1, x2, y2, o);
    const [ax, ay] = pts[pts.length - 1], [bx, by] = pts[pts.length - 3];
    const angle = Math.atan2(ay - by, ax - bx), size = o.head ?? 16;
    for (const s of [-1, 1]) {
        const a = angle + Math.PI + s * 0.5;
        line(ctx, ax, ay, ax + Math.cos(a) * size, ay + Math.sin(a) * size, { ...o, seed: (o.seed || 0) + s * 7, bend: 0 });
    }
}

/** Sketchy rectangle: four slightly overshooting strokes. */
function rect(ctx: Ctx, x: number, y: number, w: number, h: number, o: StrokeOptions & { overshoot?: number } = {}): void {
    const os = o.overshoot ?? 6, seed = o.seed || 0;
    const sides: [number, number, number, number][] = [
        [x - os, y, x + w + os * 0.5, y], [x + w, y - os, x + w, y + h + os * 0.6],
        [x + w + os, y + h, x - os * 0.5, y + h], [x, y + h + os * 0.6, x, y - os],
    ];
    sides.forEach((side, i) => line(ctx, ...side, { ...o, seed: seed + i * 13, bend: (hash(seed, i) - 0.5) * 3 }));
}

function ellipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, o: StrokeOptions & { from?: number; sweep?: number } = {}): void {
    const seed = o.seed || 0, from = o.from ?? -2.2, sweep = o.sweep ?? Math.PI * 2 * 1.06;
    const pts: Pt[] = [];
    for (let i = 0; i <= 48; i++) {
        const a = from + (i / 48) * sweep, k = 1 + (hash(seed, i % 48) - 0.5) * 0.04;
        pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
    stroke(ctx, pts, o);
}

/** Watercolour wash: two layered, jittered fills. */
function wash(ctx: Ctx, pts: Pt[], color: string, o: { alpha?: number; seed?: number; amp?: number } = {}): void {
    const { alpha = 0.5, seed = 0, amp = 2.2 } = o;
    ctx.save();
    for (let k = 0; k < 2; k++) {
        const dense = resample([...pts, pts[0]], 14);
        const off = wobbleOffsets(seed + k * 31, dense.length, amp);
        ctx.globalAlpha = alpha * 0.62; ctx.fillStyle = color; ctx.beginPath();
        dense.forEach(([x, y], i) => (i ? ctx.lineTo(x + off[i][0], y + off[i][1]) : ctx.moveTo(x + off[i][0], y + off[i][1])));
        ctx.closePath(); ctx.fill();
    }
    ctx.restore();
}

function washRect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string, o: { alpha?: number; seed?: number; amp?: number } = {}): void {
    wash(ctx, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], color, o);
}

function dot(ctx: Ctx, x: number, y: number, r: number, color: string, o: { alpha?: number; seed?: number } = {}): void {
    const pts: Pt[] = Array.from({ length: 10 }, (_, i) => [x + Math.cos(i / 10 * Math.PI * 2) * r, y + Math.sin(i / 10 * Math.PI * 2) * r]);
    wash(ctx, pts, color, { amp: Math.min(1.2, r * 0.15), alpha: o.alpha ?? 0.9, seed: o.seed || 0 });
}

/** A card: a soft wash with a sketched outline. */
function card(ctx: Ctx, x: number, y: number, w: number, h: number, seed: number): void {
    washRect(ctx, x, y, w, h, C.card, { alpha: 0.95, seed: seed + 5, amp: 1.5 });
    rect(ctx, x, y, w, h, { w: 2.6 * T, seed, overshoot: 3 });
}

// ---------------------------------------------------------------- the four layers

/** Three databases wired into one protocol bar, which hands data on to the agent. */
function connector(ctx: Ctx) {
    const cylinder = (cx: number, top: number, color: string, seed: number) => {
        const rw = 24, rh = 7, h = 26;
        washRect(ctx, cx - rw, top, rw * 2, h, color, { alpha: 0.6, seed });
        line(ctx, cx - rw, top, cx - rw, top + h, { w: 2.6 * T, seed: seed + 1 });
        line(ctx, cx + rw, top, cx + rw, top + h, { w: 2.6 * T, seed: seed + 2 });
        ellipse(ctx, cx, top, rw, rh, { w: 2.4 * T, seed: seed + 3 });
        ellipse(ctx, cx, top + h, rw, rh, { w: 2.4 * T, seed: seed + 4, from: 0, sweep: Math.PI });
    };
    [[22, C.blue], [74, C.teal], [126, C.amber]].forEach(([top, color], i) => {
        cylinder(46, top as number, color as string, 10 + i * 10);
        line(ctx, 74, (top as number) + 14, 136, 90, { w: 2.2 * T, color: C.ink2, seed: 50 + i, bend: (i - 1) * -6 });
    });
    washRect(ctx, 138, 36, 22, 108, C.blue, { alpha: 0.25, seed: 60 });
    rect(ctx, 138, 36, 22, 108, { w: 3 * T, seed: 61, overshoot: 3 });
    arrow(ctx, 172, 90, 222, 90, { w: 3 * T, seed: 70, head: 12, color: C.ink2 });
}

/** A browser and a terminal, with a magnifier finding something new; a spark for tools still to come. */
function discovery(ctx: Ctx) {
    card(ctx, 14, 30, 120, 96, 100);
    line(ctx, 14, 52, 134, 52, { w: 2 * T, seed: 110 });
    [0, 1, 2].forEach(i => dot(ctx, 26 + i * 11, 41, 3.2, C.soft, { seed: 120 + i }));
    [[28, 70, 60], [28, 88, 84], [28, 106, 44]].forEach(([x, y, w], i) => line(ctx, x, y, x + w, y, { w: 2.2 * T, color: C.soft, seed: 130 + i }));
    washRect(ctx, 70, 112, 82, 52, C.ink, { alpha: 0.82, seed: 140 });
    rect(ctx, 70, 112, 82, 52, { w: 2.4 * T, seed: 141, overshoot: 2 });
    line(ctx, 82, 128, 92, 136, { w: 2.4 * T, color: '#ffffff', seed: 142 });
    line(ctx, 92, 136, 82, 144, { w: 2.4 * T, color: '#ffffff', seed: 143 });
    line(ctx, 98, 146, 116, 146, { w: 2.4 * T, color: '#ffffff', seed: 144 });
    dot(ctx, 176, 74, 26, C.amber, { alpha: 0.45, seed: 150 });
    ellipse(ctx, 176, 74, 30, 30, { w: 3.6 * T, seed: 151 });
    line(ctx, 198, 96, 226, 126, { w: 6 * T, seed: 152 });
    line(ctx, 216, 18, 216, 42, { w: 2.8 * T, color: C.amber, seed: 160 });
    line(ctx, 204, 30, 228, 30, { w: 2.8 * T, color: C.amber, seed: 161 });
}

/** Notebook cells run step by step, ending in a chart. */
function harness(ctx: Ctx) {
    [[28, [44, 24]], [72, [30, 50]], [116, [52, 20]]].forEach(([y, widths], i) => {
        card(ctx, 14, y as number, 108, 34, 200 + i * 10);
        dot(ctx, 28, (y as number) + 17, 4, i === 2 ? C.blue : C.soft, { seed: 230 + i });
        let x = 40;
        (widths as number[]).forEach((w, k) => {
            line(ctx, x, (y as number) + 17, x + w, (y as number) + 17, { w: 2.2 * T, color: k === 1 ? C.blue : C.soft, seed: 240 + i * 3 + k });
            x += w + 8;
        });
    });
    arrow(ctx, 130, 90, 156, 90, { w: 3 * T, seed: 260, head: 11, color: C.ink2 });
    card(ctx, 164, 36, 64, 108, 270);
    [[0, 36, C.blue], [18, 62, C.teal], [36, 48, C.amber]].forEach(([dx, h, color], i) => {
        washRect(ctx, 174 + (dx as number), 132 - (h as number), 13, h as number, color as string, { alpha: 0.8, seed: 280 + i });
    });
    line(ctx, 170, 132, 222, 132, { w: 2.4 * T, seed: 290 });
}

/** A data thread branching into a chart the user can reach in and change. */
function interaction(ctx: Ctx) {
    line(ctx, 34, 20, 34, 162, { w: 2.4 * T, color: C.ink2, seed: 300 });
    [[34, C.blue], [74, C.amber], [116, C.teal], [152, C.soft]].forEach(([y, color], i) => dot(ctx, 34, y as number, 7, color as string, { seed: 310 + i }));
    stroke(ctx, [[40, 74], [58, 74], [72, 70], [86, 66]], { w: 2.2 * T, color: C.ink2, seed: 320 });
    card(ctx, 90, 30, 132, 104, 330);
    stroke(ctx, [[102, 112], [126, 88], [148, 98], [172, 62], [204, 74]], { w: 3.2 * T, color: C.red, seed: 340 });
    line(ctx, 100, 122, 214, 122, { w: 2.2 * T, seed: 341 });
    const pointer: Pt[] = [[176, 108], [176, 150], [186, 140], [194, 158], [202, 154], [194, 137], [208, 136]];
    wash(ctx, pointer, C.card, { alpha: 1, seed: 350, amp: 0.6 });
    stroke(ctx, [...pointer, pointer[0]], { w: 2.4 * T, seed: 351, wobble: 0.5 });
}

const DRAW: Record<LayerSketchKind, (ctx: Ctx) => void> = { connector, discovery, harness, interaction };

export const LayerSketch: React.FC<{ kind: LayerSketchKind; label: string }> = ({ kind, label }) => {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return undefined;
        const draw = () => {
            const w = canvas.clientWidth, h = canvas.clientHeight;
            if (!w || !h) return;
            const dpr = Math.max(2, window.devicePixelRatio || 1);
            canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
            const ctx = canvas.getContext('2d')!;
            const k = Math.min(w / BW, h / BH);
            ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (w - BW * k) / 2, dpr * (h - BH * k) / 2);
            ctx.clearRect(0, 0, BW, BH);
            DRAW[kind](ctx);
        };
        draw();
        const observer = new ResizeObserver(draw);
        observer.observe(canvas);
        return () => observer.disconnect();
    }, [kind]);
    return <canvas ref={ref} role="img" aria-label={label} style={{ width: '100%', height: '100%', display: 'block' }} />;
};
