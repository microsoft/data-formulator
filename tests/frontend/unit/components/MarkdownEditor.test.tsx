import React from 'react';
import { act, render } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material';
import { EditorView } from '@codemirror/view';
import { openSearchPanel } from '@codemirror/search';
import { expect, it } from 'vitest';
import { MarkdownEditor } from '../../../../src/components/MarkdownEditor';

it('opens a find panel in sentence case whose fields the browser does not autofill', () => {
  const { container } = render(<ThemeProvider theme={createTheme()}>
    <MarkdownEditor value={'const chart = 1;\n'} onChange={() => {}} fileName="app.app.jsx" />
  </ThemeProvider>);
  const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!;
  act(() => { openSearchPanel(view); });
  const fields = [...container.querySelectorAll<HTMLInputElement>('.cm-search input.cm-textfield')];
  expect(fields.map(field => field.name)).toEqual(['search', 'replace']);
  for (const field of fields) {
    expect(field).toHaveAttribute('autocomplete', 'off');
    expect(field).toHaveAttribute('data-lpignore', 'true');
  }
  const buttons = [...container.querySelectorAll('.cm-search .cm-button')].map(button => button.textContent);
  expect(buttons).toEqual(['Next', 'Previous', 'All', 'Replace', 'Replace all']);
});
