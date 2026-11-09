import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppSwitcher, type AppDestination } from '../../../../src/app/AppSwitcher';

const destinations: AppDestination[] = [
    { key: 'app', name: 'Data Formulator', path: '/app', current: false },
    { key: 'unesco', name: 'UIS Data Explorer', path: '/demo/unesco', current: true },
];

describe('AppSwitcher', () => {
    it('links to Data Formulator and each demo, marking the current one', () => {
        render(<AppSwitcher appName="UIS Data Explorer" destinations={destinations} onGoHome={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'UIS Data Explorer' }));
        const items = screen.getAllByRole('menuitem');
        expect(items.map(item => [item.textContent, item.getAttribute('href')])).toEqual([
            ['Data Formulator', '/app'], ['Demo: UIS Data Explorer', '/demo/unesco']]);
        expect(items[1]).toHaveClass('Mui-selected');
        expect(items[0]).not.toHaveClass('Mui-selected');
    });

    it('reads as a breadcrumb in a demo, linking back to Data Formulator', () => {
        const { unmount } = render(<AppSwitcher appName="UIS Data Explorer" destinations={destinations} onGoHome={vi.fn()} />);
        expect(screen.getByRole('link', { name: 'Data Formulator' })).toHaveAttribute('href', '/app');
        unmount();
        render(<AppSwitcher appName="Data Formulator" onGoHome={vi.fn()}
            destinations={destinations.map(destination => ({ ...destination, current: destination.key === 'app' }))} />);
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.getByRole('button', { name: 'Data Formulator' })).toBeInTheDocument();
    });

    it('takes the current one to its front page instead of reloading it', async () => {
        const onGoHome = vi.fn((event: React.MouseEvent) => event.preventDefault());
        render(<AppSwitcher appName="UIS Data Explorer" destinations={destinations} onGoHome={onGoHome} />);
        fireEvent.click(screen.getByRole('button', { name: 'UIS Data Explorer' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Demo: UIS Data Explorer' }));
        expect(onGoHome).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'UIS Data Explorer' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Data Formulator' }));
        expect(onGoHome).toHaveBeenCalledTimes(1);
    });
});
