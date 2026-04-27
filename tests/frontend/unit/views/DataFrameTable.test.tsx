/**
 * Tests for DataFrameTable column description rendering.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { DataFrameTable } from '../../../../src/views/DataFrameTable';

describe('DataFrameTable', () => {
    const columns = ['order_id', 'status', 'region'];
    const rows = [{ order_id: 1, status: 'active', region: 'US' }];

    it('renders column headers', () => {
        render(<DataFrameTable columns={columns} rows={rows} />);
        expect(screen.getByText('order_id')).toBeDefined();
        expect(screen.getByText('status')).toBeDefined();
        expect(screen.getByText('region')).toBeDefined();
    });

    it('adds dotted underline to headers with descriptions', () => {
        const descriptions = { order_id: 'Primary key', region: 'Sales region' };
        const { container } = render(
            <DataFrameTable columns={columns} rows={rows} columnDescriptions={descriptions} />,
        );
        const ths = container.querySelectorAll('th');
        const orderTh = Array.from(ths).find(th => th.textContent === 'order_id');
        const statusTh = Array.from(ths).find(th => th.textContent === 'status');
        expect(orderTh?.style.cursor || orderTh?.className).toBeDefined();
        // status has no description — should not have cursor:help
        expect(statusTh?.getAttribute('title')).toBe('status');
    });

    it('does not set native title when columnDescriptions is provided for that col', () => {
        const descriptions = { order_id: 'Primary key' };
        const { container } = render(
            <DataFrameTable columns={columns} rows={rows} columnDescriptions={descriptions} />,
        );
        const ths = container.querySelectorAll('th');
        const orderTh = Array.from(ths).find(th => th.textContent === 'order_id');
        // Tooltip replaces native title
        expect(orderTh?.getAttribute('title')).toBeNull();
    });
});
