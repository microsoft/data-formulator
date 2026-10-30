// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The imperative D3 map renderer behind MapView. It owns an SVG (and a canvas for large
 * point sets), the projection, and zoom: pan and wheel on flat maps, drag to rotate on the
 * globe. React passes it a scene (layer models, selection) and receives hover and click hits.
 */

import * as d3 from 'd3';
import type { Feature, FeatureCollection, Geometry } from 'geojson';

import { stateAbbr, type GeoSet } from './geography';
import { featureAnchor } from './model';
import { frameBackground, mapStyle, type MapStyle } from './styles';
import type { LayerModel, LonLat, Mark } from './model';
import { arrowPath, CATEGORICAL_SCHEMES, DIVERGING_SCHEMES, SEQUENTIAL_SCHEMES, formatter, type LegendModel } from './scales';
import type { MapView, ProjectionName } from './spec';

export interface Hit {
    layerId: string;
    mark: Mark;
    model: LayerModel;
}

export interface Scene {
    view: MapView;
    basemap: GeoSet | null;
    models: LayerModel[];
    selection: { layerId: string; keys: Set<string> } | null;
    /** Categories hidden from the legend, per layer. */
    hidden: Record<string, Set<string>>;
    /** Hovered legend entry: highlight its marks. */
    highlight: { layerId: string; test: (mark: Mark) => boolean } | null;
    interactive: boolean;
    /** Changes when the spec or its data change; filters, frames, and selection keep the user's view. */
    fitVersion?: number;
    /** Panels floating over the map ([x0, y0, x1, y1] in pixels): the centred map shrinks to clear them. */
    obstacles?: [number, number, number, number][];
}

export interface RendererCallbacks {
    onHover: (hit: Hit | null, point: [number, number]) => void;
    onClick: (hit: Hit | null, event: MouseEvent) => void;
    /** Legends that depend on the zoom (hexbin, density). */
    onDynamicLegends?: (legends: Record<string, LegendModel | null>) => void;
    onInteract?: () => void;
    /** After a full draw: the projected width of 360° in pixels (picks the boundary detail). */
    onScale?: (worldWidth: number) => void;
    /** After a fresh fit: the fitted map's width over its height (null for a set centre and zoom), for placing panels. */
    onAspect?: (aspect: number | null) => void;
    /** A lasso (shift-drag, or drag in lasso mode) selected these marks; null when it caught none. */
    onLasso?: (selection: { layerId: string; keys: Set<string> } | null) => void;
}



const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
/** Online street tiles (keyless, with the attribution each provider requires). */
export const TILE_STYLES: Record<string, { url: (z: number, x: number, y: number) => string; attribution: string; maxZoom: number }> = {
    light: { url: (z, x, y) => `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/${z}/${y}/${x}`, attribution: 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors', maxZoom: 16 },
    dark: { url: (z, x, y) => `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`, attribution: 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors', maxZoom: 16 },
    streets: { url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, attribution: '© OpenStreetMap contributors', maxZoom: 19 },
};

const CANVAS_THRESHOLD = 2500;

let measureContext: CanvasRenderingContext2D | null | undefined;
let measureFont: string | undefined;
/** Rendered text width in pixels (a canvas measurement; a per-character estimate without one). */
export function textWidth(text: string, size: number): number {
    if (measureContext === undefined) {
        try { measureContext = document.createElement('canvas').getContext('2d'); } catch { measureContext = null; }
    }
    if (!measureContext) return text.length * size * 0.6;
    measureFont ??= getComputedStyle(document.documentElement).getPropertyValue('--df-font').trim() || 'system-ui, sans-serif';
    measureContext.font = `${size}px ${measureFont}`;
    return measureContext.measureText(text).width;
}

interface Label {
    x: number; y: number; text: string; priority: number; model?: LayerModel; fill?: string;
    /** Font size in pixels (default 11, place names 10). */
    size?: number;
    /** A basemap place name: smaller, quieter, below data labels. */
    place?: boolean;
    /** Text colour on the basemap (a track's name in its line colour); the halo still applies. */
    ink?: string;
    /** Bold, for the one place a map is about (a route map's hub). */
    strong?: boolean;
}

const isDark = (color: string | undefined) => {
    if (!color) return false;
    const rgb = d3.rgb(color);
    return 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b < 120;
};

export function makeProjection(name: ProjectionName): d3.GeoProjection {
    switch (name) {
        case 'mercator': return d3.geoMercator();
        case 'equirectangular': return d3.geoEquirectangular();
        case 'orthographic': return d3.geoOrthographic().clipAngle(90);
        case 'albersUsa': return d3.geoAlbersUsa() as unknown as d3.GeoProjection;
        case 'albers': return d3.geoAlbers();
        case 'conicEqualArea': return d3.geoConicEqualArea();
        case 'azimuthalEqualArea': return d3.geoAzimuthalEqualArea();
        case 'stereographic': return d3.geoStereographic();
        case 'transverseMercator': return d3.geoTransverseMercator();
        case 'naturalEarth': return d3.geoNaturalEarth1();
        default: return d3.geoEqualEarth();
    }
}

/** The projection a view uses: explicit, else Albers USA for US basemaps and Mercator under tiles. */
export function viewProjection(view: MapView): ProjectionName {
    if (view.tiles && view.tiles !== 'none') return 'mercator';
    if (view.projection) return view.projection;
    if (view.basemap === 'us-states' || view.basemap === 'us-counties') return 'albersUsa';
    return 'equalEarth';
}

const SPHERE = { type: 'Sphere' } as unknown as d3.GeoPermissibleObjects;
/** The rotation of a Pacific-centred world map (Datawrapper's "World (Pacific)"): centred on 160°E, edge near 20°W. */
const PACIFIC_CENTRED = -160;

/** A flow arc's control point: bowed to the left of travel, so A→B and B→A part ways. */
const arcControl = (from: [number, number], to: [number, number], curve: string): [number, number] => {
    const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
    const bend = curve === 'straight' ? 0 : 0.22;
    return [(from[0] + to[0]) / 2 - dy * bend, (from[1] + to[1]) / 2 + dx * bend];
};

/** A line's outline narrowing from `width` at its origin to a point at its end (a tapered flow line). */
function taperPath(points: [number, number][], width: number): string {
    if (points.length < 2) return '';
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    points.forEach((point, index) => {
        const before = points[Math.max(0, index - 1)];
        const after = points[Math.min(points.length - 1, index + 1)];
        const length = Math.hypot(after[0] - before[0], after[1] - before[1]) || 1;
        const [nx, ny] = [-(after[1] - before[1]) / length, (after[0] - before[0]) / length];
        const half = (width * (1 - 0.88 * index / (points.length - 1)) + 0.6) / 2;
        left.push([point[0] + nx * half, point[1] + ny * half]);
        right.push([point[0] - nx * half, point[1] - ny * half]);
    });
    const ring = [...left, ...right.reverse()];
    return `M${ring.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`;
}

/** A filled arrowhead at a line's last point, pointing along its final stretch. */
function arrowHead(points: [number, number][], width: number): string {
    const tip = points[points.length - 1];
    const length = Math.min(20, Math.max(9, width * 2.4 + 6));
    // Head along the last few pixels of the line, not just its final segment (curves bend there).
    let index = points.length - 2;
    while (index > 0 && Math.hypot(tip[0] - points[index][0], tip[1] - points[index][1]) < length) index--;
    const base = points[index];
    const distance = Math.hypot(tip[0] - base[0], tip[1] - base[1]) || 1;
    const [ux, uy] = [(tip[0] - base[0]) / distance, (tip[1] - base[1]) / distance];
    const half = length * 0.45;
    const [bx, by] = [tip[0] - ux * length, tip[1] - uy * length];
    return `M${tip[0]},${tip[1]}L${bx - uy * half},${by + ux * half}L${bx + uy * half},${by - ux * half}Z`;
}
/** About 20,000 km² in steradians: land smaller than this does not stop a panel floating over the map. */
const SMALL_LAND = 5e-4;
/** A feature's area in steradians, whichever way its rings wind. */
const landArea = (feature: d3.GeoPermissibleObjects) => { const area = d3.geoArea(feature); return Math.min(area, 4 * Math.PI - area); };

/** Text the renderer draws (legends, tooltips), translated by the host. */
export interface RendererStrings {
    points: (count: number) => string;
    density: string;
    low: string;
    high: string;
    perHexagon: string;
    total: (field: string) => string;
}

const ENGLISH: RendererStrings = {
    points: count => `${count} ${count === 1 ? 'point' : 'points'}`, density: 'Density', low: 'Low', high: 'High',
    perHexagon: 'Points per hexagon', total: field => `Total ${field}`,
};

export class MapRenderer {
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private canvas: HTMLCanvasElement;
    private root: d3.Selection<SVGGElement, unknown, null, undefined>;
    private width = 0;
    private height = 0;
    private scene: Scene | null = null;
    private projection: d3.GeoProjection = d3.geoEqualEarth();
    private base = { scale: 1, translate: [0, 0] as [number, number], rotate: [0, 0, 0] as [number, number, number] };
    private transform = d3.zoomIdentity;
    private zoom: d3.ZoomBehavior<SVGSVGElement, unknown>;
    private fitKey = '';
    private frame = 0;
    private animate = false;
    private spinTimer: d3.Timer | null = null;
    private canvasMarks: { model: LayerModel; mark: Mark; x: number; y: number; r: number }[] = [];
    private quadtree: d3.Quadtree<{ model: LayerModel; mark: Mark; x: number; y: number; r: number }> | null = null;
    private dynamicLegendKey = '';
    private lassoMode = false;
    private lassoPoints: [number, number][] | null = null;
    private suppressClick = false;
    /** Where point-like marks were drawn, per layer, for the lasso. */
    private positions = new Map<string, Map<string, [number, number]>>();
    /** Bubbles drawn this frame ([x0, y0, x1, y1]): place names stay off them. */
    private circleBoxes: [number, number, number, number][] = [];
    /** Mark states for the current draw, per layer. */
    private states = new Map<string, Map<string, { dim: boolean; selected: boolean; hidden: boolean }>>();
    /** The zoom the map was last fully drawn at; gestures on big maps transform that drawing until they end. */
    private drawnTransform = d3.zoomIdentity;
    private heavy = false;
    /** Path data per element, keyed by the projection that produced it. */
    private pathKeys = new WeakMap<Element, { key: string; geometry: unknown }>();
    private projectionKey = '';

    constructor(svgElement: SVGSVGElement, canvas: HTMLCanvasElement, private callbacks: RendererCallbacks, private strings: RendererStrings = ENGLISH) {
        this.svg = d3.select(svgElement);
        this.canvas = canvas;
        this.svg.selectAll('*').remove();
        this.root = this.svg.append('g').attr('class', 'df-map-root');
        for (const name of ['ocean', 'tiles', 'graticule', 'land', 'layers', 'borders', 'labels']) this.root.append('g').attr('class', `df-map-${name}`);
        this.svg.append('path').attr('class', 'df-map-lasso').attr('fill', 'rgba(31,119,180,0.08)').attr('stroke', '#1f77b4')
            .attr('stroke-width', 1).attr('stroke-dasharray', '4 3').style('pointer-events', 'none');
        this.zoom = d3.zoom<SVGSVGElement, unknown>()
            .scaleExtent([1, 4096])
            .filter(event => (!event.ctrlKey || event.type === 'wheel') && !event.button && event.type !== 'dblclick'
                && (event.type === 'wheel' || (!event.shiftKey && !this.lassoMode)))
            .on('start', () => { this.stopSpin(); this.callbacks.onInteract?.(); this.callbacks.onHover(null, [0, 0]); })
            .on('zoom', event => {
                this.transform = event.transform;
                // Big flat maps follow the gesture with a transform and redraw when it ends.
                if (this.heavy && !this.isGlobe) this.applyGestureTransform();
                else this.schedule(false);
            })
            .on('end', () => { if (this.heavy && !this.isGlobe) this.schedule(false); });
        this.svg.call(this.zoom).on('dblclick.zoom', null);
        this.svg.on('dblclick', (event: MouseEvent) => this.onDoubleClick(event));
        this.svg.on('click', (event: MouseEvent) => {
            if (this.suppressClick) { this.suppressClick = false; return; }
            if ((event.target as Element).closest?.('[data-mark]')) return;
            const hit = this.canvasHit(d3.pointer(event, this.svg.node()));
            this.callbacks.onClick(hit, event);
        });
        this.svg.on('mousemove', (event: MouseEvent) => {
            if ((event.target as Element).closest?.('[data-mark]')) return;
            const point = d3.pointer(event, this.svg.node()) as [number, number];
            this.callbacks.onHover(this.canvasHit(point), point);
        });
        this.svg.on('mouseleave', () => this.callbacks.onHover(null, [0, 0]));
        this.svg.on('pointerdown.lasso', (event: PointerEvent) => {
            if (event.button || !(event.shiftKey || this.lassoMode) || !this.scene?.interactive) return;
            this.stopSpin();
            this.lassoPoints = [d3.pointer(event, this.svg.node()) as [number, number]];
            (this.svg.node() as SVGSVGElement).setPointerCapture?.(event.pointerId);
            event.preventDefault();
        });
        this.svg.on('pointermove.lasso', (event: PointerEvent) => {
            if (!this.lassoPoints) return;
            this.lassoPoints.push(d3.pointer(event, this.svg.node()) as [number, number]);
            this.svg.select('.df-map-lasso').attr('d', `M${this.lassoPoints.join('L')}Z`);
        });
        this.svg.on('pointerup.lasso', () => {
            const points = this.lassoPoints;
            this.lassoPoints = null;
            this.svg.select('.df-map-lasso').attr('d', null);
            if (points && points.length > 4) {
                this.suppressClick = true;
                window.setTimeout(() => { this.suppressClick = false; }, 0);
                this.callbacks.onLasso?.(this.lassoHits(points));
            }
        });
    }

    private applyGestureTransform() {
        const drawn = this.drawnTransform;
        const t = this.transform;
        const ratio = t.k / drawn.k;
        const x = t.x - ratio * drawn.x;
        const y = t.y - ratio * drawn.y;
        this.root.attr('transform', `translate(${x},${y}) scale(${ratio})`);
        this.canvas.style.transformOrigin = '0 0';
        this.canvas.style.transform = `matrix(${ratio},0,0,${ratio},${x},${y})`;
    }

    /** Set `d` only when the projection or geometry changed since the element was last drawn. */
    private setPath<E extends SVGPathElement, D>(selection: d3.Selection<E, D, d3.BaseType, unknown>, geometry: (datum: D) => unknown, path: d3.GeoPath) {
        const keys = this.pathKeys;
        const key = this.projectionKey;
        selection.each(function (datum) {
            const shape = geometry(datum);
            const drawn = keys.get(this);
            if (drawn && drawn.key === key && drawn.geometry === shape) return;
            this.setAttribute('d', path(shape as never) ?? '');
            keys.set(this, { key, geometry: shape });
        });
    }

    setLassoMode(on: boolean) {
        this.lassoMode = on;
        this.svg.style('cursor', on ? 'crosshair' : '');
    }

    /** The layer with the most marks inside the lasso, and those marks. */
    private lassoHits(polygon: [number, number][]): { layerId: string; keys: Set<string> } | null {
        let best: { layerId: string; keys: Set<string> } | null = null;
        for (const model of this.scene?.models ?? []) {
            if (model.layer.visible === false || model.layer.type === 'heatmap' || model.layer.type === 'hexbin') continue;
            const drawn = this.positions.get(model.layer.id);
            const keys = new Set<string>();
            for (const mark of model.marks) {
                const point = drawn?.get(mark.key) ?? (mark.at ? this.project(mark.at) : null);
                if (point && d3.polygonContains(polygon, point)) keys.add(mark.key);
            }
            if (keys.size && (!best || keys.size >= best.keys.size)) best = { layerId: model.layer.id, keys };
        }
        return best;
    }

    destroy() {
        this.stopSpin();
        if (this.frame) cancelAnimationFrame(this.frame);
        this.svg.on('.zoom', null).on('click', null).on('mousemove', null).on('mouseleave', null).on('dblclick', null).on('.lasso', null);
        this.svg.selectAll('*').remove();
    }

    setSize(width: number, height: number) {
        if (width === this.width && height === this.height) return;
        this.width = width;
        this.height = height;
        this.svg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);
        const ratio = window.devicePixelRatio || 1;
        this.canvas.width = Math.round(width * ratio);
        this.canvas.height = Math.round(height * ratio);
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
        this.fitKey = '';
        if (this.scene) this.draw(false);
    }

    update(scene: Scene, animate = true) {
        const previous = this.scene;
        this.scene = scene;
        if (!previous || previous.view !== scene.view) this.fitKey = '';
        this.schedule(animate && !!previous);
    }

    private get style(): MapStyle { return mapStyle(this.scene?.view.style); }

    get isGlobe() { return viewProjection(this.scene?.view ?? {}) === 'orthographic'; }

    zoomBy(factor: number) {
        this.stopSpin();
        this.svg.transition().duration(250).call(this.zoom.scaleBy, factor);
    }

    reset() {
        this.stopSpin();
        this.svg.transition().duration(400).call(this.zoom.transform, d3.zoomIdentity);
    }

    /** Zoom to a feature or a point, as when a region is double-clicked or found by search. */
    zoomTo(target: Feature | LonLat) {
        if (!this.scene) return;
        this.stopSpin();
        if (this.isGlobe) {
            const [lon, lat] = Array.isArray(target) ? target : d3.geoCentroid(target);
            const start = this.transform;
            const k = Math.max(start.k, 1.5);
            // Globe pans rotate it; aim the pan so the target faces the viewer.
            const radians = 180 / Math.PI;
            const x = (-lon - this.base.rotate[0]) * (this.base.scale * k) / radians;
            const y = -(-lat - this.base.rotate[1]) * (this.base.scale * k) / radians;
            this.svg.transition().duration(700).call(this.zoom.transform, d3.zoomIdentity.translate(x, y).scale(k));
            return;
        }
        const base = this.baseProjection();
        const path = d3.geoPath(base);
        const bounds = Array.isArray(target)
            ? (() => { const point = base(target); return point ? [[point[0] - 40, point[1] - 40], [point[0] + 40, point[1] + 40]] : null; })()
            : path.bounds(target);
        if (!bounds || !bounds.flat().every(Number.isFinite)) return;
        const [[x0, y0], [x1, y1]] = bounds as [[number, number], [number, number]];
        const k = Math.min(64, 0.8 / Math.max((x1 - x0) / this.width, (y1 - y0) / this.height, 1e-6));
        const transform = d3.zoomIdentity.translate(this.width / 2, this.height / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
        this.svg.transition().duration(700).call(this.zoom.transform, transform);
    }

    /** The current projection, for placing HTML overlays. */
    project(point: LonLat): [number, number] | null {
        if (!this.visible(point)) return null;
        return this.projection(point) as [number, number] | null;
    }

    private stopSpin() {
        this.spinTimer?.stop();
        this.spinTimer = null;
    }

    private schedule(animate: boolean) {
        this.animate = this.animate || animate;
        if (this.frame) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            const animateNow = this.animate;
            this.animate = false;
            this.draw(animateNow);
        });
    }

    /** The fitted projection before zoom. */
    private baseProjection(): d3.GeoProjection {
        const scene = this.scene!;
        const view = scene.view;
        const name = viewProjection(view);
        const projection = makeProjection(name);
        const obstacles = scene.obstacles ?? [];
        const key = JSON.stringify([name, view.center, view.zoom, view.rotate, view.fit, view.basemap, view.tiles, this.width, this.height, obstacles,
            scene.basemap?.name, scene.fitVersion ?? 0]);
        if (key === this.fitKey) {
            projection.scale(this.base.scale).translate(this.base.translate);
            if (name !== 'albersUsa') projection.rotate(this.base.rotate);
            return projection;
        }
        const pad = 16;
        // The map is centred in the whole panel, then shrunk just enough to clear the floating panels.
        const extent: [[number, number], [number, number]] = [[pad, pad], [Math.max(pad + 1, this.width - pad), Math.max(pad + 1, this.height - pad)]];
        const middle: [number, number] = [this.width / 2, this.height / 2];
        let fitted: d3.GeoPermissibleObjects | null = null;
        if (name !== 'albersUsa' && view.rotate) projection.rotate(view.rotate as [number, number, number]);
        if (name === 'orthographic') {
            const center = view.center ?? this.dataCenter() ?? [0, 20];
            projection.rotate(view.rotate as [number, number, number] ?? [-center[0], -center[1], 0]);
            projection.fitExtent(extent, SPHERE);
            fitted = SPHERE;
        } else if (view.center && name !== 'albersUsa') {
            projection.fitExtent(extent, SPHERE);
            const scale = projection.scale() * (view.zoom ?? 1);
            if (name === 'mercator' || name === 'equirectangular' || name === 'transverseMercator') {
                projection.scale(scale).center(view.center).translate(middle);
            } else {
                projection.rotate([-view.center[0], -view.center[1], 0]).scale(scale).translate(middle);
            }
        } else {
            // A flat world turns so its edge falls where the data leaves the most room (routes across the
            // Pacific stay whole instead of being cut at the date line), unless the spec sets a rotation.
            if (!view.rotate && name !== 'albersUsa' && scene.basemap?.name.startsWith('countries')) projection.rotate([this.edgeRotation(), 0, 0]);
            const target = this.fitTarget(name);
            projection.fitExtent(extent, target);
            if (view.zoom && view.zoom !== 1) projection.scale(projection.scale() * view.zoom);
            else fitted = target;
        }
        let aspect: number | null = null;
        if (fitted) {
            const [[x0, y0], [x1, y1]] = d3.geoPath(projection).bounds(fitted);
            if ([x0, y0, x1, y1].every(Number.isFinite) && x1 > x0 && y1 > y0) aspect = Math.round((x1 - x0) / (y1 - y0) * 100) / 100;
        }
        this.callbacks.onAspect?.(aspect);
        if (fitted && obstacles.length) {
            // A flat world collides on its land: panels may float over open ocean, painted or not.
            const world = (fitted === SPHERE || fitted === this.worldLandCache?.target) && name !== 'orthographic' && scene.basemap?.name.startsWith('countries');
            // Small islands (Fiji, Samoa) on the map's rim may sit under a panel; only sizeable land collides.
            const collision = world ? { type: 'FeatureCollection', features: scene.basemap!.features
                .filter(item => item.properties.id !== 'ATA' && landArea(item) > SMALL_LAND) } as d3.GeoPermissibleObjects : fitted;
            this.fitAroundObstacles(projection, fitted, collision, obstacles);
        }
        this.base = {
            scale: projection.scale(), translate: projection.translate() as [number, number],
            rotate: name === 'albersUsa' ? [0, 0, 0] : projection.rotate() as [number, number, number],
        };
        this.fitKey = key;
        this.transform = d3.zoomIdentity;
        this.svg.property('__zoom', d3.zoomIdentity);
        this.limitZoom(projection, name);
        if (name === 'orthographic' && view.spin && this.scene?.interactive) this.startSpin();
        return projection;
    }

    /**
     * Fit the map as large as the floating panels allow. Canvas panels are squarer than most maps, so
     * the map may sit in a free band (below the header, above the timeline, beside a side column)
     * rather than the panel's centre. Collisions test the land, not empty ocean, so panels can float
     * over the map's corners. Candidates differ only in scale and offset, so the outline is projected
     * once and moved linearly.
     */
    private fitAroundObstacles(projection: d3.GeoProjection, target: d3.GeoPermissibleObjects, collision: d3.GeoPermissibleObjects,
        obstacles: [number, number, number, number][]) {
        const scale0 = projection.scale();
        const [tx0, ty0] = projection.translate();
        const toUnit = ([x, y]: [number, number]): [number, number] => [(x - tx0) / scale0, (y - ty0) / scale0];
        const points: [number, number][] = [];
        const collect = (x: number, y: number) => { points.push(toUnit([x, y])); };
        d3.geoPath(projection, { moveTo: collect, lineTo: collect, arc: collect, closePath: () => {} } as never)(collision);
        const step = Math.max(1, Math.floor(points.length / 3000));
        const outline = step > 1 ? points.filter((_, index) => index % step === 0) : points;
        const [[bx0, by0], [bx1, by1]] = d3.geoPath(projection).bounds(target).map(point => toUnit(point as [number, number]));
        if (![bx0, by0, bx1, by1].every(Number.isFinite) || bx1 <= bx0 || by1 <= by0) return;

        const pad = 16;
        const gap = 10;
        const margin = 6;
        // A panel bounds a side band when clearing that band costs less of the panel than clearing a top or
        // bottom band would (a short title or a timeline in the top row stays a top panel).
        const narrow = (box: [number, number, number, number]) =>
            Math.min(box[2] / this.width, (this.width - box[0]) / this.width) < Math.min(box[3] / this.height, (this.height - box[1]) / this.height);
        const middleY = (box: [number, number, number, number]) => (box[1] + box[3]) / 2;
        const middleX = (box: [number, number, number, number]) => (box[0] + box[2]) / 2;
        const tops = obstacles.filter(box => middleY(box) < this.height / 2);
        const bottoms = obstacles.filter(box => middleY(box) >= this.height / 2);
        const lefts = obstacles.filter(box => narrow(box) && middleX(box) < this.width / 2);
        const rights = obstacles.filter(box => narrow(box) && middleX(box) >= this.width / 2);
        const edges = {
            top: tops.length ? Math.max(...tops.map(box => box[3])) + gap : pad,
            bottom: bottoms.length ? Math.min(...bottoms.map(box => box[1])) - gap : this.height - pad,
            left: lefts.length ? Math.max(...lefts.map(box => box[2])) + gap : pad,
            right: rights.length ? Math.min(...rights.map(box => box[0])) - gap : this.width - pad,
        };
        const hits = (scale: number, tx: number, ty: number) => outline.some(([ux, uy]) => {
            const x = ux * scale + tx;
            const y = uy * scale + ty;
            return obstacles.some(([x0, y0, x1, y1]) => x >= x0 - margin && x <= x1 + margin && y >= y0 - margin && y <= y1 + margin);
        });
        let best: { scale: number; tx: number; ty: number } | null = null;
        for (let mask = 0; mask < 16; mask++) {
            const x0 = mask & 1 ? edges.left : pad;
            const x1 = mask & 2 ? edges.right : this.width - pad;
            const y0 = mask & 4 ? edges.top : pad;
            const y1 = mask & 8 ? edges.bottom : this.height - pad;
            if (x1 - x0 < this.width * 0.4 || y1 - y0 < this.height * 0.4) continue;
            const fit = Math.min((x1 - x0) / (bx1 - bx0), (y1 - y0) / (by1 - by0));
            const place = (scale: number) => ({ scale, tx: (x0 + x1) / 2 - (bx0 + bx1) / 2 * scale, ty: (y0 + y1) / 2 - (by0 + by1) / 2 * scale });
            let candidate = place(fit);
            for (let shrink = 0; shrink < 30 && hits(candidate.scale, candidate.tx, candidate.ty); shrink++) {
                if (candidate.scale * 0.97 < fit * 0.5) break;
                candidate = place(candidate.scale * 0.97);
            }
            if (hits(candidate.scale, candidate.tx, candidate.ty)) continue;
            // Prefer the larger map; on a near tie, the more centred one.
            if (!best || candidate.scale > best.scale * 1.02) best = candidate;
        }
        if (!best) return;
        // A band beside a corner panel pushes the map off-centre; slide it back as far as the land stays
        // clear (a panel may float over open ocean).
        // Sliding never pushes the map past the panel's edges (a full-height globe stays whole).
        const inside = (scale: number, tx: number, ty: number) => bx0 * scale + tx >= pad - 1 && bx1 * scale + tx <= this.width - pad + 1
            && by0 * scale + ty >= pad - 1 && by1 * scale + ty <= this.height - pad + 1;
        // Vertically, centre between the panels above and below the map's middle (the title, a row of
        // controls), not a side column that only sits beside it.
        const left = bx0 * best.scale + best.tx;
        const right = bx1 * best.scale + best.tx;
        const middle = [left + (right - left) * 0.2, right - (right - left) * 0.2];
        const across = (box: [number, number, number, number]) => box[0] < middle[1] && box[2] > middle[0];
        const above = tops.filter(across);
        const below = bottoms.filter(across);
        const bandTop = above.length ? Math.max(...above.map(box => box[3])) + gap : pad;
        const bandBottom = below.length ? Math.min(...below.map(box => box[1])) - gap : this.height - pad;
        // A slightly smaller centred map reads better than a larger off-centre one: give up to ~9% of scale.
        let moved = best;
        for (const shrink of [1, 0.97, 0.94, 0.91]) {
            const scale = best.scale * shrink;
            const centreX = this.width / 2 - (bx0 + bx1) / 2 * scale;
            const centreY = (bandTop + bandBottom) / 2 - (by0 + by1) / 2 * scale;
            const startX = best.tx + (bx0 + bx1) / 2 * (best.scale - scale);
            const startY = best.ty + (by0 + by1) / 2 * (best.scale - scale);
            let found: typeof best | null = null;
            let distance = Infinity;
            for (let ix = 0; ix <= 10; ix++) {
                for (let iy = 0; iy <= 10; iy++) {
                    const tx: number = startX + (centreX - startX) * ix / 10;
                    const ty: number = startY + (centreY - startY) * iy / 10;
                    const away = Math.hypot(centreX - tx, centreY - ty);
                    if (away < distance && inside(scale, tx, ty) && !hits(scale, tx, ty)) { found = { scale, tx, ty }; distance = away; }
                }
            }
            if (shrink === 1 && found) moved = found;
            if (found && distance <= this.width * 0.02) { moved = found; break; }
        }
        projection.scale(moved.scale).translate([moved.tx, moved.ty]);
    }

    /**
     * Keep the map anchored: no zooming out past the whole map, and no panning past its edges (a map
     * smaller than the panel stays centred). The globe only limits zoom; dragging rotates it.
     */
    private limitZoom(projection: d3.GeoProjection, name: ProjectionName) {
        const viewport: [[number, number], [number, number]] = [[0, 0], [this.width, this.height]];
        if (name === 'orthographic') {
            this.zoom.scaleExtent([1, 64]).translateExtent([[-Infinity, -Infinity], [Infinity, Infinity]]);
            return;
        }
        const basemap = this.scene?.basemap;
        // A flat world stops zooming out at its land, as it is framed.
        const whole = name === 'albersUsa' || (basemap && !basemap.name.startsWith('countries') && basemap.outline)
            ? (basemap?.outline as d3.GeoPermissibleObjects | undefined)
            : basemap?.name.startsWith('countries') && name !== 'mercator' ? this.worldLand() : SPHERE;
        let content: [[number, number], [number, number]] = viewport;
        if (whole) {
            const bounds = d3.geoPath(projection).bounds(whole);
            if (bounds.flat().every(Number.isFinite) && bounds[1][0] > bounds[0][0] && bounds[1][1] > bounds[0][1]) content = bounds;
        }
        // The extent covers the whole map and the fitted view, so the starting view is always allowed.
        const extent: [[number, number], [number, number]] = [
            [Math.min(content[0][0], 0), Math.min(content[0][1], 0)],
            [Math.max(content[1][0], this.width), Math.max(content[1][1], this.height)],
        ];
        // A map framed on its data can zoom out until the whole basemap shows, no further.
        const minK = Math.min(1, this.width / Math.max(this.width, content[1][0] - content[0][0]), this.height / Math.max(this.height, content[1][1] - content[0][1]));
        this.zoom.scaleExtent([Math.max(0.05, minK), 4096]).translateExtent(extent);
    }

    private startSpin() {
        this.stopSpin();
        let last = 0;
        this.spinTimer = d3.timer(elapsed => {
            if (elapsed - last < 50) return;
            const step = (elapsed - last) * 0.004;
            last = elapsed;
            this.base.rotate = [this.base.rotate[0] + step, this.base.rotate[1], this.base.rotate[2]];
            this.draw(false);
        });
    }

    /**
     * The rotation (degrees) for a flat world map. Like Datawrapper's world basemaps, the edge only ever runs
     * through open ocean from pole to pole, so no continent is split: the Pacific (0°, the familiar map) or
     * the Atlantic (−160°, Pacific-centred, edge near 20°W). The Pacific-centred map is used only when it cuts
     * fewer flows and tracks along their shortest (great-circle) routes.
     */
    private edgeRotation(): number {
        const routes: number[][] = [];
        for (const model of this.scene!.models) {
            if (model.layer.visible === false) continue;
            for (const mark of model.marks.slice(0, 1000)) {
                if (mark.at && mark.to) {
                    const interpolate = d3.geoInterpolate(mark.at, mark.to);
                    routes.push(d3.range(0, 1.0001, 1 / 24).map(t => interpolate(t)[0]));
                } else if (mark.line && mark.line.length > 1) routes.push(mark.line.map(point => point[0]));
            }
        }
        if (!routes.length) return 0;
        const wrap = (lon: number) => ((lon + 540) % 360) - 180;
        const cuts = (rotation: number) => routes.filter(route => route.some((lon, index) =>
            // A step that jumps more than half the world crosses the edge.
            index > 0 && Math.abs(wrap(lon + rotation) - wrap(route[index - 1] + rotation)) > 180)).length;
        return cuts(PACIFIC_CENTRED) < cuts(0) ? PACIFIC_CENTRED : 0;
    }

    private dataCenter(): LonLat | null {
        const points = this.scene!.models.flatMap(model => model.marks.map(mark => mark.at).filter((point): point is LonLat => !!point));
        if (!points.length) return null;
        return d3.geoCentroid({ type: 'MultiPoint', coordinates: points } as unknown as d3.GeoPermissibleObjects) as LonLat;
    }

    /** The world's land as one target, Antarctica only when the data includes it. */
    private worldLandCache: { key: string; target: d3.GeoPermissibleObjects } | null = null;
    private worldLand(): d3.GeoPermissibleObjects {
        const scene = this.scene!;
        const withAntarctica = scene.models.some(model => model.marks.some(mark => mark.regionId === 'ATA'));
        const key = `${scene.basemap!.name}:${withAntarctica}`;
        if (this.worldLandCache?.key !== key) {
            const features = scene.basemap!.features.filter(item => withAntarctica || item.properties.id !== 'ATA');
            this.worldLandCache = { key, target: { type: 'FeatureCollection', features } as d3.GeoPermissibleObjects };
        }
        return this.worldLandCache.target;
    }

    /** What the map frames: the data (default) or the basemap. */
    private fitTarget(name: ProjectionName): d3.GeoPermissibleObjects {
        const scene = this.scene!;
        const basemapTarget = (): d3.GeoPermissibleObjects => {
            if (scene.basemap?.outline) {
                if (scene.basemap.name.startsWith('countries')) {
                    if (name === 'mercator') return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-179.9, -58], [179.9, -58], [179.9, 78], [-179.9, 78], [-179.9, -58]]] } } as d3.GeoPermissibleObjects;
                    // A flat world frames its land, not the whole sphere: without Antarctica it is wider
                    // (about 2.3:1) and wastes no band of empty Southern Ocean (as Our World in Data does).
                    return name === 'orthographic' ? SPHERE : this.worldLand();
                }
                return scene.basemap.outline as d3.GeoPermissibleObjects;
            }
            return name === 'albersUsa' ? { type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: [[-124.7, 49.4], [-66.9, 24.5], [-160, 19], [-150, 61]] } } as d3.GeoPermissibleObjects : SPHERE;
        };
        if (scene.view.fit === 'basemap') return basemapTarget();
        const features: Feature[] = [];
        const points: LonLat[] = [];
        for (const model of scene.models) {
            if (model.layer.visible === false) continue;
            for (const mark of model.marks) {
                if (mark.feature && model.layer.type === 'regions' || model.layer.type === 'shapes') { if (mark.feature) features.push(mark.feature); }
                else if (mark.line) points.push(...mark.line);
                else {
                    if (mark.at) points.push(mark.at);
                    if (mark.to) points.push(mark.to);
                }
            }
        }
        if (!features.length && !points.length) return basemapTarget();
        // Regions covering most of the basemap frame the whole basemap (bounds across the antimeridian mislead).
        if (scene.basemap && features.length >= 0.4 * scene.basemap.features.length) return basemapTarget();
        const collection = {
            type: 'FeatureCollection',
            features: [...features, ...(points.length ? [{ type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: points } } as Feature] : [])],
        } as FeatureCollection;
        const [[west, south], [east, north]] = d3.geoBounds(collection);
        const lonSpan = east >= west ? east - west : 360 + east - west;
        // Data spread over most of the world frames the whole basemap.
        if (lonSpan > 250 && north - south > 90) return basemapTarget();
        // A single point (or a tiny cluster) frames a small area around it.
        if (lonSpan < 0.02 && north - south < 0.02) {
            const [lon, lat] = points[0] ?? d3.geoCentroid(collection);
            return { type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: [[lon - 0.05, lat - 0.05], [lon + 0.05, lat + 0.05]] } } as d3.GeoPermissibleObjects;
        }
        return collection as d3.GeoPermissibleObjects;
    }

    /** Apply the zoom transform to the fitted projection: pan/scale on flat maps, rotate on the globe. */
    private currentProjection(): d3.GeoProjection {
        const projection = this.baseProjection();
        const t = this.transform;
        if (viewProjection(this.scene!.view) === 'orthographic') {
            const scale = this.base.scale * t.k;
            const radians = 180 / Math.PI;
            const lambda = this.base.rotate[0] + (t.x / scale) * radians;
            const phi = Math.max(-90, Math.min(90, this.base.rotate[1] - (t.y / scale) * radians));
            projection.scale(scale).rotate([lambda, phi, this.base.rotate[2]]).translate(this.base.translate);
        } else {
            projection.scale(this.base.scale * t.k).translate([this.base.translate[0] * t.k + t.x, this.base.translate[1] * t.k + t.y]);
            // Zoomed in, clip far off-screen geometry so detailed boundaries stay cheap (with room for a pan).
            if (viewProjection(this.scene!.view) !== 'albersUsa' && t.k > 1.5) {
                projection.clipExtent([[-this.width, -this.height], [2 * this.width, 2 * this.height]]);
            }
        }
        return projection;
    }

    private visible(point: LonLat): boolean {
        if (!this.scene || viewProjection(this.scene.view) !== 'orthographic') return true;
        const [lambda, phi] = this.projection.rotate();
        return d3.geoDistance(point, [-lambda, -phi]) < Math.PI / 2 - 0.01;
    }

    private draw(animate: boolean) {
        const scene = this.scene;
        if (!scene || !this.width || !this.height) return;
        this.projection = this.currentProjection();
        const projection = this.projection;
        const path = d3.geoPath(projection);
        this.root.attr('transform', null);
        this.canvas.style.transform = '';
        this.drawnTransform = this.transform;
        // Albers USA is a composite projection without rotate().
        this.projectionKey = JSON.stringify([projection.scale(), projection.translate(), typeof projection.rotate === 'function' ? projection.rotate() : 0]);
        this.states.clear();
        this.heavy = (scene.basemap?.features.length ?? 0) + scene.models.reduce((count, model) => count + model.marks.length, 0) > 1500
            || !!scene.basemap?.name.startsWith('countries') && this.transform.k > 2;
        this.callbacks.onScale?.(2 * Math.PI * projection.scale());
        const name = viewProjection(scene.view);
        const tiles = scene.view.tiles && scene.view.tiles !== 'none' ? scene.view.tiles : null;
        // Transitions only on small maps; thousands of animated paths stutter.
        const duration = animate && scene.models.reduce((count, model) => count + model.marks.length, 0) <= 800 ? 300 : 0;

        const style = this.style;
        this.svg.style('background', frameBackground(style, name));
        // Ocean / sphere outline.
        const ocean = this.root.select<SVGGElement>('.df-map-ocean');
        // Quiet styles leave flat oceans unpainted: the land floats, and panels never cut an outline.
        const showSphere = !tiles && name !== 'albersUsa' && !!scene.basemap?.name.startsWith('countries')
            && (name === 'orthographic' || style.sphere);
        ocean.selectAll<SVGPathElement, unknown>('path').data(showSphere ? [SPHERE] : [])
            .join('path').attr('d', path as never).attr('fill', style.ocean).attr('stroke', style.coast).attr('stroke-width', 0.6);

        this.drawTiles(tiles, projection);

        const graticule = this.root.select<SVGGElement>('.df-map-graticule');
        graticule.selectAll<SVGPathElement, unknown>('path').data(scene.view.graticule && !tiles ? [d3.geoGraticule10()] : [])
            .join('path').attr('d', path as never).attr('fill', 'none').attr('stroke', style.graticule).attr('stroke-width', 0.5);

        // Basemap regions (no data), then their borders on top of the data layers.
        const land = this.root.select<SVGGElement>('.df-map-land');
        const regionsLayerIds = new Set(scene.models.filter(model => model.layer.type === 'regions' && model.layer.visible !== false && model.geoSet === scene.basemap).map(model => model.layer.id));
        // Antarctica only takes room on world maps, unless the data includes it.
        const showsAntarctica = scene.models.some(model => model.marks.some(mark => mark.regionId === 'ATA'));
        const landFeatures = (scene.basemap?.features ?? []).filter(item => showsAntarctica || item.properties.id !== 'ATA');
        const landPaths = land.selectAll<SVGPathElement, Feature>('path').data(tiles ? [] : landFeatures, item => String(item.id))
            .join('path').attr('fill', regionsLayerIds.size ? style.noData : style.land)
            .attr('stroke', 'none');
        this.setPath(landPaths, item => item, path);
        const borders = this.root.select<SVGGElement>('.df-map-borders');
        // Interior borders, then the coastline (the land's outline) a shade darker.
        const outlines = [
            ...(scene.basemap?.borders ? [{ kind: 'border', shape: scene.basemap.borders as unknown }] : []),
            ...(scene.basemap?.disputedBorders ? [{ kind: 'disputed', shape: scene.basemap.disputedBorders as unknown }] : []),
            ...(scene.basemap?.outline && !tiles ? [{ kind: 'coast', shape: (showsAntarctica ? scene.basemap.outline
                : scene.basemap.outlineWithoutAntarctica ?? scene.basemap.outline) as unknown }] : []),
        ];
        const borderPaths = borders.selectAll<SVGPathElement, { kind: string; shape: unknown }>('path').data(outlines, item => item.kind)
            .join('path').attr('fill', 'none').attr('vector-effect', 'non-scaling-stroke')
            // Disputed borders are dotted grey, as on Datawrapper's world maps: visible on any fill.
            .attr('stroke', item => item.kind === 'disputed' ? (style.mode === 'dark' ? '#8a939b' : '#888888')
                : tiles ? 'rgba(80,80,80,0.35)' : item.kind === 'coast' ? style.coast : style.border)
            .attr('stroke-width', item => item.kind === 'disputed' ? 1.2 : item.kind === 'coast' ? 0.6 : tiles ? 0.6 : 0.7).attr('stroke-linejoin', 'round')
            .attr('stroke-linecap', item => item.kind === 'disputed' ? 'round' : null)
            .attr('stroke-dasharray', item => item.kind === 'disputed' ? '0.5,3' : null)
            .style('pointer-events', 'none');
        this.setPath(borderPaths, item => item.shape, path);

        const layers = this.root.select<SVGGElement>('.df-map-layers');
        const visibleModels = scene.models.filter(model => model.layer.visible !== false);
        const groups = layers.selectAll<SVGGElement, LayerModel>('g.df-map-layer').data(visibleModels, model => model.layer.id)
            .join('g').attr('class', 'df-map-layer').attr('data-layer', model => model.layer.id)
            .attr('opacity', model => model.layer.opacity ?? (model.layer.type === 'heatmap' ? 0.75 : 1));
        groups.order();
        this.canvasMarks = [];
        this.positions.clear();
        this.circleBoxes = [];
        const dynamicLegends: Record<string, LegendModel | null> = {};
        const labelCandidates: Label[] = [];
        groups.each((model, index, nodes) => {
            const group = d3.select<SVGGElement, LayerModel>(nodes[index]) as unknown as d3.Selection<SVGGElement, LayerModel, null, undefined>;
            const legend = this.drawLayer(group, model, path, duration, labelCandidates);
            if (legend !== undefined) dynamicLegends[model.layer.id] = legend;
        });
        this.drawCanvas();
        if (scene.view.labels !== false && !tiles && scene.interactive) this.placeLabels(landFeatures, path, labelCandidates);
        this.drawLabels(labelCandidates);
        const legendKey = JSON.stringify(Object.entries(dynamicLegends).map(([id, legend]) => [id, legend && 'items' in legend ? legend.items.map(item => item.label) : legend && 'domain' in legend ? legend.domain : null]));
        if (legendKey !== this.dynamicLegendKey) {
            this.dynamicLegendKey = legendKey;
            this.callbacks.onDynamicLegends?.(dynamicLegends);
        }
    }

    private drawTiles(style: string | null, projection: d3.GeoProjection) {
        const group = this.root.select<SVGGElement>('.df-map-tiles');
        const definition = style ? TILE_STYLES[style] : null;
        if (!definition) { group.selectAll('image').remove(); return; }
        const origin = projection([-180, 85.05112878]);
        if (!origin) return;
        const size = 2 * Math.PI * projection.scale();
        const z = Math.max(0, Math.min(definition.maxZoom, Math.round(Math.log2(size / 256))));
        const count = 2 ** z;
        const tileSize = size / count;
        const tiles: { key: string; url: string; x: number; y: number }[] = [];
        const x0 = Math.floor(-origin[0] / tileSize);
        const x1 = Math.floor((this.width - origin[0]) / tileSize);
        const y0 = Math.max(0, Math.floor(-origin[1] / tileSize));
        const y1 = Math.min(count - 1, Math.floor((this.height - origin[1]) / tileSize));
        if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) return;
        for (let x = x0; x <= x1; x++) {
            for (let y = y0; y <= y1; y++) {
                const wrapped = ((x % count) + count) % count;
                tiles.push({ key: `${z}/${x}/${y}`, url: definition.url(z, wrapped, y), x: origin[0] + x * tileSize, y: origin[1] + y * tileSize });
            }
        }
        group.selectAll<SVGImageElement, typeof tiles[number]>('image').data(tiles, tile => tile.key)
            .join(enter => enter.append('image').attr('href', tile => tile.url).attr('preserveAspectRatio', 'none'))
            // Overlap by a pixel so tile seams do not show.
            .attr('x', tile => tile.x - 0.25).attr('y', tile => tile.y - 0.25)
            .attr('width', tileSize + 0.5).attr('height', tileSize + 0.5);
    }

    private markState(model: LayerModel, mark: Mark): { dim: boolean; selected: boolean; hidden: boolean } {
        let layerStates = this.states.get(model.layer.id);
        if (!layerStates) { layerStates = new Map(); this.states.set(model.layer.id, layerStates); }
        let state = layerStates.get(mark.key);
        if (!state) { state = this.computeMarkState(model, mark); layerStates.set(mark.key, state); }
        return state;
    }

    private computeMarkState(model: LayerModel, mark: Mark): { dim: boolean; selected: boolean; hidden: boolean } {
        const scene = this.scene!;
        const hiddenSet = scene.hidden[model.layer.id];
        const hidden = !!hiddenSet?.size && model.color.categorical && hiddenSet.has(String(mark.colorValue));
        const selection = scene.selection?.layerId === model.layer.id ? scene.selection : null;
        const selected = !!selection?.keys.has(mark.key);
        const highlight = scene.highlight?.layerId === model.layer.id ? scene.highlight : null;
        const dim = (!!selection && selection.keys.size > 0 && !selected) || (!!highlight && !highlight.test(mark));
        return { dim, selected, hidden };
    }

    private bindMarkEvents<E extends SVGElement>(selection: d3.Selection<E, Mark, SVGGElement, unknown>, model: LayerModel) {
        if (!this.scene?.interactive) return;
        selection
            .attr('data-mark', '')
            .style('cursor', 'pointer')
            .on('mousemove', (event: MouseEvent, mark) => this.callbacks.onHover({ layerId: model.layer.id, mark, model }, d3.pointer(event, this.svg.node()) as [number, number]))
            .on('mouseleave', () => this.callbacks.onHover(null, [0, 0]))
            .on('click', (event: MouseEvent, mark) => {
                event.stopPropagation();
                if (this.suppressClick) { this.suppressClick = false; return; }
                this.callbacks.onClick({ layerId: model.layer.id, mark, model }, event);
            })
            .on('dblclick', (event: MouseEvent, mark) => {
                event.stopPropagation();
                if (mark.feature && model.layer.zoomOnClick !== false) this.zoomTo(mark.feature);
                else if (mark.at) this.zoomTo(mark.at);
            });
    }

    /** Draw one layer; returns a legend for zoom-dependent layers (hexbin, heatmap). */
    private drawLayer(group: d3.Selection<SVGGElement, LayerModel, null, undefined>, model: LayerModel, path: d3.GeoPath,
        duration: number, labels: Label[]): LegendModel | null | undefined {
        const projection = this.projection;
        const { layer } = model;
        const type = layer.type;
        const stroke = layer.stroke;
        const project = (point: LonLat | undefined) => point && this.visible(point) ? projection(point) as [number, number] | null : null;
        // A layer whose mark type changed (an edit) starts empty: old marks would never be redrawn.
        if (group.attr('data-type') !== type) group.selectAll('*').remove();
        group.attr('data-type', type);

        if (type === 'regions' || type === 'shapes') {
            const regions = group.selectAll<SVGPathElement, Mark>('path.df-map-region').data(model.marks, mark => mark.key)
                .join('path').attr('class', 'df-map-region').attr('stroke-linejoin', 'round').attr('vector-effect', 'non-scaling-stroke');
            this.setPath(regions, mark => mark.feature, path);
            const fill = (mark: Mark) => model.color.color(mark.colorValue);
            (duration ? regions.transition().duration(duration) as unknown as typeof regions : regions).attr('fill', mark => this.markState(model, mark).hidden ? this.style.noData : fill(mark));
            regions
                .attr('fill-opacity', mark => this.markState(model, mark).dim ? 0.3 : 1)
                // Regions on other boundaries than the basemap's draw their own hairline borders.
                .attr('stroke', mark => this.markState(model, mark).selected ? this.style.selection
                    : stroke ?? (type === 'shapes' || model.geoSet !== this.scene?.basemap ? this.style.border : 'none'))
                .attr('stroke-width', mark => this.markState(model, mark).selected ? 1.6 : 0.6);
            regions.filter(mark => this.markState(model, mark).selected).raise();
            this.bindMarkEvents(regions, model);
            if (layer.text) {
                for (const mark of model.marks) {
                    const point = project(mark.at);
                    if (point && mark.text) labels.push({ x: point[0], y: point[1], text: mark.text, priority: d3.geoArea(mark.feature as never), model,
                        fill: this.markState(model, mark).hidden ? undefined : model.color.color(mark.colorValue) });
                }
            }
            return undefined;
        }

        if (type === 'heatmap') return this.drawHeatmap(group, model, project);
        if (type === 'hexbin') return this.drawHexbin(group, model, project);

        if (type === 'flows' || type === 'paths') {
            const direction = layer.direction ?? 'none';
            const curve = layer.curve ?? (this.isGlobe ? 'great-circle' : 'arc');
            // Points along the line on screen, origin first: the arrowhead's heading and the taper's outline.
            const samples = (mark: Mark): [number, number][] => {
                if (type === 'paths' && mark.line) return mark.line.map(project).filter((point): point is [number, number] => !!point);
                if (!mark.at || !mark.to) return [];
                if (curve === 'great-circle') {
                    const interpolate = d3.geoInterpolate(mark.at, mark.to);
                    return d3.range(0, 1.0001, 1 / 40).map(t => project(interpolate(t) as LonLat)).filter((point): point is [number, number] => !!point);
                }
                const from = project(mark.at);
                const to = project(mark.to);
                if (!from || !to) return [];
                const control = arcControl(from, to, curve);
                return d3.range(0, 1.0001, 1 / 24).map(t => [
                    (1 - t) ** 2 * from[0] + 2 * (1 - t) * t * control[0] + t ** 2 * to[0],
                    (1 - t) ** 2 * from[1] + 2 * (1 - t) * t * control[1] + t ** 2 * to[1],
                ] as [number, number]);
            };
            const lineData = model.marks.map(mark => {
                let d = '';
                let points: [number, number][] = [];
                if (direction === 'taper' || direction === 'arrow' || type === 'paths') points = samples(mark);
                if (direction === 'taper') d = taperPath(points, Math.max(1, model.size.size(mark.sizeValue)));
                else if (type === 'paths' && mark.line) d = path({ type: 'LineString', coordinates: mark.line } as never) ?? '';
                else if (mark.at && mark.to && curve === 'great-circle') d = path({ type: 'LineString', coordinates: [mark.at, mark.to] } as never) ?? '';
                else if (mark.at && mark.to) {
                    const from = project(mark.at);
                    const to = project(mark.to);
                    if (from && to) {
                        const control = arcControl(from, to, curve);
                        d = `M${from[0]},${from[1]}Q${control[0]},${control[1]} ${to[0]},${to[1]}`;
                    }
                }
                return { mark, d, points };
            }).filter(item => item.d);
            // Small flows over large ones (Dent; Jenny et al. 2017), so the big ones never bury the rest.
            const sorted = lineData.sort((a, b) => model.size.size(b.mark.sizeValue) - model.size.size(a.mark.sizeValue));
            // Lines stay nearly opaque, as most published flow maps draw them; crossings separate by a casing
            // in the frame colour under each line, not by transparency. Only crowded maps fade (to 0.55).
            const shown = sorted.filter(item => !this.markState(model, item.mark).hidden).length;
            const base = Math.max(0.55, Math.min(0.92, 0.92 - 0.11 * Math.log2(Math.max(1, shown / 12))));
            // Dashed (animated) lines show the map through their gaps; a casing would fill them white.
            const cased = direction !== 'taper' && direction !== 'animate';
            // White on light styles and the page's dark on dark ones, flat or globe: a halo in the water's colour
            // would trace a blue outline over the land.
            const halo = this.style.mode === 'dark' ? this.style.page : '#ffffff';
            const casings = group.selectAll<SVGPathElement, { mark: Mark; d: string }>('path.df-map-casing')
                .data(cased ? sorted.filter(item => !this.markState(model, item.mark).hidden) : [], item => item.mark.key)
                .join('path').attr('class', 'df-map-casing').attr('fill', 'none').attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round')
                .style('pointer-events', 'none')
                .attr('d', item => item.d).attr('stroke', halo).attr('stroke-opacity', item => this.markState(model, item.mark).dim ? 0.3 : Math.min(0.9, base + 0.05))
                .attr('stroke-width', item => Math.max(0.5, model.size.size(item.mark.sizeValue)) + (type === 'paths' ? 3 : 2));
            const lines = group.selectAll<SVGPathElement, Mark>('path.df-map-line').data(sorted.map(item => item.mark), mark => mark.key)
                .join('path').attr('class', 'df-map-line').attr('fill', 'none').attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
            const ds = new Map(sorted.map(item => [item.mark.key, item.d]));
            const opacity = (mark: Mark) => {
                const state = this.markState(model, mark);
                return state.hidden ? 0 : state.dim ? 0.12 : state.selected ? 1 : base;
            };
            const ink = (mark: Mark) => this.markState(model, mark).selected ? this.style.selection : model.color.color(mark.colorValue);
            const tapered = direction === 'taper';
            lines.attr('d', mark => ds.get(mark.key) ?? '')
                // A taper is a filled outline; the other lines are strokes.
                .attr('fill', mark => tapered ? ink(mark) : 'none').attr('fill-opacity', mark => tapered ? opacity(mark) : null)
                // A taper's casing is a thin halo around its outline.
                .attr('stroke', mark => tapered ? halo : ink(mark)).attr('paint-order', tapered ? 'stroke' : null)
                .attr('stroke-width', mark => tapered ? 1.5 : Math.max(0.5, model.size.size(mark.sizeValue)))
                .attr('stroke-opacity', mark => opacity(mark))
                .attr('stroke-dasharray', direction === 'animate' ? '6 9' : null)
                .style('animation', () => direction === 'animate' ? 'df-map-flow 0.9s linear infinite' : null);
            if (direction === 'animate') this.ensureFlowAnimation();
            // Each line directly over its own casing, in draw order, so a small flow crossing a big one
            // cuts a clean gap through it.
            const casingOf = new Map<string, SVGPathElement>();
            casings.each(function (item) { casingOf.set(item.mark.key, this); });
            const parent = group.node()!;
            lines.order().each(function (mark) {
                const casing = casingOf.get(mark.key);
                if (casing) parent.appendChild(casing);
                parent.appendChild(this);
            });
            this.bindMarkEvents(lines, model);
            // Arrowheads at the destination (or a path's last point), as wide as the line allows.
            const heads = group.selectAll<SVGPathElement, { mark: Mark; points: [number, number][] }>('path.df-map-arrow')
                .data(direction === 'arrow' ? sorted.filter(item => item.points.length >= 2 && !this.markState(model, item.mark).hidden) : [], item => item.mark.key)
                .join('path').attr('class', 'df-map-arrow').style('pointer-events', 'none')
                .attr('d', item => arrowHead(item.points, model.size.size(item.mark.sizeValue)))
                .attr('fill', item => ink(item.mark)).attr('fill-opacity', item => Math.min(1, opacity(item.mark) + 0.1))
                // A hairline halo keeps heads apart where several flows arrive at one place.
                .attr('stroke', halo).attr('stroke-width', 1).attr('stroke-linejoin', 'round').attr('paint-order', 'stroke');
            heads.raise();
            // A track starts at a hollow dot and is named there, in its own colour: it reads "from here, that way".
            const starts = type === 'paths' ? sorted.filter(item => item.points.length >= 2 && !this.markState(model, item.mark).hidden) : [];
            group.selectAll<SVGCircleElement, { mark: Mark; points: [number, number][] }>('circle.df-map-start').data(starts, item => item.mark.key)
                .join('circle').attr('class', 'df-map-start').style('pointer-events', 'none')
                .attr('cx', item => item.points[0][0]).attr('cy', item => item.points[0][1])
                .attr('r', item => Math.max(2.5, model.size.size(item.mark.sizeValue) * 0.9))
                .attr('fill', halo).attr('stroke', item => ink(item.mark)).attr('stroke-width', item => Math.max(1.2, model.size.size(item.mark.sizeValue) * 0.6))
                .attr('opacity', item => this.markState(model, item.mark).dim ? 0.3 : 1)
                .raise();
            if (layer.group && starts.length <= 20) {
                for (const { mark, points } of starts) {
                    // Beside the start, away from where the track heads.
                    const [x0, y0] = points[0];
                    const next = points.find(point => Math.hypot(point[0] - x0, point[1] - y0) > 6) ?? points[1];
                    const length = Math.hypot(next[0] - x0, next[1] - y0) || 1;
                    const [ux, uy] = [(x0 - next[0]) / length, (y0 - next[1]) / length];
                    const half = textWidth(mark.label, 11) / 2;
                    const offset = 8 + half * Math.abs(ux);
                    // Kept inside the frame: a track starting at the edge is named just inside it.
                    const x = Math.min(this.width - half - 6, Math.max(half + 6, x0 + ux * offset));
                    labels.push({ x, y: y0 + uy * 12, text: mark.label, priority: 1000 + model.size.size(mark.sizeValue), model,
                        ink: d3.color(ink(mark))?.darker(0.6).formatHex() });
                }
            }
            // Path heads, unless an arrow or taper already shows where they end.
            const ends = group.selectAll<SVGCircleElement, Mark>('circle.df-map-end').data(type === 'flows' || direction === 'arrow' || direction === 'taper' ? []
                : model.marks.filter(mark => !this.markState(model, mark).hidden), mark => mark.key)
                .join('circle').attr('class', 'df-map-end')
                .attr('r', mark => Math.max(1.8, model.size.size(mark.sizeValue) * 0.75))
                .attr('fill', mark => model.color.color(mark.colorValue))
                .attr('opacity', mark => this.markState(model, mark).dim ? 0.15 : 0.9)
                .style('pointer-events', 'none')
                .each(function (mark) {
                    const point = project(mark.at);
                    d3.select(this).attr('display', point ? null : 'none').attr('cx', point?.[0] ?? 0).attr('cy', point?.[1] ?? 0);
                });
            ends.raise();
            // Flows start and end at places: a node dot at each, once per place, drawn under the arrowheads.
            // Flows anchored to nodes are read far more accurately than ones fading into an area. A hub (the
            // place most flows share) gets a larger dot and a bold name, as editorial route maps do.
            type Node = { x: number; y: number; color: string; dim: boolean; name: string; flows: number; volume: number };
            const nodes = new Map<string, Node>();
            if (type === 'flows') {
                for (const mark of model.marks) {
                    if (this.markState(model, mark).hidden) continue;
                    [mark.at, mark.to].forEach((end, index) => {
                        const point = project(end);
                        if (!point) return;
                        const key = `${Math.round(point[0])},${Math.round(point[1])}`;
                        const dim = this.markState(model, mark).dim;
                        const node = nodes.get(key) ?? { x: point[0], y: point[1], color: ink(mark), dim, name: mark.ends?.[index] ?? '', flows: 0, volume: 0 };
                        node.flows += 1;
                        node.volume += Number(mark.sizeValue) || 1;
                        if (node.dim && !dim) Object.assign(node, { dim, color: ink(mark) });
                        nodes.set(key, node);
                    });
                }
            }
            const ranked = Array.from(nodes.values()).sort((a, b) => b.flows - a.flows);
            const hub = ranked.length > 3 && ranked[0].flows >= 3 && ranked[0].flows > 2 * (ranked[1]?.flows ?? 0) ? ranked[0] : null;
            group.selectAll<SVGCircleElement, [string, Node]>('circle.df-map-node')
                .data(Array.from(nodes), ([key]) => key)
                .join('circle').attr('class', 'df-map-node').style('pointer-events', 'none')
                .attr('cx', ([, node]) => node.x).attr('cy', ([, node]) => node.y).attr('r', ([, node]) => node === hub ? 4.5 : 2.6)
                .attr('fill', ([, node]) => node === hub ? this.style.text : node.color).attr('stroke', halo).attr('stroke-width', ([, node]) => node === hub ? 1.5 : 1)
                .attr('opacity', ([, node]) => node.dim ? 0.2 : 1)
                .lower();
            group.selectAll<SVGCircleElement, [string, Node]>('circle.df-map-node').filter(([, node]) => node === hub).raise();
            // Names beside the places when there are few enough to read: the hub always, then the busiest.
            if (ranked.length <= 40) {
                for (const node of ranked) {
                    if (!node.name || node.dim) continue;
                    labels.push({ x: node.x, y: node.y - (node === hub ? 13 : 9), text: node.name, size: node === hub ? 12 : 10,
                        priority: node === hub ? 1e9 : 1e6 + node.volume, model, strong: node === hub });
                }
            }
            return undefined;
        }

        // Point-like marks: bubbles, points, spikes, labels, vectors.
        const placed = model.marks.map(mark => ({ mark, point: project(mark.at) })).filter(item => item.point && !this.markState(model, item.mark).hidden) as { mark: Mark; point: [number, number] }[];
        if (type === 'vectors') {
            const vectors = group.selectAll<SVGPathElement, Mark>('path.df-map-vector').data(placed.map(item => item.mark), mark => mark.key)
                .join('path').attr('class', 'df-map-vector');
            const points = new Map(placed.map(item => [item.mark.key, item.point]));
            vectors.attr('d', mark => {
                const [x, y] = points.get(mark.key)!;
                const [ux, uy] = this.screenHeading(mark.at!, mark.angle ?? 0, [x, y]);
                const half = model.size.size(mark.sizeValue) / 2;
                return arrowPath(x - ux * half, y - uy * half, x + ux * half, y + uy * half);
            })
                .attr('fill', 'none').attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round')
                .attr('stroke', mark => this.markState(model, mark).selected ? this.style.selection : model.color.color(mark.colorValue))
                .attr('stroke-width', mark => this.markState(model, mark).selected ? 2 : 1.3)
                .attr('stroke-opacity', mark => this.markState(model, mark).dim ? 0.2 : 0.9);
            this.bindMarkEvents(vectors, model);
            return undefined;
        }
        if (type === 'labels') {
            group.selectAll('*').remove();
            for (const item of placed) {
                labels.push({ x: item.point[0], y: item.point[1], text: item.mark.text ?? item.mark.label, priority: Number(item.mark.sizeValue ?? item.mark.colorValue ?? 0) || 0, model });
            }
            return undefined;
        }
        if (type === 'points' && placed.length > CANVAS_THRESHOLD) {
            group.selectAll('*').remove();
            for (const item of placed) this.canvasMarks.push({ model, mark: item.mark, x: item.point[0], y: item.point[1], r: model.size.size(item.mark.sizeValue) });
            return undefined;
        }
        if (type === 'spikes') {
            const width = 7;
            const spikes = group.selectAll<SVGPathElement, Mark>('path.df-map-spike').data(placed.sort((a, b) => a.point[1] - b.point[1]).map(item => item.mark), mark => mark.key)
                .join('path').attr('class', 'df-map-spike');
            const points = new Map(placed.map(item => [item.mark.key, item.point]));
            (duration ? spikes.transition().duration(duration) as unknown as typeof spikes : spikes).attr('d', mark => {
                const [x, y] = points.get(mark.key)!;
                const h = model.size.size(mark.sizeValue);
                return `M${x - width / 2},${y}L${x},${y - h}L${x + width / 2},${y}`;
            });
            spikes.attr('fill', mark => model.color.color(mark.colorValue)).attr('fill-opacity', mark => this.markState(model, mark).dim ? 0.15 : 0.65)
                .attr('stroke', mark => this.markState(model, mark).selected ? this.style.selection : model.color.color(mark.colorValue))
                .attr('stroke-width', mark => this.markState(model, mark).selected ? 1.5 : 0.8);
            spikes.order();
            this.bindMarkEvents(spikes, model);
            return undefined;
        }
        const bubbles = type === 'bubbles';
        if (bubbles && layer.layout === 'dorling' && placed.length <= 2000) {
            // Spread circles apart around their true positions (a Dorling cartogram).
            const nodes = placed.map(item => ({ item, x: item.point[0], y: item.point[1], tx: item.point[0], ty: item.point[1], r: model.size.size(item.mark.sizeValue) }));
            const simulation = d3.forceSimulation(nodes)
                .force('x', d3.forceX<typeof nodes[number]>(node => node.tx).strength(0.4))
                .force('y', d3.forceY<typeof nodes[number]>(node => node.ty).strength(0.4))
                .force('collide', d3.forceCollide<typeof nodes[number]>(node => node.r + 1).iterations(3))
                .stop();
            for (let tick = 0; tick < 120; tick++) simulation.tick();
            for (const node of nodes) node.item.point = [node.x, node.y];
        }
        const sorted = placed.sort((a, b) => model.size.size(b.mark.sizeValue) - model.size.size(a.mark.sizeValue));
        // On a globe, marks lie on the surface: circles drawn on the sphere foreshorten toward the edge and
        // are clipped at the horizon, instead of flat discs hanging off it. (Dorling spreads screen discs.)
        const onSphere = this.isGlobe && layer.layout !== 'dorling';
        const circles = group.selectAll<SVGCircleElement, Mark>('circle.df-map-point').data(onSphere ? [] : sorted.map(item => item.mark), mark => mark.key)
            .join('circle').attr('class', 'df-map-point');
        const discs = group.selectAll<SVGPathElement, Mark>('path.df-map-disc').data(onSphere ? sorted.map(item => item.mark) : [], mark => mark.key)
            .join('path').attr('class', 'df-map-disc');
        if (onSphere) {
            // A pixel radius at the globe's centre, as degrees of arc.
            const degreesPerPixel = 180 / Math.PI / projection.scale();
            const circle = d3.geoCircle().precision(4);
            discs.attr('d', mark => path(circle.center(mark.at!).radius(Math.max(0.01, model.size.size(mark.sizeValue) * degreesPerPixel))()) ?? '')
                .attr('fill', mark => model.color.color(mark.colorValue))
                .attr('fill-opacity', mark => this.markState(model, mark).dim ? 0.25 : bubbles ? 0.78 : 0.85)
                .attr('stroke', mark => this.markState(model, mark).selected ? this.style.selection : stroke ?? (bubbles ? (this.style.mode === 'dark' ? 'rgba(0,0,0,0.45)' : '#ffffff') : 'none'))
                .attr('stroke-width', mark => this.markState(model, mark).selected ? 1.6 : bubbles ? 1 : 0);
            discs.order();
            this.bindMarkEvents(discs, model);
        }
        const points = new Map(sorted.map(item => [item.mark.key, item.point]));
        this.positions.set(layer.id, points);
        for (const item of sorted) {
            const radius = model.size.size(item.mark.sizeValue);
            if (radius >= 3) this.circleBoxes.push([item.point[0] - radius, item.point[1] - radius, item.point[0] + radius, item.point[1] + radius]);
        }
        circles.attr('cx', mark => points.get(mark.key)![0]).attr('cy', mark => points.get(mark.key)![1]);
        (duration ? circles.transition().duration(duration) as unknown as typeof circles : circles)
            .attr('r', mark => model.size.size(mark.sizeValue))
            .attr('fill', mark => model.color.color(mark.colorValue));
        circles
            .attr('fill-opacity', mark => this.markState(model, mark).dim ? 0.25 : bubbles ? 0.78 : 0.85)
            .attr('stroke', mark => this.markState(model, mark).selected ? this.style.selection : stroke ?? (bubbles ? (this.style.mode === 'dark' ? 'rgba(0,0,0,0.45)' : '#ffffff') : 'none'))
            .attr('stroke-width', mark => this.markState(model, mark).selected ? 1.6 : bubbles ? 1 : 0);
        circles.order();
        this.bindMarkEvents(circles, model);
        if (layer.text) {
            for (const item of sorted) {
                if (!item.mark.text) continue;
                const radius = model.size.size(item.mark.sizeValue);
                // A label goes inside a circle only if it fits (at 11px, else 9px); otherwise above it, with a halo.
                const size = [11, 9].find(candidate => textWidth(item.mark.text!, candidate) + 4 <= 2 * radius * 0.9 && candidate + 2 <= 2 * radius * 0.8);
                const inside = bubbles && size !== undefined;
                labels.push({ x: item.point[0], y: inside ? item.point[1] : item.point[1] - radius - 7, text: item.mark.text, priority: radius, model,
                    size: inside ? size : 11, fill: inside ? model.color.color(item.mark.colorValue) : undefined });
            }
        }
        return undefined;
    }

    private densityScheme(model: LayerModel) {
        const name = model.layer.color?.scheme;
        const key = name && Object.keys(SEQUENTIAL_SCHEMES).find(scheme => scheme.toLowerCase() === name.toLowerCase());
        const interpolate = SEQUENTIAL_SCHEMES[key ?? 'ylOrRd'];
        return (t: number) => interpolate(model.layer.color?.reverse ? 1 - t : t);
    }

    /** The keyframes that move dashes along animated flows, added once. */
    private ensureFlowAnimation() {
        if (!this.svg.select('style.df-map-flow-style').empty()) return;
        this.svg.insert('style', ':first-child').attr('class', 'df-map-flow-style')
            .text('@keyframes df-map-flow { to { stroke-dashoffset: -15; } } @media (prefers-reduced-motion: reduce) { .df-map-line { animation: none !important; } }');
    }

    /** A compass heading at a place as a unit vector on screen (north is not always up). */
    private screenHeading(at: LonLat, angle: number, point: [number, number]): [number, number] {
        const radians = angle * Math.PI / 180;
        const step = 0.05;
        const ahead = this.projection([at[0] + Math.sin(radians) * step / Math.max(0.05, Math.cos(at[1] * Math.PI / 180)), at[1] + Math.cos(radians) * step]);
        if (ahead && Number.isFinite(ahead[0]) && Number.isFinite(ahead[1])) {
            const length = Math.hypot(ahead[0] - point[0], ahead[1] - point[1]);
            if (length > 1e-9) return [(ahead[0] - point[0]) / length, (ahead[1] - point[1]) / length];
        }
        return [Math.sin(radians), -Math.cos(radians)];
    }

    private drawHeatmap(group: d3.Selection<SVGGElement, LayerModel, null, undefined>, model: LayerModel,
        project: (point: LonLat | undefined) => [number, number] | null): LegendModel | null {
        const points = model.marks.map(mark => ({ point: project(mark.at), weight: mark.weight ?? 1 })).filter(item => item.point) as { point: [number, number]; weight: number }[];
        const bandwidth = model.layer.radius ?? 18;
        const contours = points.length ? d3.contourDensity<{ point: [number, number]; weight: number }>()
            .x(item => item.point[0]).y(item => item.point[1]).weight(item => item.weight)
            .size([this.width, this.height]).bandwidth(bandwidth).thresholds(12)(points) : [];
        const max = d3.max(contours, contour => contour.value) ?? 1;
        const scheme = this.densityScheme(model);
        group.selectAll<SVGPathElement, d3.ContourMultiPolygon>('path').data(contours)
            .join('path').attr('d', d3.geoPath() as never).attr('fill', contour => scheme(0.15 + 0.85 * contour.value / max))
            .attr('fill-opacity', (contour, index) => index === 0 ? 0.35 : 0.55).attr('stroke', 'none').style('pointer-events', 'none');
        return points.length ? { kind: 'gradient', title: model.layer.name ?? this.strings.density, stops: d3.range(0, 1.0001, 0.1).map(t => scheme(0.15 + 0.85 * t)), domain: [0, 1],
            format: value => value === 0 ? this.strings.low : this.strings.high } : null;
    }

    private drawHexbin(group: d3.Selection<SVGGElement, LayerModel, null, undefined>, model: LayerModel,
        project: (point: LonLat | undefined) => [number, number] | null): LegendModel | null {
        const radius = model.layer.radius ?? 12;
        const dx = radius * Math.sqrt(3);
        const dy = radius * 1.5;
        const bins = new Map<string, { x: number; y: number; marks: Mark[] }>();
        for (const mark of model.marks) {
            const point = project(mark.at);
            if (!point) continue;
            const py = point[1] / dy;
            let pj = Math.round(py);
            const px = point[0] / dx - (pj & 1) / 2;
            let pi = Math.round(px);
            const py1 = py - pj;
            if (Math.abs(py1) * 3 > 1) {
                const px1 = px - pi;
                const pi2 = pi + (px < pi ? -1 : 1) / 2;
                const pj2 = pj + (py < pj ? -1 : 1);
                const px2 = px - pi2;
                const py2 = py - pj2;
                if (px1 * px1 + py1 * py1 > px2 * px2 + py2 * py2) { pi = pi2 + (pj & 1 ? 1 : -1) / 2; pj = pj2; }
            }
            const key = `${pi},${pj}`;
            let bin = bins.get(key);
            if (!bin) { bin = { x: (pi + (pj & 1) / 2) * dx, y: pj * dy, marks: [] }; bins.set(key, bin); }
            bin.marks.push(mark);
        }
        const colorField = model.colorField;
        const how = model.layer.color?.aggregate ?? (colorField ? 'mean' : 'count');
        const values = Array.from(bins.values()).map(bin => {
            if (!colorField || how === 'count') return d3.sum(bin.marks, mark => mark.weight ?? 1);
            const numbers = bin.marks.map(mark => Number(mark.colorValue)).filter(Number.isFinite);
            return how === 'sum' ? d3.sum(numbers) : how === 'max' ? d3.max(numbers) ?? 0 : how === 'min' ? d3.min(numbers) ?? 0 : d3.mean(numbers) ?? 0;
        });
        const max = d3.max(values) ?? 1;
        const scheme = this.densityScheme(model);
        const corners = d3.range(0, 2 * Math.PI, Math.PI / 3).map(angle => [Math.sin(angle) * radius * 0.96, -Math.cos(angle) * radius * 0.96]);
        const hexagon = `m${corners.map((corner, index) => {
            const previous = corners[(index + 5) % 6];
            return index === 0 ? `${corner[0]},${corner[1]}` : `${corner[0] - previous[0]},${corner[1] - previous[1]}`;
        }).join('l')}z`;
        const binList = Array.from(bins.values()).map((bin, index) => ({ ...bin, value: values[index], key: `${Math.round(bin.x)},${Math.round(bin.y)}` }));
        const hexes = group.selectAll<SVGPathElement, typeof binList[number]>('path').data(binList, bin => bin.key)
            .join('path').attr('d', bin => `M${bin.x},${bin.y}${hexagon}`)
            .attr('fill', bin => scheme(0.1 + 0.9 * (max ? bin.value / max : 0))).attr('fill-opacity', 0.85).attr('stroke', '#fff').attr('stroke-width', 0.4);
        if (this.scene?.interactive) {
            hexes.attr('data-mark', '').style('cursor', 'default')
                .on('mousemove', (event: MouseEvent, bin) => {
                    const mark: Mark = { key: bin.key, rows: bin.marks.flatMap(item => item.rows), label: this.strings.points(bin.marks.length), colorValue: bin.value };
                    this.callbacks.onHover({ layerId: model.layer.id, mark, model: { ...model, colorField: colorField && how !== 'count' ? `${how} ${colorField}` : 'count' } }, d3.pointer(event, this.svg.node()) as [number, number]);
                })
                .on('mouseleave', () => this.callbacks.onHover(null, [0, 0]));
        }
        if (!binList.length) return null;
        const title = model.layer.color?.title ?? (colorField && how !== 'count' ? `${how} ${colorField}` : model.layer.weight ? this.strings.total(model.layer.weight) : this.strings.perHexagon);
        const format = formatter(model.layer.color?.format);
        return { kind: 'gradient', title, stops: d3.range(0, 1.0001, 0.1).map(t => scheme(0.1 + 0.9 * t)), domain: [0, max], format: value => format(value) };
    }

    private drawCanvas() {
        const context = this.canvas.getContext('2d');
        if (!context) return;
        const ratio = window.devicePixelRatio || 1;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, this.width, this.height);
        this.quadtree = this.canvasMarks.length ? d3.quadtree(this.canvasMarks, item => item.x, item => item.y) : null;
        for (const item of this.canvasMarks) {
            const state = this.markState(item.model, item.mark);
            context.globalAlpha = state.dim ? 0.1 : 0.75;
            context.fillStyle = item.model.color.color(item.mark.colorValue);
            context.beginPath();
            context.arc(item.x, item.y, Math.max(0.8, item.r), 0, 2 * Math.PI);
            context.fill();
            if (state.selected) {
                context.globalAlpha = 1;
                context.strokeStyle = this.style.selection;
                context.lineWidth = 1.5;
                context.stroke();
            }
        }
        context.globalAlpha = 1;
    }

    private canvasHit(point: [number, number]): Hit | null {
        if (!this.quadtree) return null;
        const found = this.quadtree.find(point[0], point[1], 8);
        return found ? { layerId: found.model.layer.id, mark: found.mark, model: found.model } : null;
    }

    /** Draw labels by priority, skipping any that would overlap one already placed. */
    /**
     * Name the basemap's countries or states where the name fits inside them (states fall back to
     * postal codes), below data labels. Over a data fill the label takes the contrasting ink.
     */
    private placeLabels(features: Feature[], path: d3.GeoPath, labels: Label[]) {
        const basemap = this.scene?.basemap;
        if (!basemap || !(basemap.name.startsWith('countries') || basemap.name === 'us-states')) return;
        const fills = new Map<string, string>();
        const labelled = new Set<string>();
        for (const model of this.scene!.models) {
            if (model.layer.visible === false || model.geoSet !== basemap) continue;
            for (const mark of model.marks) {
                if (!mark.regionId) continue;
                // A place a layer already names (a region label, a bubble label) is not named twice.
                if (model.layer.text) labelled.add(mark.regionId);
                else if (model.layer.type === 'regions' && !this.markState(model, mark).hidden) fills.set(mark.regionId, model.color.color(mark.colorValue));
            }
        }
        const candidates: Label[] = [];
        for (const feature of features) {
            const properties = feature.properties as { id: string; name: string };
            if (labelled.has(properties.id)) continue;
            const [[x0, y0], [x1, y1]] = path.bounds(feature as never);
            const width = x1 - x0;
            const height = y1 - y0;
            if (!(width > 18 && height > 10) || x1 < 0 || x0 > this.width || y1 < 0 || y0 > this.height) continue;
            // A name needs comfortable room, so small countries stay unnamed until you zoom in.
            const fits = (text: string) => textWidth(text, 9.5) + 10 <= width * 0.6 && height >= 16;
            const text = fits(properties.name) ? properties.name : basemap.name === 'us-states' ? stateAbbr(properties.id) : undefined;
            if (!text || !fits(text)) continue;
            const anchor = featureAnchor(feature);
            if (!this.visible(anchor)) continue;
            const point = this.projection(anchor);
            if (!point) continue;
            candidates.push({ x: point[0], y: point[1], text, place: true, priority: -1e9 + width * height, fill: fills.get(properties.id) });
        }
        // A budget by map area keeps the basemap quiet: the largest places, more as the map zooms in.
        const budget = Math.max(6, Math.min(60, Math.round(this.width * this.height / 26000)));
        labels.push(...candidates.sort((a, b) => b.priority - a.priority).slice(0, budget));
    }

    private drawLabels(candidates: Label[]) {
        const group = this.root.select<SVGGElement>('.df-map-labels');
        const style = this.style;
        const placed: [number, number, number, number][] = [];
        const kept = candidates.filter(item => item.text && Number.isFinite(item.x) && Number.isFinite(item.y)
            && item.x > -50 && item.x < this.width + 50 && item.y > -20 && item.y < this.height + 20)
            .sort((a, b) => b.priority - a.priority)
            .filter(item => {
                const width = textWidth(item.text, item.size ?? (item.place ? 9.5 : 11)) + (item.place ? 16 : 4);
                const box: [number, number, number, number] = [item.x - width / 2, item.y - 8, item.x + width / 2, item.y + 6];
                const overlaps = (other: [number, number, number, number]) => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1];
                if (placed.some(overlaps)) return false;
                // Place names give way to bubbles; data labels belong on them.
                if (item.place && this.circleBoxes.some(overlaps)) return false;
                placed.push(box);
                return placed.length <= 300;
            });
        group.selectAll<SVGTextElement, typeof kept[number]>('text').data(kept)
            .join('text').attr('x', item => item.x).attr('y', item => item.y).text(item => item.text)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
            .attr('font-size', item => item.size ?? (item.place ? 9.5 : 11)).attr('font-family', 'var(--df-font, system-ui, sans-serif)')
            .attr('font-weight', item => item.strong ? 650 : item.place ? 400 : 500)
            .attr('letter-spacing', item => item.place ? '0.01em' : null)
            // On a filled region, labels take the contrasting ink and no halo; on the basemap, a halo.
            // Place names on a fill stay soft (they name, the colour speaks); data labels are firm.
            .attr('fill', item => item.fill ? (isDark(item.fill) ? `rgba(255,255,255,${item.place ? 0.72 : 0.92})` : `rgba(30,30,30,${item.place ? 0.5 : 0.78})`)
                : item.ink ?? (item.place ? style.placeLabel : style.text))
            .attr('stroke', item => item.fill ? 'none' : style.halo)
            .attr('stroke-width', item => item.fill ? 0 : 3).attr('paint-order', 'stroke').attr('stroke-linejoin', 'round')
            .style('pointer-events', 'none');
    }

    private onDoubleClick(event: MouseEvent) {
        const point = d3.pointer(event, this.svg.node());
        const inverted = this.projection.invert?.(point);
        if (!this.isGlobe && inverted) {
            this.svg.transition().duration(300).call(this.zoom.scaleBy, 2, point as [number, number]);
        } else {
            this.zoomBy(2);
        }
    }
}

export const ALL_SCHEMES = {
    sequential: Object.keys(SEQUENTIAL_SCHEMES),
    diverging: Object.keys(DIVERGING_SCHEMES),
    categorical: Object.keys(CATEGORICAL_SCHEMES),
};

export type { Geometry };
