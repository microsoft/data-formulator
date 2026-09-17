import React from 'react';
import 'prismjs';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { ThemeProvider, createTheme } from '@mui/material';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataFormulatorReducer, dfActions, dfSelectors } from '../../../../src/app/dfSlice';
import { DataThread } from '../../../../src/views/DataThread';
import { InteractionEntryCard } from '../../../../src/views/InteractionEntryCard';
import { LayoutProvider } from '../../../../src/app/LayoutProvider';
const CONVERSATION_ROOT_ID = 'conversation-root:test';
import * as workspaceService from '../../../../src/app/workspaceService';
import {
  getThreadTriggers,
  getThreadConversationIds,
  isThreadLeafTable,
  resolveThreadParentTableId,
} from '../../../../src/views/threadProvenance';

vi.mock('../../../../src/views/SimpleChartRecBox', () => ({ SimpleChartRecBox: () => null }));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => vi.unstubAllGlobals());

it('keeps intermediate agent instructions non-clickable even with a plan and callback', () => {
  const onClick = vi.fn();
  const onParentClick = vi.fn();
  render(React.createElement('div', { onClick: onParentClick }, React.createElement(InteractionEntryCard, {
    entry: { from: 'data-agent', to: 'user', role: 'instruction', content: 'Which deployments drive token volume?',
      plan: 'Inspecting deployment usage' } as any, onClick,
  })));
  fireEvent.click(screen.getByText('Which deployments drive token volume?'));
  expect(onClick).not.toHaveBeenCalled();
  expect(onParentClick).not.toHaveBeenCalled();
  expect(screen.queryByRole('button')).toBeNull();
  expect(getComputedStyle(screen.getByText('Which deployments drive token volume?').parentElement!).cursor).toBe('default');
});

it.each(['prompt', 'instruction'])('keeps user %s bubbles non-interactive even inside clickable rows', role => {
  const onClick = vi.fn();
  const onParentClick = vi.fn();
  const theme = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
  render(React.createElement(ThemeProvider, { theme, children:
    React.createElement('div', { onClick: onParentClick }, React.createElement(InteractionEntryCard, {
      entry: { from: 'user', to: 'data-agent', role, content: 'Visualize it and write a report' } as any, onClick,
    })),
  }));
  fireEvent.click(screen.getByText('Visualize it and write a report'));
  expect(onClick).not.toHaveBeenCalled();
  expect(onParentClick).not.toHaveBeenCalled();
  expect(screen.queryByRole('button')).toBeNull();
  expect(getComputedStyle(screen.getByText('Visualize it and write a report').parentElement!).cursor).toBe('text');
});

it.each([
  { producesTable: false, hasReport: false },
  { producesTable: true, hasReport: false },
  { producesTable: false, hasReport: true },
])('opens the full thread only from its icon or collapsed shortcut (table: $producesTable, report: $hasReport)', ({ producesTable, hasReport }) => {
  const initialState = dataFormulatorReducer(undefined, { type: 'init' });
  const store = configureStore({ reducer: dataFormulatorReducer, preloadedState: {
    ...initialState,
    generatedReports: hasReport ? [{ id: 'pending-report', parentNodeId: 'second', status: 'generating' } as any] : [],
  } });
  const nodeIds = ['first', 'second', 'third', 'fourth', 'fifth', 'latest'];
  nodeIds.forEach((id, index) => store.dispatch(dfActions.addTextTurn({ kind: 'text', id, displayId: id,
    textKind: 'explain', content: `${id} response`, createdAt: index,
    parentNodeId: index ? nodeIds[index - 1] : CONVERSATION_ROOT_ID,
    ...(index === 0 ? { prompt: 'Analyze token usage', answered: true, answer: 'Use azure command' } : {}),
    ...(producesTable && id === 'second' ? { executions: [{ id: 'old-command', argv: ['ls'], cwd: '.',
      purpose: 'Inspect files', status: 'awaiting_approval' as const }] } : {}),
  })));
  if (producesTable) store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'result-table', displayId: 'Result',
    names: [], metadata: {}, rows: [], parentNodeId: 'latest',
    derive: { source: [], code: '', dialog: [], trigger: { tableId: CONVERSATION_ROOT_ID, resultTableId: 'result-table', instruction: 'Create result',
      interaction: [
        { from: 'user', to: 'data-agent', role: 'prompt', content: 'Visualize this result' },
        { from: 'data-agent', to: 'user', role: 'instruction', content: 'Inspecting resource usage' },
        { from: 'data-agent', to: 'user', role: 'explain', content: 'Creation completed' },
      ],
    } },
  } as any));
  if (producesTable) store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'after-result', displayId: 'After',
    textKind: 'explain', content: 'Response after the result', parentNodeId: 'result-table', createdAt: 5 }));
  if (producesTable) store.dispatch(dfActions.addChart({ id: 'result-chart', chartType: 'Bar Chart', tableRef: 'result-table',
    source: 'user', encodingMap: {} } as any));
  const segmentFocus = { type: 'conversation', tableId: producesTable ? 'result-table' : CONVERSATION_ROOT_ID,
    nodeIds: producesTable ? [...nodeIds, 'result-table', 'after-result'] : nodeIds };
  const theme = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
  const { container } = render(React.createElement(Provider, { store, children:
    React.createElement(ThemeProvider, { theme, children:
      React.createElement(LayoutProvider, { children: React.createElement(DataThread) }),
    }),
  }));
  if (producesTable) {
    act(() => { store.dispatch(dfActions.setFocused({ type: 'chart', chartId: 'result-chart' })); });
    const selectedChart = container.querySelector('.data-thread-chart-card-wrapper .selected-card');
    expect(selectedChart).toBeTruthy();
    expect(getComputedStyle(selectedChart!).boxShadow).toContain('0 0 0 2px');
    expect(getComputedStyle(screen.getByText(/thread.*1/i)).color).toBe('rgb(25, 118, 210)');
    expect(container.querySelector('[data-thread-active="true"]')).toBeNull();
  }
  const heading = screen.getByText(/thread.*1/i);
  const previousFocus = store.getState().focusedId;
  fireEvent.click(heading);
  expect(store.getState().focusedId).toEqual(previousFocus);
  expect(heading.closest('button, [role="button"]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open thread conversation' }));
  expect(store.getState().focusedId).toEqual(segmentFocus);
  expect(container.querySelector('[data-thread-active="true"]')).toBeTruthy();
  expect(container.querySelector('.data-thread-chart-card-wrapper .selected-card')).toBeNull();
  for (const card of container.querySelectorAll('.selected-card')) {
    expect(getComputedStyle(card).boxShadow).not.toContain('0 0 0 2px');
  }
  act(() => { store.dispatch(dfActions.setFocused(undefined)); });
  expect(container.querySelector('[data-thread-active="true"]')).toBeNull();
  const openThreadButton = screen.getByRole('button', { name: 'Open thread conversation' });
  expect(heading.contains(openThreadButton)).toBe(false);
  fireEvent.click(openThreadButton);
  expect(store.getState().focusedId).toEqual(segmentFocus);
  expect(container.querySelectorAll('.data-thread-card.selected-card')).toHaveLength(producesTable ? 1 : 0);
  if (hasReport) {
    fireEvent.click(screen.getByText('second response'));
    expect(store.getState().focusedId).toEqual({ type: 'text', textId: 'second' });
    fireEvent.click(screen.getByText('latest response'));
    expect(store.getState().focusedId).toEqual({ type: 'text', textId: 'latest' });
    return;
  }
  expect(screen.getByText('first response')).toBeTruthy();
  expect(screen.getByText('Analyze token usage')).toBeTruthy();
  expect(screen.queryByText('Use azure command')).toBeNull();
  expect(!!screen.queryByText('latest response')).toBe(!producesTable);
  if (producesTable) {
    expect(screen.queryByText('second response')).toBeNull();
    expect(screen.getByText('Visualize this result')).toBeTruthy();
    expect(screen.getByText('Inspecting resource usage')).toBeTruthy();
    expect(screen.getByText('Creation completed')).toBeTruthy();
    expect(screen.getByText('Response after the result')).toBeTruthy();
  }
  fireEvent.click(screen.getByRole('button', { name: 'Open full conversation' }));
  expect(store.getState().focusedId).toEqual(segmentFocus);
  expect(screen.getByText('first response')).toBeTruthy();
  expect(screen.queryByText('second response')).toBeNull();
  const conversationLabel = `${producesTable ? 5 : 4} earlier turns`;
  const gutterToggle = screen.getByRole('button', { name: 'Show earlier turns' });
  const labelToggle = screen.getByRole('button', { name: conversationLabel });
  expect(gutterToggle.contains(labelToggle)).toBe(false);
  expect(gutterToggle.closest('[data-thread-item]')).toBe(labelToggle.closest('[data-thread-item]'));
  expect(labelToggle.querySelector('svg')).toBeNull();
  expect(gutterToggle.querySelector('[data-testid="ChevronRightIcon"]')).toBeTruthy();
  const collapsedBackground = getComputedStyle(labelToggle).backgroundColor;
  expect(getComputedStyle(gutterToggle).backgroundColor).toBe(collapsedBackground);
  fireEvent.click(screen.getByText(conversationLabel));
  const expandedToggle = screen.getByRole('button', { name: 'Hide earlier turns' });
  expect(expandedToggle.querySelector('[data-testid="KeyboardArrowDownIcon"]')).toBeTruthy();
  expect(getComputedStyle(labelToggle).backgroundColor).not.toBe(collapsedBackground);
  expect(getComputedStyle(expandedToggle).backgroundColor).toBe(collapsedBackground);
  expect(getComputedStyle(expandedToggle).color).toBe(getComputedStyle(labelToggle).color);
  expect(screen.getByText('first response')).toBeTruthy();
  expect(screen.getByText('Use azure command')).toBeTruthy();
  const connectorStyles = (text: string) => {
    const gutter = screen.getByText(text).closest('[data-thread-item]')!.firstElementChild!;
    return [gutter.firstElementChild!, gutter.lastElementChild!]
      .map(connector => getComputedStyle(connector).borderLeftStyle);
  };
  expect(connectorStyles('second response')).toEqual(['dotted', 'dotted']);
  expect(connectorStyles('first response')).toEqual(['solid', 'solid']);
  expect(connectorStyles(producesTable ? 'Visualize this result' : 'latest response')[0]).toBe('solid');
  expect(connectorStyles(conversationLabel)).toEqual(['solid', 'dotted']);
  if (producesTable) {
    expect(screen.getByText('latest response')).toBeTruthy();
    expect(screen.getByText('Visualize this result')).toBeTruthy();
    expect(screen.getByText('Inspecting resource usage')).toBeTruthy();
  }
  expect(store.getState().focusedId).toEqual(segmentFocus);
  fireEvent.click(screen.getByText('second response'));
  expect(store.getState().focusedId).toEqual({ type: 'text', textId: 'second' });
  fireEvent.click(screen.getByRole('button', { name: 'Hide earlier turns' }));
  expect(getComputedStyle(labelToggle).backgroundColor).toBe(collapsedBackground);
  expect(screen.getByRole('button', { name: 'Show earlier turns' }).querySelector('[data-testid="ChevronRightIcon"]')).toBeTruthy();
  expect(screen.getByText('first response')).toBeTruthy();
  expect(screen.queryByText('Use azure command')).toBeNull();
  expect(screen.queryByText('second response')).toBeNull();
  expect(connectorStyles(conversationLabel)).toEqual(['solid', 'solid']);
  if (producesTable) fireEvent.click(screen.getByRole('button', { name: 'Show earlier turns' }));
  fireEvent.click(screen.getByText('latest response'));
  expect(store.getState().focusedId).toEqual({ type: 'text', textId: 'latest' });
  expect(container.querySelector('[data-thread-active="true"]')).toBeNull();
});

it.each(['pending', 'loaded', 'live-draft', 'interrupted-draft'] as const)(
  'folds through results without hiding active work: %s', scenario => {
    const initialState = dataFormulatorReducer(undefined, { type: 'init' });
    const hasDraft = scenario === 'live-draft' || scenario === 'interrupted-draft';
    const store = configureStore({ reducer: dataFormulatorReducer, preloadedState: {
      ...initialState,
      loadedTableNodes: scenario === 'loaded'
        ? [{ kind: 'loaded-table', id: 'load-result', tableId: 'result', parentNodeId: 'latest', createdAt: 5 } as any] : [],
      draftNodes: hasDraft ? [{ kind: 'draft', id: 'active-draft', displayId: 'Draft', parentNodeId: 'second',
        derive: { source: [], status: scenario === 'live-draft' ? 'running' : 'interrupted',
          trigger: { tableId: CONVERSATION_ROOT_ID, instruction: 'Inspect files' } } } as any] : [],
    } });
    const nodeIds = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'latest'];
    nodeIds.forEach((id, index) => store.dispatch(dfActions.addTextTurn({ kind: 'text', id, displayId: id,
      textKind: 'explain', content: `${id} response`, createdAt: index,
      parentNodeId: index ? nodeIds[index - 1] : CONVERSATION_ROOT_ID,
      ...(id === 'second' ? { executions: [{ id: 'command', argv: ['ls'], cwd: '.', purpose: 'Inspect files',
        status: 'awaiting_approval' as const }] } : {}),
    })));
    if (scenario !== 'pending') store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'result', displayId: 'Result',
      names: [], metadata: {}, rows: [],
      ...(hasDraft ? { parentNodeId: 'latest', derive: { source: [], code: '', dialog: [], trigger: {
        tableId: CONVERSATION_ROOT_ID, resultTableId: 'result', instruction: 'Create result',
        interaction: [{ from: 'data-agent', to: 'user', role: 'instruction', content: 'Creating result' }],
      } } } : {}),
    } as any));
    const theme = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
    render(React.createElement(Provider, { store, children:
      React.createElement(ThemeProvider, { theme, children:
        React.createElement(LayoutProvider, { children: React.createElement(DataThread) }),
      }),
    }));
    const isActive = scenario === 'pending' || scenario === 'live-draft';
    expect(!!screen.queryByText('second response')).toBe(isActive);
    expect(screen.getByText('first response')).toBeTruthy();
    expect(screen.getByText('latest response')).toBeTruthy();
    if (hasDraft) expect(screen.getByText('Creating result')).toBeTruthy();
    const count = isActive ? 4 : 5;
    expect(screen.getByText(`${count} earlier turns`)).toBeTruthy();
    if (scenario !== 'pending') expect(screen.getAllByText('Result').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Show earlier turns' }));
    for (const id of nodeIds) expect(screen.getByText(`${id} response`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide earlier turns' }));
    expect(!!screen.queryByText('second response')).toBe(isActive);
    expect(store.getState().textTurns.find(turn => turn.id === 'second')?.executions?.[0].status).toBe('awaiting_approval');
  },
);

it('opens, updates, and deletes a file result without a text turn, retaining it on deletion failure', async () => {
  const store = configureStore({ reducer: dataFormulatorReducer });
  const file = { kind: 'file' as const, id: 'file-result', path: 'scratch/cpi.parquet',
    displayName: 'CPI Summary', contentHash: 'v1', parentNodeId: CONVERSATION_ROOT_ID, createdAt: 1 };
  store.dispatch(dfActions.upsertFileNode(file));
  const theme = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
  render(React.createElement(Provider, { store, children:
    React.createElement(ThemeProvider, { theme, children:
      React.createElement(LayoutProvider, { children: React.createElement(DataThread) }),
    }),
  }));
  expect(store.getState().textTurns).toEqual([]);
  expect(getThreadConversationIds(CONVERSATION_ROOT_ID, [], [], [], store.getState().fileNodes)).toEqual([file.id]);
  fireEvent.click(screen.getByRole('button', { name: 'CPI Summary' }));
  expect(store.getState().focusedId).toEqual({ type: 'reference', referenceId: file.id });
  expect(screen.getByRole('button', { name: 'CPI Summary' }).closest('.selected-artifact-card')).toBeTruthy();
  expect(getComputedStyle(screen.getByText(/thread.*1/i)).color).toBe('rgb(25, 118, 210)');
  expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'file', fileName: file.path });
  act(() => store.dispatch(dfActions.upsertFileNode({ ...file, displayName: 'Updated CPI', contentHash: 'v2' })));
  expect(screen.queryByRole('button', { name: 'CPI Summary' })).toBeNull();
  expect(screen.getAllByRole('button', { name: 'Updated CPI' })).toHaveLength(1);
  const deleteFile = vi.spyOn(workspaceService, 'deleteWorkspaceFile').mockRejectedValueOnce(new Error('Unavailable'));
  try {
    const button = screen.getByRole('button', { name: 'Delete file' });
    fireEvent.click(button);
    expect(button.hasAttribute('disabled')).toBe(true);
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    expect(store.getState().fileNodes).toHaveLength(1);
    expect(store.getState().messages.at(-1)?.type).toBe('error');
    deleteFile.mockResolvedValueOnce(undefined);
    fireEvent.click(button);
    await waitFor(() => expect(store.getState().fileNodes).toEqual([]));
    expect(deleteFile).toHaveBeenLastCalledWith(file.path);
    expect(store.getState().focusedId).toBeUndefined();
  } finally {
    deleteFile.mockRestore();
  }
});

it.each(['derived', 'loaded'] as const)('leaves a single %s result lead-up visible without a collapse control', scenario => {
  const initialState = dataFormulatorReducer(undefined, { type: 'init' });
  const store = configureStore({ reducer: dataFormulatorReducer, preloadedState: {
    ...initialState,
    loadedTableNodes: scenario === 'loaded'
      ? [{ kind: 'loaded-table', id: 'load-result', tableId: 'result', parentNodeId: 'only-turn', createdAt: 2 } as any] : [],
  } });
  if (scenario === 'loaded') store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'only-turn', displayId: 'Only turn',
    textKind: 'explain', content: 'Inspect deployment volume', parentNodeId: CONVERSATION_ROOT_ID, createdAt: 1,
  }));
  store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'result', displayId: 'Result', names: [], metadata: {}, rows: [],
    ...(scenario === 'derived' ? { parentNodeId: CONVERSATION_ROOT_ID, derive: { source: [], code: '', dialog: [], trigger: {
      tableId: CONVERSATION_ROOT_ID, resultTableId: 'result', instruction: 'Inspect deployment volume',
      interaction: [{ from: 'data-agent', to: 'user', role: 'instruction', content: 'Inspect deployment volume' }],
    } } } : {}),
  } as any));
  const theme = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
  render(React.createElement(Provider, { store, children:
    React.createElement(ThemeProvider, { theme, children:
      React.createElement(LayoutProvider, { children: React.createElement(DataThread) }),
    }),
  }));
  expect(screen.getByText('Inspect deployment volume')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Show earlier turns' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Hide earlier turns' })).toBeNull();
  expect(screen.queryByText('1 earlier turns')).toBeNull();
});

it.each(['derived', 'loaded', 'ongoing'].flatMap(scenario => [5, 6].map(count => ({ scenario, count }))))(
  'keeps complete endpoint exchanges and folds only more than three middle turns: $scenario, $count turns', ({ scenario, count }) => {
    const initialState = dataFormulatorReducer(undefined, { type: 'init' });
    const turnIds = Array.from({ length: count }, (_, index) => `turn-${index}`);
    const store = configureStore({ reducer: dataFormulatorReducer, preloadedState: {
      ...initialState,
      loadedTableNodes: scenario === 'loaded' ? [{ kind: 'loaded-table', id: 'load-result', tableId: 'result',
        parentNodeId: turnIds[count - 1], createdAt: count } as any] : [],
    } });
    if (scenario !== 'derived') turnIds.forEach((id, index) => store.dispatch(dfActions.addTextTurn({ kind: 'text',
      id, displayId: id, textKind: 'explain', prompt: `Request ${index}`, content: `Response ${index}`,
      parentNodeId: index ? turnIds[index - 1] : CONVERSATION_ROOT_ID, createdAt: index,
    })));
    if (scenario !== 'ongoing') store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'result', displayId: 'Result',
      names: [], metadata: {}, rows: [],
      ...(scenario === 'derived' ? { parentNodeId: CONVERSATION_ROOT_ID, derive: { source: [], code: '', dialog: [], trigger: {
        tableId: CONVERSATION_ROOT_ID, resultTableId: 'result', instruction: 'Create result',
        interaction: turnIds.flatMap((id, index) => [
          { from: 'user', to: 'data-agent', role: 'prompt', content: `Request ${index}` },
          { from: 'data-agent', to: 'user', role: 'instruction', content: `Response ${index}` },
        ]),
      } } } : {}),
    } as any));
    const theme = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
    render(React.createElement(Provider, { store, children:
      React.createElement(ThemeProvider, { theme, children:
        React.createElement(LayoutProvider, { children: React.createElement(DataThread) }),
      }),
    }));
    for (const index of [0, count - 1]) {
      expect(screen.getByText(`Request ${index}`)).toBeTruthy();
      expect(screen.getByText(`Response ${index}`)).toBeTruthy();
      const block = screen.getByText(`Request ${index}`).closest('[data-thread-flow-block]');
      expect(block).toBeTruthy();
      expect(screen.getByText(`Response ${index}`).closest('[data-thread-flow-block]')).toBe(block);
      expect(getComputedStyle(block!).breakInside).toBe('avoid');
    }
    const flow = screen.getByText('Request 0').closest('[data-thread-column-flow]');
    expect(getComputedStyle(flow!).display).toBe('grid');
    if (scenario !== 'ongoing') {
      expect(screen.getAllByText('Result').find(element => element.closest('[data-thread-flow-block]'))?.closest('[data-thread-flow-block]'))
        .toBe(screen.getByText(`Request ${count - 1}`).closest('[data-thread-flow-block]'));
    }
    if (count === 5) {
      expect(screen.queryByRole('button', { name: 'Show earlier turns' })).toBeNull();
      for (let index = 1; index < count - 1; index++) {
        expect(screen.getByText(`Request ${index}`)).toBeTruthy();
        expect(screen.getByText(`Response ${index}`)).toBeTruthy();
      }
    } else {
      const toggle = screen.getByRole('button', { name: 'Show earlier turns' });
      expect(screen.getByText('4 earlier turns')).toBeTruthy();
      expect(screen.getByText('Response 0').compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(toggle.compareDocumentPosition(screen.getByText(`Request ${count - 1}`)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.queryByText('Request 1')).toBeNull();
      expect(screen.queryByText('Response 1')).toBeNull();
      fireEvent.click(toggle);
      expect(screen.getByText('Request 1')).toBeTruthy();
      expect(screen.getByText('Response 1')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Hide earlier turns' }));
      expect(screen.queryByText('Request 1')).toBeNull();
    }
  },
);

it.each(['none', 'user', 'pending', 'new-run'] as const)(
  'lightly groups completed agent command updates without crossing %s boundaries', boundary => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    ['inspect', 'list'].forEach((id, index) => store.dispatch(dfActions.addTextTurn({ kind: 'text', id, displayId: id,
      textKind: 'explain', content: `${id} resource details`, createdAt: index,
      parentNodeId: index ? 'inspect' : CONVERSATION_ROOT_ID,
      actionId: index && boundary === 'new-run' ? 'another-run' : 'same-run',
      ...(index && boundary === 'user' ? { prompt: 'Try another resource' } : {}),
      executions: [{ id: `${id}-command`, argv: ['az', id], cwd: '.', purpose: id,
        status: index && boundary === 'pending' ? 'awaiting_approval' : 'completed' }],
    })));
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'findings', displayId: 'Findings', textKind: 'explain',
      content: 'Final findings', createdAt: 3, parentNodeId: 'list', actionId: 'same-run' }));
    const theme = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
    const { container } = render(React.createElement(Provider, { store, children:
      React.createElement(ThemeProvider, { theme, children:
        React.createElement(LayoutProvider, { children: React.createElement(DataThread) }),
      }),
    }));
    const group = container.querySelector('[data-agent-work-group]');
    expect(!!group).toBe(boundary === 'none');
    expect(getComputedStyle(screen.getByText('inspect resource details')).webkitLineClamp).toBe('4');
    const purposeCard = screen.getByText('inspect resource details').closest('.data-thread-card');
    expect(screen.queryByText('az inspect')).toBeNull();
    const command = purposeCard!.querySelector('[data-testid="TerminalIcon"]')!;
    expect(command.closest('button')).toBeNull();
    expect(command.closest('.data-thread-card')).toBe(purposeCard);
    expect(command.closest('[data-execution-commands]')).toBeTruthy();
    const indicators = command.closest('[data-execution-commands]')!;
    expect(indicators.parentElement!.firstElementChild).toBe(indicators);
    expect(indicators.parentElement!.textContent).toContain('inspect');
    expect(getComputedStyle(indicators).display).toBe('inline');
    expect(getComputedStyle(indicators).position).not.toBe('absolute');
    expect(getComputedStyle(indicators.firstElementChild!).display).toBe('inline-flex');
    fireEvent.click(command);
    expect(store.getState().focusedId).toEqual({ type: 'text', textId: 'inspect' });
    expect(purposeCard?.classList.contains('selected-card')).toBe(true);
    if (group) {
      expect(group.textContent).toContain('inspect resource details');
      expect(group.textContent).toContain('list resource details');
      expect(group.textContent).not.toContain('Final findings');
      expect(group.querySelectorAll('[data-execution-commands]')).toHaveLength(2);
    }
    fireEvent.click(screen.getByText('list resource details'));
    expect(store.getState().focusedId).toEqual({ type: 'text', textId: 'list' });
    expect(screen.getByText('list resource details').closest('.selected-card')).toBeTruthy();
    fireEvent.click(screen.getByText('inspect resource details'));
    expect(store.getState().focusedId).toEqual({ type: 'text', textId: 'inspect' });
  },
);

it('initializes the dense segment target to 1.5 viewports without fixing column height', () => {
  const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(900);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  const store = configureStore({ reducer: dataFormulatorReducer });
  store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'short', displayId: 'Short', textKind: 'explain',
    content: 'A short conversation', parentNodeId: CONVERSATION_ROOT_ID, createdAt: 1 }));
  const theme = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
  try {
    const { container } = render(React.createElement(Provider, { store, children:
      React.createElement(ThemeProvider, { theme, children:
        React.createElement(LayoutProvider, { children: React.createElement(DataThread, { denseColumns: true }) }),
      }),
    }));
    const flow = container.querySelector('[data-thread-column-flow]')!;
    expect(getComputedStyle(flow).display).toBe('grid');
    expect(flow.getAttribute('data-thread-segment-height')).toBe('1350');
    expect(getComputedStyle(flow).height).toBe('');
    expect(getComputedStyle(flow).gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
    expect(flow.querySelectorAll('[data-thread-segment]')).toHaveLength(1);
    expect(screen.getByText('A short conversation').closest('[data-thread-column]')?.getAttribute('data-thread-column')).toBe('0');
  } finally {
    height.mockRestore();
  }
});

it.each([
  { counts: [1, 1, 12], columns: ['0', '0', '1'] },
  { counts: [12, 1, 1], columns: ['0', '1', '1'] },
])('balances three consecutive threads with sizes $counts into contiguous columns', ({ counts, columns }) => {
  const store = configureStore({ reducer: dataFormulatorReducer });
  counts.forEach((count, thread) => {
    for (let turn = 0; turn < count; turn++) store.dispatch(dfActions.addTextTurn({ kind: 'text',
      id: `thread-${thread}-turn-${turn}`, displayId: 'Response', textKind: 'explain',
      content: `Thread ${thread} response ${turn}`, createdAt: turn,
      parentNodeId: turn ? `thread-${thread}-turn-${turn - 1}` : `conversation-root:thread-${thread}`,
    }));
  });
  const theme = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
  const { container } = render(React.createElement(Provider, { store, children:
    React.createElement(ThemeProvider, { theme, children:
      React.createElement(LayoutProvider, { children: React.createElement(DataThread, { denseColumns: true }) }),
    }),
  }));
  expect(counts.map((_, thread) => screen.getByText(`Thread ${thread} response 0`)
    .closest('[data-thread-column]')?.getAttribute('data-thread-column'))).toEqual(columns);
  expect(container.querySelectorAll('[data-thread-column]')).toHaveLength(2);
});

it('balances consecutive pieces and visually joins neighbors without discarding internal splits', () => {
  const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  const store = configureStore({ reducer: dataFormulatorReducer });
  const appendTable = (index: number) => {
    const parent = index ? `segment-table-${index - 1}` : CONVERSATION_ROOT_ID;
    store.dispatch(dfActions.addTableToStore({ kind: 'table', id: `segment-table-${index}`,
      displayId: `Output ${index}`, names: [], metadata: {}, rows: [], parentNodeId: parent,
      derive: { source: [], code: '', dialog: [], trigger: {
        tableId: parent, resultTableId: `segment-table-${index}`, instruction: `Create output ${index}`,
        interaction: [{ from: 'data-agent', to: 'user', role: 'instruction', content: `Result ${index}` }],
      } },
    } as any));
  };
  for (let index = 0; index < 4; index++) appendTable(index);
  store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'later-thread', displayId: 'Later thread',
    names: [], metadata: {}, rows: [], parentNodeId: 'conversation-root:later',
    derive: { source: [], code: '', dialog: [], trigger: {
      tableId: 'conversation-root:later', resultTableId: 'later-thread', instruction: 'Independent analysis',
      interaction: [{ from: 'data-agent', to: 'user', role: 'instruction', content: 'Later analysis' }],
    } },
  } as any));
  const theme = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
  try {
    const { container, rerender } = render(React.createElement(Provider, { store, children:
      React.createElement(ThemeProvider, { theme, children:
        React.createElement(LayoutProvider, { children: React.createElement(DataThread, { denseColumns: true }) }),
      }),
    }));
    const segmentOf = (index: number) => container.querySelector(`[data-thread-flow-block="output-segment-table-${index}"]`)
      ?.closest('[data-thread-segment]')?.getAttribute('data-thread-segment');
    const originalSegments = Array.from({ length: 4 }, (_, index) => segmentOf(index));
    expect(originalSegments).toEqual(['0', '0', '0', '1']);
    act(() => {
      for (let index = 4; index < 10; index++) appendTable(index);
      for (let index = 0; index < 8; index++) store.dispatch(dfActions.addTextTurn({ kind: 'text',
        id: `earlier-note-${index}`, displayId: `Note ${index}`, textKind: 'explain',
        content: 'Earlier output details '.repeat(30), parentNodeId: 'segment-table-0', createdAt: index,
      }));
    });
    expect(Array.from({ length: 10 }, (_, index) => segmentOf(index)))
      .toEqual(['0', '0', '0', '0', '0', '0', '1', '1', '1', '1']);
    const pieceOf = (index: number) => container.querySelector(`[data-thread-flow-block="output-segment-table-${index}"]`)
      ?.closest('[data-thread-active]');
    expect(pieceOf(0)).toBe(pieceOf(2));
    expect(pieceOf(0)).not.toBe(pieceOf(3));
    expect(pieceOf(3)).toBe(pieceOf(5));
    expect(pieceOf(6)).toBe(pieceOf(8));
    expect(pieceOf(6)).not.toBe(pieceOf(9));
    const flow = container.querySelector('[data-thread-column-flow]')!;
    expect(Array.from(flow.children, segment => segment.getAttribute('data-thread-segment'))).toEqual(['0', '1']);
    expect(getComputedStyle(flow).gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
    expect(getComputedStyle(flow.parentElement!).overflowX).toBe('hidden');
    const lastOutput = container.querySelector('[data-thread-flow-block="output-segment-table-9"]')!;
    const laterOutput = container.querySelector('[data-thread-flow-block="output-later-thread"]')!;
    expect(lastOutput.compareDocumentPosition(laterOutput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(laterOutput.closest('[data-thread-segment]')?.getAttribute('data-thread-segment')).toBe('1');
    expect(container.querySelectorAll('[data-thread-item^="used-table-ref-"]')).toHaveLength(0);
    act(() => { store.dispatch(dfActions.setFocused({ type: 'table', tableId: 'segment-table-0' })); });
    expect(container.querySelectorAll('[data-thread-highlighted="true"]')).toHaveLength(4);
    fireEvent.click(screen.getAllByRole('button', { name: 'Open thread conversation' })[1]);
    expect(store.getState().focusedId).toMatchObject({ type: 'conversation', tableId: 'segment-table-9' });
    expect(container.querySelectorAll('[data-thread-active="true"]')).toHaveLength(4);
    for (let index = 0; index < 10; index++) {
      expect(container.querySelectorAll(`[data-thread-flow-block="output-segment-table-${index}"]`)).toHaveLength(1);
    }
    rerender(React.createElement(Provider, { store, children:
      React.createElement(ThemeProvider, { theme, children:
        React.createElement(LayoutProvider, { children: React.createElement(DataThread, { denseColumns: false }) }),
      }),
    }));
    expect(container.querySelectorAll('[data-thread-segment]')).toHaveLength(1);
    for (let index = 0; index < 10; index++) expect(segmentOf(index)).toBe('0');
    expect(container.querySelectorAll('[data-thread-active]')).toHaveLength(5);
    expect(container.querySelectorAll('[data-thread-joined-above="true"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-thread-joined-below="true"]')).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Open thread conversation' })).toHaveLength(2);
    for (let index = 0; index < 10; index++) {
      expect(container.querySelectorAll(`[data-thread-flow-block="output-segment-table-${index}"]`)).toHaveLength(1);
    }
    rerender(React.createElement(Provider, { store, children:
      React.createElement(ThemeProvider, { theme, children:
        React.createElement(LayoutProvider, { children: React.createElement(DataThread, { denseColumns: true }) }),
      }),
    }));
    expect(Array.from({ length: 10 }, (_, index) => segmentOf(index)))
      .toEqual(['0', '0', '0', '0', '0', '0', '1', '1', '1', '1']);
    expect(container.querySelectorAll('[data-thread-joined-above="true"]')).toHaveLength(2);
  } finally {
    height.mockRestore();
  }
});

describe('thread provenance', () => {
  it('renders data references rooted directly in a conversation without a text reply', () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'generated', displayId: 'Generated data',
      names: [], metadata: {}, rows: [], virtual: { tableId: 'generated', rowCount: 0 } } as any));
    store.dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id: 'generated-reference',
      tableId: 'generated', parentNodeId: CONVERSATION_ROOT_ID, createdAt: 1 }));
    const theme = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
    const { container } = render(React.createElement(Provider, { store, children:
      React.createElement(ThemeProvider, { theme, children:
        React.createElement(LayoutProvider, { children: React.createElement(DataThread) }),
      }),
    }));
    expect(screen.getByText(/thread.*1/i)).toBeTruthy();
    const reference = container.querySelector('[data-thread-item="generated-reference"] button');
    expect(reference).toBeTruthy();
    fireEvent.click(reference!);
    expect(store.getState().focusedId).toEqual({ type: 'reference', referenceId: 'generated-reference' });
  });

  it('highlights only the selected table reference and its thread', () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'shared', displayId: 'Shared table',
      names: [], metadata: {}, rows: [], virtual: { tableId: 'shared', rowCount: 0 } } as any));
    for (const referenceId of ['first-reference', 'second-reference']) {
      store.dispatch(dfActions.addTextTurn({ kind: 'text', id: `${referenceId}-reply`, displayId: referenceId,
        textKind: 'explain', content: referenceId, parentNodeId: `conversation-root:${referenceId}`, createdAt: 1 }));
      store.dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id: referenceId, tableId: 'shared',
        parentNodeId: `${referenceId}-reply`, createdAt: 2 }));
    }
    const theme = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
    const { container } = render(React.createElement(Provider, { store, children:
      React.createElement(ThemeProvider, { theme, children:
        React.createElement(LayoutProvider, { children: React.createElement(DataThread) }),
      }),
    }));
    const references = container.querySelectorAll('[data-thread-item] .data-thread-card-wrapper[data-table-id="shared"]');
    expect(references).toHaveLength(2);
    fireEvent.click(references[1].querySelector('button')!);
    expect(store.getState().focusedId).toEqual({ type: 'reference', referenceId: 'second-reference' });
    expect(references[0].querySelector('.selected-artifact-card')).toBeNull();
    expect(references[1].querySelector('.selected-artifact-card')).toBeTruthy();
    expect(getComputedStyle(screen.getByText(/thread.*1/i)).color).not.toBe('rgb(25, 118, 210)');
    expect(getComputedStyle(screen.getByText(/thread.*2/i)).color).toBe('rgb(25, 118, 210)');
    expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'table', tableId: 'shared' });
  });

  it('keeps authored ancestry when a derivation uses unrelated file and table inputs', () => {
    const parent = { id: 'parent' } as any;
    const unrelated = { id: 'other' } as any;
    const result = { id: 'result', parentNodeId: parent.id, derive: {
      source: [unrelated.id], inputSources: [
        { kind: 'file', id: 'scratch/inputs.csv', displayName: 'Inputs' },
        { kind: 'data', id: unrelated.id, displayName: 'Other' },
      ], trigger: { tableId: unrelated.id, resultTableId: 'result' },
    } } as any;
    expect(resolveThreadParentTableId(result, [parent, unrelated, result], [])).toBe(parent.id);
  });

  it('includes the entire conversation but excludes sibling result branches', () => {
    const tables = [{ id: 'source' }, { id: 'result', parentNodeId: 'second' }, { id: 'sibling', parentNodeId: 'other' }] as any;
    const turns = [{ id: 'first', parentNodeId: 'source' }, { id: 'second', parentNodeId: 'first' },
      { id: 'other', parentNodeId: 'first' }, { id: 'after', parentNodeId: 'result' }, { id: 'last', parentNodeId: 'after' }] as any;
    expect(getThreadConversationIds('result', tables, turns)).toEqual(['source', 'first', 'second', 'result', 'after', 'last']);
    expect(getThreadConversationIds(CONVERSATION_ROOT_ID, [], [{ id: 'first', parentNodeId: CONVERSATION_ROOT_ID },
      { id: 'second', parentNodeId: 'first' }] as any)).toEqual(['first', 'second']);
  });
  it('uses authored conversation parents for visual lineage', () => {
    const source = { id: 'consumer_price_index' } as any;
    const first = {
      id: 'd_out',
      parentNodeId: CONVERSATION_ROOT_ID,
      derive: { trigger: { tableId: source.id, resultTableId: 'd_out' } },
    } as any;
    const second = {
      id: 'd_d_out',
      parentNodeId: 'first-response',
      derive: { trigger: { tableId: source.id, resultTableId: 'd_d_out' } },
    } as any;
    const third = {
      id: 'd_d_out_2',
      parentNodeId: 'second-response',
      derive: { trigger: { tableId: source.id, resultTableId: 'd_d_out_2' } },
    } as any;
    const tables = [source, first, second, third];
    const turns = [
      { id: 'first-response', parentNodeId: first.id },
      { id: 'second-response', parentNodeId: second.id },
    ] as any;

    expect(resolveThreadParentTableId(first, tables, turns)).toBe(CONVERSATION_ROOT_ID);
    expect(resolveThreadParentTableId(second, tables, turns)).toBe(first.id);
    expect(resolveThreadParentTableId(third, tables, turns)).toBe(second.id);
    expect(tables.filter(table => isThreadLeafTable(table, tables, turns)).map(table => table.id))
      .toEqual([source.id, third.id]);
    expect(getThreadTriggers(third, tables, turns).map(trigger => [
      trigger.tableId,
      trigger.resultTableId,
    ])).toEqual([
      [CONVERSATION_ROOT_ID, first.id],
      [first.id, second.id],
      [second.id, third.id],
    ]);
  });
});