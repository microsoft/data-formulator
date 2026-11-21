// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The share card: a picture of an app, map or chart laid out for posting, with a few words (its title, or what
 * the person wants to say), where it was made, and the logos. By default it fits its picture: as tall as the
 * picture needs, from wide (the size link previews use) to tall (4:5, what phone feeds show largest). It can also
 * be one of those shapes, or square. Drawn on a canvas in the browser at twice its size, so it stays sharp on
 * phones; nothing about the data goes into it beyond the picture.
 */

export type CardShape = 'fit' | 'wide' | 'square' | 'tall';
type FixedShape = Exclude<CardShape, 'fit'>;
export const CARD_SHAPES: CardShape[] = ['fit', 'wide', 'square', 'tall'];
export const CARD_WIDTH = 1200;
export const CARD_HEIGHTS: Record<FixedShape, number> = { wide: 630, square: 1200, tall: 1500 };
/** The card's pixels per unit of its layout. */
export const CARD_DENSITY = 2;
const PADS: Record<CardShape, number> = { fit: 44, wide: 32, square: 44, tall: 44 };
/** How many lines the words may take. */
const LINES: Record<CardShape, number> = { fit: 2, wide: 1, square: 2, tall: 3 };
/** A picture is drawn at most this many times its own size (a small chart stays a chart, not a blur). */
const MAX_ENLARGE = 2.5;
const FONT = '"Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
const INK = '#1b1f3b';
const MUTED = '#6b7085';
const RULE = '#e6e8ee';
const TITLE_SIZE = 30;
const TITLE_LINE = 40;
const BYLINE_SIZE = 20;
const LOGO_HEIGHT = 44;

export interface ShareCardInput {
    /** The picture (a data URL). */
    picture: string;
    /** The picture's pixels per CSS pixel: its own size is its pixel size over this. */
    density?: number;
    /** A long picture (an app's page) may be cut at the bottom; others are always shown whole. */
    crop?: boolean;
    /** The card's shape; by default it fits the picture. */
    shape?: CardShape;
    /** The words on the card, wrapped to the lines its shape has room for. */
    title: string;
    /** Where it was made, after "Made with": the space's name, or Data Formulator. */
    brand: string;
    /** Logos at the footer's end, in order (URLs); one that fails to load is left out. */
    logos?: string[];
}

export interface ShareCard { url: string; shape: CardShape; width: number; height: number }

interface Box { x: number; y: number; w: number; h: number }

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${src.slice(0, 40)}`));
    image.src = src;
});

/** `text` in lines that fit `width`, at most `limit` of them; the last one cut short with an ellipsis if need be. */
export function wrapText(measure: (text: string) => number, text: string, width: number, limit: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';
    let index = 0;
    for (; index < words.length; index += 1) {
        const next = line ? `${line} ${words[index]}` : words[index];
        if (measure(next) <= width || !line) { line = next; continue; }
        lines.push(line);
        line = words[index];
        if (lines.length === limit) break;
    }
    if (lines.length < limit && line) { lines.push(line); line = ''; index = words.length; }
    const cut = index < words.length || !!line;
    let last = lines[lines.length - 1] ?? '';
    if (cut || measure(last) > width) {
        while (last && measure(`${last}…`) > width) last = last.slice(0, -1).trimEnd();
        lines[lines.length - 1] = `${last}…`;
    }
    return lines;
}

/** The space the footer takes for `lines` lines of words. */
const footerHeight = (lines: number) => 26 + Math.max(lines, 1) * TITLE_LINE + 34 + 24;

/** Where the picture can go on a card of `shape` with `lines` lines of words. */
export function pictureArea(shape: FixedShape, lines = LINES[shape]): Box {
    const pad = PADS[shape];
    return { x: pad, y: pad, w: CARD_WIDTH - 2 * pad, h: CARD_HEIGHTS[shape] - footerHeight(lines) - pad };
}

/** Pictures drawn for a card (maps) are drawn at this fraction of its picture area, so their text reads at its size. */
const DRAWN_FRACTION = 1 / 1.4;

/**
 * The size (CSS pixels) to draw a picture that can take any shape (a map) at, to fill a card of `shape`; for a card
 * that fits its picture, a square's (the picture then keeps to what it shows).
 */
export function pictureSizeFor(shape: CardShape) {
    const area = pictureArea(shape === 'fit' ? 'square' : shape);
    return { width: Math.round(area.w * DRAWN_FRACTION), height: Math.round(area.h * DRAWN_FRACTION) };
}

/**
 * Where the picture goes in `area`: whole and centred, at most MAX_ENLARGE times its own size; or, when it may be
 * cropped and is longer than the area, across the area's width from its top.
 */
export function placePicture(width: number, height: number, area: Box, crop = false) {
    const across = Math.min(area.w / width, MAX_ENLARGE);
    if (crop && height * across > area.h) {
        const w = width * across;
        return { source: { x: 0, y: 0, w: width, h: area.h / across }, target: { x: area.x + (area.w - w) / 2, y: area.y, w, h: area.h }, cut: true };
    }
    const scale = Math.min(area.w / width, area.h / height, MAX_ENLARGE);
    const w = width * scale;
    const h = height * scale;
    return { source: { x: 0, y: 0, w: width, h: height }, target: { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h }, cut: false };
}

/**
 * A card fitting its picture is as tall as the picture across its width needs (with `footer` under it), between a
 * wide card's height and a tall one's.
 */
export function fittedHeight(width: number, height: number, footer: number) {
    const pad = PADS.fit;
    const needed = pad + height * Math.min((CARD_WIDTH - 2 * pad) / width, MAX_ENLARGE) + 8 + footer;
    return Math.round(Math.min(CARD_HEIGHTS.tall, Math.max(CARD_HEIGHTS.wide, needed)));
}

export async function composeShareCard({ picture, density = 1, crop = false, shape = 'fit', title, brand, logos = [] }: ShareCardInput): Promise<ShareCard> {
    const image = await loadImage(picture);
    const own = { w: image.width / density, h: image.height / density };
    const pad = PADS[shape];
    const canvas = document.createElement('canvas');
    canvas.width = CARD_WIDTH * CARD_DENSITY;
    const context = canvas.getContext('2d')!;

    // The footer's end: the logos, right to left.
    const marks = (await Promise.all(logos.map(src => loadImage(src).catch(() => null))))
        .filter((logo): logo is HTMLImageElement => !!logo && logo.width > 0 && logo.height > 0);
    const logoWidths = marks.map(logo => logo.width * LOGO_HEIGHT / logo.height);
    const textWidth = CARD_WIDTH - 2 * pad - logoWidths.reduce((sum, width) => sum + width + 20, 0) - 12;

    context.font = `600 ${TITLE_SIZE}px ${FONT}`;
    const lines = title.trim() ? wrapText(text => context.measureText(text).width, title, textWidth, LINES[shape]) : [];
    const footer = footerHeight(lines.length);
    const height = shape === 'fit' ? fittedHeight(own.w, own.h, footer) : CARD_HEIGHTS[shape];
    canvas.height = height * CARD_DENSITY;
    context.scale(CARD_DENSITY, CARD_DENSITY);
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, CARD_WIDTH, height);
    const top = height - footer;

    const area = { x: pad, y: pad, w: CARD_WIDTH - 2 * pad, h: top - pad - 8 };
    const { source, target, cut } = placePicture(own.w, own.h, area, crop);
    context.drawImage(image, source.x * density, source.y * density, source.w * density, source.h * density,
        target.x, target.y, target.w, target.h);
    if (cut) {
        // A cut picture fades out rather than stopping at a hard edge.
        const fade = context.createLinearGradient(0, target.y + target.h - 72, 0, target.y + target.h);
        fade.addColorStop(0, 'rgba(255,255,255,0)');
        fade.addColorStop(1, 'rgba(255,255,255,1)');
        context.fillStyle = fade;
        context.fillRect(target.x, target.y + target.h - 72, target.w, 72);
    }

    context.fillStyle = RULE;
    context.fillRect(pad, top, CARD_WIDTH - 2 * pad, 1);
    const textTop = top + 26;
    const textHeight = Math.max(lines.length, 1) * TITLE_LINE + 34;
    let right = CARD_WIDTH - pad;
    for (let index = marks.length - 1; index >= 0; index -= 1) {
        right -= logoWidths[index];
        context.drawImage(marks[index], right, textTop + (textHeight - LOGO_HEIGHT) / 2, logoWidths[index], LOGO_HEIGHT);
        right -= 20;
    }
    context.textBaseline = 'alphabetic';
    context.fillStyle = INK;
    context.font = `600 ${TITLE_SIZE}px ${FONT}`;
    lines.forEach((line, index) => context.fillText(line, pad, textTop + 30 + index * TITLE_LINE));
    context.fillStyle = MUTED;
    context.font = `400 ${BYLINE_SIZE}px ${FONT}`;
    const byline = `Made with ${brand}`;
    const bylineY = textTop + (lines.length ? lines.length * TITLE_LINE + 26 : 30);
    context.fillText(wrapText(text => context.measureText(text).width, byline, textWidth, 1)[0] ?? '', pad, bylineY);
    return { url: canvas.toDataURL('image/png'), shape, width: canvas.width, height: canvas.height };
}
