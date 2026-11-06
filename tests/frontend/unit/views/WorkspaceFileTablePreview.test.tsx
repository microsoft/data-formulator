import React from 'react';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TablePreview } from '../../../../src/views/WorkspaceFileCanvas';

describe('TablePreview', () => {
    it('shows a compact grid: one line per cell, numbers right-aligned and rounded, and how much is shown', () => {
        render(<TablePreview fileName="benchmarks.parquet" preview={{
            name: 'benchmarks.parquet', kind: 'table', content: '', truncated: true, row_count: 94,
            columns: ['country', 'year', 'per_researcher'],
            rows: [{ country: 'Bolivia (Plurinational State of)', year: 2021, per_researcher: 94576.6161258 },
                { country: 'Iraq', year: 2021, per_researcher: null }],
        }} />);
        expect(screen.getByText('94 rows · 3 columns · showing the first 2')).toBeVisible();
        const value = screen.getByText('94,576.6161');
        expect(value).toHaveStyle({ textAlign: 'right', whiteSpace: 'nowrap' });
        expect(screen.getAllByText('2021')[0]).toHaveStyle({ textAlign: 'right' });
        expect(screen.getByText('Bolivia (Plurinational State of)')).toHaveStyle({ textAlign: 'left', textOverflow: 'ellipsis' });
        expect(screen.getByRole('columnheader', { name: 'per_researcher' })).toHaveStyle({ position: 'sticky' });
    });
});
