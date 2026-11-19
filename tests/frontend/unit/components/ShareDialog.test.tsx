import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import '../../../../src/i18n';

const mocks = vi.hoisted(() => ({
    serverConfig: { SHARE_LINKS: true, SITE: { name: 'NeurIPS in Data Formulator', logo: '/api/demos/neurips/logo' } } as any,
    apiRequest: vi.fn(),
    compose: vi.fn(async (input: any) => ({ url: `data:image/png;base64,CARD-${input.shape ?? 'square'}`, shape: input.shape ?? 'square', width: 2400, height: 2400 })),
}));

vi.mock('react-redux', () => ({ useSelector: (selector: any) => selector({ serverConfig: mocks.serverConfig }) }));
vi.mock('../../../../src/app/apiClient', () => ({ apiRequest: mocks.apiRequest }));
vi.mock('../../../../src/app/utils', () => ({ getUrls: () => ({ SHARES: '/api/shares' }) }));
vi.mock('../../../../src/app/shareCard', async importOriginal => ({ ...(await importOriginal<object>()), composeShareCard: mocks.compose }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async (text: string) => `data:image/png;base64,QR:${text}`) } }));
// The picture as the canvas draws it, at once.
vi.mock('../../../../src/views/AgentViewHost', () => ({
    default: ({ request, onDone }: any) => {
        React.useEffect(() => { onDone(request.targets.map((target: any) => ({ path: target.path, image: 'data:image/png;base64,PIC', density: 2 }))); }, []);
        return null;
    },
}));

import { ShareDialog } from '../../../../src/components/ShareDialog';
import { CARD_HEIGHTS, fittedHeight, pictureArea, placePicture } from '../../../../src/app/shareCard';

const app = { path: 'files/growth.app.jsx', kind: 'app' as const, name: 'growth.app.jsx' };

describe('ShareDialog', () => {
    beforeEach(() => { mocks.apiRequest.mockReset(); mocks.compose.mockClear(); });

    it('puts the card on the web when asked, and shows a QR code to it', async () => {
        mocks.serverConfig.SHARE_LINKS = true;
        mocks.apiRequest.mockResolvedValue({ data: { id: 'abcdefghijklmnop', path: '/s/abcdefghijklmnop' } });
        render(<ShareDialog open onClose={vi.fn()} target={app} title="From 90 papers to 9,000" />);

        const make = await screen.findByRole('button', { name: 'Get a QR code' });
        expect(mocks.apiRequest).not.toHaveBeenCalled();
        expect(mocks.compose).toHaveBeenCalledWith(expect.objectContaining({ picture: 'data:image/png;base64,PIC', density: 2, crop: true,
            title: 'From 90 papers to 9,000', brand: 'NeurIPS in Data Formulator', logos: ['/api/demos/neurips/logo', expect.any(String)] }));
        fireEvent.click(make);
        const qr = await screen.findByAltText(`${window.location.origin}/s/abcdefghijklmnop`);
        expect(qr.getAttribute('src')).toBe(`data:image/png;base64,QR:${window.location.origin}/s/abcdefghijklmnop`);
        expect(JSON.parse(mocks.apiRequest.mock.calls[0][1].body)).toEqual({ image: 'data:image/png;base64,CARD-square', title: 'From 90 papers to 9,000' });
        expect(screen.getByText('Scan to post from your phone')).toBeTruthy();

        // Another shape is a new card: the QR code still leads to the old one until it is updated.
        fireEvent.click(screen.getByRole('button', { name: 'Tall' }));
        expect(await screen.findByRole('button', { name: 'Update the QR code' })).toBeTruthy();
        expect(document.querySelector('[data-share-card]')?.getAttribute('data-shape')).toBe('tall');
    });

    it('on a person\'s own computer, offers the image without putting it on the web', async () => {
        mocks.serverConfig.SHARE_LINKS = false;
        render(<ShareDialog open onClose={vi.fn()} target={app} title="Growth" />);
        expect(await screen.findByRole('button', { name: 'Download image' })).toBeTruthy();
        await waitFor(() => expect(document.querySelector('[data-share-card]')).toBeTruthy());
        expect(mocks.apiRequest).not.toHaveBeenCalled();
        expect(document.querySelector('[data-share-qr]')).toBeNull();
    });
});

describe('share card layout', () => {
    const area = { x: 0, y: 0, w: 1000, h: 500 };

    it('shows a chart or map whole, however tall, without blowing a small one up', () => {
        const tall = placePicture(700, 2600, area);
        expect(tall.source).toEqual({ x: 0, y: 0, w: 700, h: 2600 });
        expect(tall.target.h).toBe(500);
        const small = placePicture(100, 50, area);
        expect(small.target.w).toBe(250);
    });

    it('cuts only a croppable picture (an app\'s page), from its top', () => {
        const page = placePicture(1000, 2600, area, true);
        expect(page.cut).toBe(true);
        expect(page.source).toEqual({ x: 0, y: 0, w: 1000, h: 500 });
        expect(placePicture(1000, 400, area, true).cut).toBe(false);
    });

    it('makes a card fitting its picture as tall as the picture needs, from wide to tall', () => {
        // A map shortened to itself, 3:2 across the card's width.
        expect(fittedHeight(800, 533, 164)).toBe(Math.round(44 + 533 * (1112 / 800) + 8 + 164));
        expect(fittedHeight(1200, 200, 164)).toBe(CARD_HEIGHTS.wide);
        expect(fittedHeight(500, 2000, 164)).toBe(CARD_HEIGHTS.tall);
        expect(pictureArea('tall').h).toBeGreaterThan(pictureArea('square').h);
    });
});
