/**
 * Spaces at /space/<id>: the id is read from the path when the page loads, scopes browser storage and is sent with
 * every API request.
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
        space: await import('../../../../src/app/space'),
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

// Each test re-imports utils (TypeScript, d3, flint) from scratch, which is slow under a full parallel run.
describe('space paths', { timeout: 20000 }, () => {
    it('reads the space id from /space/<id> and nothing else', async () => {
        const { spaceIdFromPath } = (await loadAt('/')).space;
        expect(spaceIdFromPath('/space/unesco')).toBe('unesco');
        expect(spaceIdFromPath('/space/unesco/')).toBe('unesco');
        expect(spaceIdFromPath('/space/world-bank/app')).toBe('world-bank');
        for (const path of ['/', '/app', '/spaces/unesco', '/demo/unesco', '/space/', '/space/UNESCO', '/space/-x', '/space/unesco.zip', '/x/space/unesco']) {
            expect(spaceIdFromPath(path)).toBeNull();
        }
    });

    it('keeps a space page in the space and its storage apart', async () => {
        const { space, utils } = await loadAt('/space/unesco?session=abc');
        expect(space.SPACE_ID).toBe('unesco');
        expect(space.APP_PATH).toBe('/space/unesco');
        // The `:demo:` is the stored name from before spaces were named so.
        expect(space.spaceScoped('root')).toBe('root:demo:unesco');
        expect((await sentHeaders(utils.fetchWithIdentity, '/api/app-config')).get('X-DF-Space')).toBe('unesco');
        // Only API requests carry it.
        expect((await sentHeaders(utils.fetchWithIdentity, 'https://example.org/data.csv')).get('X-DF-Space')).toBeNull();
    });

    it('leaves the standard app as it was', async () => {
        const { space, utils } = await loadAt('/app');
        expect(space.SPACE_ID).toBeNull();
        expect(space.APP_PATH).toBe('/app');
        expect(space.spaceScoped('root')).toBe('root');
        expect((await sentHeaders(utils.fetchWithIdentity, '/api/app-config')).get('X-DF-Space')).toBeNull();
    });
});
