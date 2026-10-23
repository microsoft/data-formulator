/**
 * Demos at /demo/<id>: the id is read from the path when the page loads, scopes browser
 * storage and is sent with every API request.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/app/oidcConfig', () => ({
    getAccessToken: vi.fn(async () => null),
    getUserManager: vi.fn(async () => null),
    isBackendAuth: vi.fn(async () => false),
}));
vi.mock('../../../../src/app/store', () => ({
    store: { getState: vi.fn(() => ({ identity: { type: 'browser', id: 'b1' }, activeWorkspace: null, serverConfig: {} })) },
}));
vi.mock('../../../../src/i18n', () => ({ default: { language: 'en' } }));

const loadAt = async (path: string) => {
    window.history.pushState({}, '', path);
    vi.resetModules();
    return {
        demo: await import('../../../../src/app/demo'),
        utils: await import('../../../../src/app/utils'),
    };
};

const sentHeaders = async (fetchWithIdentity: (url: string) => Promise<Response>, url: string) => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchWithIdentity(url);
    return new Headers((fetchMock.mock.calls[0] as any[])[1]?.headers);
};

afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
});

describe('demo paths', () => {
    it('reads the demo id from /demo/<id> and nothing else', async () => {
        const { demoIdFromPath } = (await loadAt('/')).demo;
        expect(demoIdFromPath('/demo/unesco')).toBe('unesco');
        expect(demoIdFromPath('/demo/unesco/')).toBe('unesco');
        expect(demoIdFromPath('/demo/world-bank/app')).toBe('world-bank');
        for (const path of ['/', '/app', '/demos/unesco', '/demo/', '/demo/UNESCO', '/demo/-x', '/demo/unesco.zip', '/x/demo/unesco']) {
            expect(demoIdFromPath(path)).toBeNull();
        }
    });

    it('keeps a demo page in the demo and its storage apart', async () => {
        const { demo, utils } = await loadAt('/demo/unesco?session=abc');
        expect(demo.DEMO_ID).toBe('unesco');
        expect(demo.APP_PATH).toBe('/demo/unesco');
        expect(demo.demoScoped('root')).toBe('root:demo:unesco');
        expect((await sentHeaders(utils.fetchWithIdentity, '/api/app-config')).get('X-DF-Demo')).toBe('unesco');
        // Only API requests carry it.
        expect((await sentHeaders(utils.fetchWithIdentity, 'https://example.org/data.csv')).get('X-DF-Demo')).toBeNull();
    });

    it('leaves the standard app as it was', async () => {
        const { demo, utils } = await loadAt('/app');
        expect(demo.DEMO_ID).toBeNull();
        expect(demo.APP_PATH).toBe('/app');
        expect(demo.demoScoped('root')).toBe('root');
        expect((await sentHeaders(utils.fetchWithIdentity, '/api/app-config')).get('X-DF-Demo')).toBeNull();
    });
});
