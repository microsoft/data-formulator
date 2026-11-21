import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppSwitcher, type AppDestination } from '../../../../src/app/AppSwitcher';

const destinations: AppDestination[] = [
    { key: 'app', name: 'Data Formulator', path: '/app', current: false },
    { key: 'unesco', name: 'UIS Data Explorer', path: '/space/unesco', current: true },
];

describe('AppSwitcher', () => {
    it('links to Data Formulator and each space, marking the current one', () => {
        render(<AppSwitcher appName="UIS Data Explorer" destinations={destinations} onGoHome={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'UIS Data Explorer' }));
        const items = screen.getAllByRole('menuitem');
        expect(items.map(item => [item.textContent, item.getAttribute('href')])).toEqual([
            ['Data Formulator', '/app'], ['Space: UIS Data Explorer', '/space/unesco']]);
        expect(items[1]).toHaveClass('Mui-selected');
        expect(items[0]).not.toHaveClass('Mui-selected');
    });

    it('reads as a breadcrumb in a space, linking back to Data Formulator', () => {
        const { unmount } = render(<AppSwitcher appName="UIS Data Explorer" destinations={destinations} onGoHome={vi.fn()} />);
        expect(screen.getByRole('link', { name: 'Data Formulator' })).toHaveAttribute('href', '/app');
        unmount();
        render(<AppSwitcher appName="Data Formulator" onGoHome={vi.fn()}
            destinations={destinations.map(destination => ({ ...destination, current: destination.key === 'app' }))} />);
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.getByRole('button', { name: 'Data Formulator' })).toBeInTheDocument();
    });

    it.each([
        ['NeurIPS in Data Formulator', 'NeurIPS'],
        ['Dataverse with Data Formulator', 'Dataverse'],
    ])('shortens %s in the header and the menu', (name, shortName) => {
        const named = [destinations[0], { ...destinations[1], name }];
        const { rerender } = render(<AppSwitcher appName={name} destinations={named} onGoHome={vi.fn()} />);
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(new RegExp(`^${shortName}$`));
        expect(screen.getByRole('heading', { level: 1 })).toHaveAttribute('title', name);
        rerender(<AppSwitcher appName={name} destinations={named} onGoHome={vi.fn()} compact />);
        expect(screen.queryByRole('link', { name: 'Data Formulator' })).toBeNull();
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(new RegExp(`^${shortName}$`));
        fireEvent.click(screen.getByRole('button', { name: shortName }));
        const item = screen.getByRole('menuitem', { name: `Space: ${shortName}` });
        expect(item).toHaveTextContent(new RegExp(`^Space: ${shortName}$`));
        expect(item).toHaveAttribute('href', '/space/unesco');
        expect(item).toHaveClass('Mui-selected');
    });

    it('takes the current one to its front page instead of reloading it', async () => {
        const onGoHome = vi.fn((event: React.MouseEvent) => event.preventDefault());
        render(<AppSwitcher appName="UIS Data Explorer" destinations={destinations} onGoHome={onGoHome} />);
        fireEvent.click(screen.getByRole('button', { name: 'UIS Data Explorer' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Space: UIS Data Explorer' }));
        expect(onGoHome).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'UIS Data Explorer' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Data Formulator' }));
        expect(onGoHome).toHaveBeenCalledTimes(1);
    });
});
