import React from 'react';
import 'prismjs';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { ThemeProvider, createTheme } from '@mui/material';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataFormulatorReducer, dfActions, dfSelectors } from '../../../../src/app/dfSlice';
import { DataThread } from '../../../../src/views/DataThread';
import { InteractionEntryCard, getStepIconComponent, PlanStepsView } from '../../../../src/views/InteractionEntryCard';
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

it.each([['execute_python_script', 'CodeIcon'], ['run_terminal', 'TerminalIcon']])('uses tool identity for %s regardless of label', (tool, icon) => {
  render(React.createElement(getStepIconComponent({ id: tool, kind: 'tool', tool, label: 'Creating chart / 运行', status: 'completed' })));
  expect(screen.getByTestId(icon)).toBeVisible();
});

it.each(['Running code', 'Running command', '✓ Creating chart', '✗ Failed'])('does not infer legacy metadata from %s', label => {
  render(React.createElement(getStepIconComponent(label)));
  expect(screen.getByTestId('AutoAwesomeIcon')).toBeVisible();
});

it('uses structured kind and status for filtering and activity, leaving legacy text static', () => {
  render(React.createElement(PlanStepsView, { filterCreatingChart: true, activeLastStep: true, steps: [
    { id: 'chart', kind: 'chart', label: 'Localized chart step', status: 'completed' },
    { id: 'command', kind: 'tool', tool: 'run_terminal', label: 'Creating chart via CLI', status: 'failed' },
    '✓ Creating chart',
  ] }));
  expect(screen.queryByText('Localized chart step')).toBeNull();
  expect(screen.getByText('Creating chart via CLI')).toBeVisible();
  expect(screen.getByTestId('ErrorOutlineIcon')).toBeVisible();
  expect(screen.getByText('✓ Creating chart')).toBeVisible();
  expect(screen.getByTestId('AutoAwesomeIcon')).toBeVisible();
});

it.each(['completed', 'failed', 'interrupted', 'running'] as const)('animates only explicitly running steps, not %s text', status => {
  render(React.createElement(PlanStepsView, { activeLastStep: true, steps: [
    { id: 'python', kind: 'tool', tool: 'execute_python_script', label: 'Running command', status },
  ] }));
  expect(screen.getByText(status === 'running' ? 'Running command…' : 'Running command')).toBeVisible();
});

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
});

it('keeps a shown thread open when a new thread appears and only collapses on request', () => {
  const store = configureStore({ reducer: dataFormulatorReducer });
  const addTurn = (id: string, parentNodeId: string, createdAt: number) => store.dispatch(dfActions.addTextTurn({
    kind: 'text', id, displayId: id, textKind: 'explain', content: `${id} response`, parentNodeId, createdAt,
    prompt: `Analyze ${id} pickups`,
  }));
  addTurn('old', 'conversation-root:old', 1);
  const theme = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
  render(React.createElement(Provider, { store, children:
    React.createElement(ThemeProvider, { theme, children:
      React.createElement(LayoutProvider, { children: React.createElement(DataThread) }),
    }),
  }));
  expect(screen.getByText('old response')).toBeTruthy();
  act(() => { addTurn('new', 'conversation-root:new', 2); });
  expect(screen.getByText('old response')).toBeTruthy();
  expect(screen.getByText('new response')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Collapse thread' })).toHaveLength(2);
  expect(document.querySelector('[data-thread-flow-header] [aria-hidden="true"] span')).toHaveStyle({ borderRadius: '50%' });
  fireEvent.click(screen.getAllByRole('button', { name: 'Collapse thread' })[0]);
  expect(screen.getByRole('button', { name: 'Expand thread' }).querySelector('[data-testid="ChevronRightIcon"]')).toBeTruthy();
  expect(screen.queryByText('old response')).toBeNull();
  expect(screen.getByText('Analyze old pickups').closest('[data-thread-summary]')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'view chat' })).toHaveLength(2);
  const previousFocus = store.getState().focusedId;
  const summary = screen.getByRole('button', { name: 'Analyze old pickups' });
  expect(summary).toHaveAttribute('aria-expanded', 'false');
  expect(summary).toHaveStyle({ color: theme.palette.text.secondary, fontFamily: theme.typography.fontFamily });
  expect(summary.previousElementSibling).toHaveAttribute('aria-hidden', 'true');
  expect(summary.previousElementSibling?.firstElementChild).toHaveStyle({ borderLeftWidth: '2px', borderLeftStyle: 'solid' });
  fireEvent.click(summary);
  expect(store.getState().focusedId).toEqual(previousFocus);
  expect(screen.getByText('old response')).toBeTruthy();
  act(() => { addTurn('followup', 'new', 3); });
  expect(screen.getByText('old response')).toBeTruthy();
  expect(screen.getByText('followup response')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: 'Collapse thread' })[0]);
  expect(screen.queryByText('old response')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Expand thread' }));
  expect(screen.getByText('old response')).toBeTruthy();
});

it.each(['completed', 'error'] as const)('renders a %s report after its request without an empty assistant bubble', status => {
  const store = configureStore({ reducer: dataFormulatorReducer });
  store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'report-owner', displayId: 'Report', textKind: 'explain',
    content: '', prompt: 'Write the final report', parentNodeId: CONVERSATION_ROOT_ID, createdAt: 1 }));
  store.dispatch(dfActions.saveGeneratedReport({ id: 'report', title: 'Final findings', content: '# Final findings',
    parentNodeId: 'report-owner', selectedChartIds: [], createdAt: 2, status }));
  const theme = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
  const { container } = render(React.createElement(Provider, { store, children:
    React.createElement(ThemeProvider, { theme, children:
      React.createElement(LayoutProvider, { children: React.createElement(DataThread) }),
    }),
  }));
  const prompt = screen.getByText('Write the final report');
  const report = screen.getByText('Final findings');
  expect(prompt.compareDocumentPosition(report) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(container.querySelector('[data-thread-item="textturn-report-owner"]')).toBeNull();
  fireEvent.click(report);
  expect(store.getState().focusedId).toEqual({ type: 'report', reportId: 'report' });
});

it('opens only the newest thread when existing threads are first shown', () => {
  const store = configureStore({ reducer: dataFormulatorReducer });
  for (const [id, createdAt] of [['old', 1], ['new', 2]] as const) {
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id, displayId: id, textKind: 'explain', content: `${id} response`,
      parentNodeId: `conversation-root:${id}`, createdAt, prompt: `Analyze ${id} pickups` }));
  }
  const theme = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
  render(React.createElement(Provider, { store, children:
    React.createElement(ThemeProvider, { theme, children:
      React.createElement(LayoutProvider, { children: React.createElement(DataThread) }),
    }),
  }));
  expect(screen.queryByText('old response')).toBeNull();
  expect(screen.getByText('new response')).toBeTruthy();
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
  if (producesTable) store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'result-chart-table', displayId: 'Result',
    names: [], metadata: {}, rows: [], parentNodeId: 'latest',
    derive: { source: [], code: '', dialog: [], trigger: { tableId: CONVERSATION_ROOT_ID, resultTableId: 'result-chart-table', instruction: 'Create result',
      interaction: [
        { from: 'user', to: 'data-agent', role: 'prompt', content: 'Visualize this result' },
        { from: 'data-agent', to: 'user', role: 'instruction', content: 'Inspecting resource usage' },
        { from: 'data-agent', to: 'user', role: 'explain', content: 'Creation completed' },
      ],
    } },
  } as any));
  if (producesTable) store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'after-result', displayId: 'After',
    textKind: 'explain', content: 'Response after the result', parentNodeId: 'result-chart-table', createdAt: 5 }));
  if (producesTable) store.dispatch(dfActions.addChart({ id: 'result-chart', chartType: 'Bar Chart', tableRef: 'result-chart-table',
    source: 'user', encodingMap: {} } as any));
  const segmentFocus = { type: 'conversation', tableId: producesTable ? 'result-chart-table' : CONVERSATION_ROOT_ID,
    nodeIds: producesTable ? [...nodeIds, 'result-chart-table', 'after-result'] : [...nodeIds, ...(hasReport ? ['pending-report'] : [])] };
  const theme = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
  const { container } = render(React.createElement(Provider, { store, children:
    React.createElement(ThemeProvider, { theme, children:
      React.createElement(LayoutProvider, { children: React.createElement(DataThread) }),
    }),
  }));
  if (producesTable) {
    act(() => { store.dispatch(dfActions.setFocused({ type: 'chart', chartId: 'result-chart' })); });
    expect(store.getState().focusedId).toEqual({ type: 'chart', chartId: 'result-chart' });
    expect(container.querySelector('[data-thread-active="true"]')).toBeNull();
    const instructionGutter = screen.getByText('Inspecting resource usage').closest('[data-thread-item]')!.firstElementChild!;
    expect(instructionGutter.querySelector('svg')).toHaveStyle({ color: theme.palette.primary.main });
    const tableDot = container.querySelector('[data-thread-item="regular-table-box-result-chart-table"] [data-thread-table-dot]');
    expect(tableDot).toHaveStyle({ backgroundColor: theme.palette.primary.main });
  }
  const heading = screen.getByText(/thread.*1/i);
  expect(heading.closest('button')).toHaveAttribute('aria-label', 'Collapse thread');
  fireEvent.click(screen.getByRole('button', { name: 'view chat' }));
  expect(store.getState().focusedId).toEqual(segmentFocus);
  expect(container.querySelector('[data-thread-active="true"]')).toBeTruthy();
  if (producesTable) {
    const instructionGutter = screen.getByText('Inspecting resource usage').closest('[data-thread-item]')!.firstElementChild!;
    expect(instructionGutter.querySelector('svg')).toHaveStyle({ color: 'rgba(0, 0, 0, 0.15)' });
    expect(container.querySelector('[data-thread-table-dot]')).toHaveStyle({ backgroundColor: 'rgba(0, 0, 0, 0.15)' });
  }
  act(() => { store.dispatch(dfActions.setFocused(undefined)); });
  expect(container.querySelector('[data-thread-active="true"]')).toBeNull();
  const openThreadButton = screen.getByRole('button', { name: 'view chat' });
  expect(heading.contains(openThreadButton)).toBe(false);
  fireEvent.click(openThreadButton);
  expect(store.getState().focusedId).toEqual(segmentFocus);
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
  fireEvent.click(screen.getByText(conversationLabel));
  expect(screen.getByRole('button', { name: 'Hide earlier turns' })).toBeEnabled();
  expect(screen.getByText('first response')).toBeTruthy();
  expect(screen.getByText('Use azure command')).toBeTruthy();
  if (producesTable) {
    expect(screen.queryByText('second response')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Terminal execution details' })).toBeNull();
  } else {
    expect(screen.getByText('second response')).toBeVisible();
  }
  if (producesTable) {
    expect(screen.getByText('latest response')).toBeTruthy();
    expect(screen.getByText('Visualize this result')).toBeTruthy();
    expect(screen.getByText('Inspecting resource usage')).toBeTruthy();
  }
  expect(store.getState().focusedId).toEqual(segmentFocus);
  if (!producesTable) {
    fireEvent.click(screen.getByText('second response'));
    expect(store.getState().focusedId).toEqual({ type: 'text', textId: 'second' });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Hide earlier turns' }));
  expect(screen.getByRole('button', { name: 'Show earlier turns' })).toBeEnabled();
  expect(screen.getByText('first response')).toBeTruthy();
  expect(screen.queryByText('Use azure command')).toBeNull();
  expect(screen.queryByText('second response')).toBeNull();
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
    expect(screen.queryByText('second response')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Terminal execution details' })).toBeNull();
    expect(screen.getByText('first response')).toBeTruthy();
    expect(screen.getByText('latest response')).toBeTruthy();
    if (hasDraft) expect(screen.getByText('Creating result')).toBeTruthy();
    const count = isActive ? 4 : 5;
    expect(screen.getByText(`${count} earlier turns`)).toBeTruthy();
    if (scenario !== 'pending') expect(screen.getAllByText('Result').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Show earlier turns' }));
    for (const id of nodeIds.filter(id => id !== 'second')) expect(screen.getByText(`${id} response`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide earlier turns' }));
    expect(screen.queryByText('second response')).toBeNull();
    expect(store.getState().textTurns.find(turn => turn.id === 'second')?.executions?.[0].status).toBe('awaiting_approval');
  },
);

it('highlights the displayed file when its closing chat response or follow-up is selected', () => {
  const store = configureStore({ reducer: dataFormulatorReducer });
  store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'file-summary', displayId: 'Summary', textKind: 'explain',
    prompt: 'Create a daily trip workflow', content: 'Created Daily Trip Trend Workflow.',
    parentNodeId: CONVERSATION_ROOT_ID, createdAt: 1 }));
  const file = { kind: 'file' as const, id: 'workflow-file', path: 'files/daily_trip_trend_workflow.md',
    displayName: 'Daily Trip Trend Workflow', parentNodeId: 'file-summary', createdAt: 2, contentHash: 'workflow-hash' };
  store.dispatch(dfActions.upsertFileNode(file));
  store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'follow-up', displayId: 'Follow-up', textKind: 'explain',
    content: 'The target date is configurable.', parentNodeId: 'file-summary', createdAt: 3 }));
  const theme = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
  render(React.createElement(Provider, { store, children:
    React.createElement(ThemeProvider, { theme, children:
      React.createElement(LayoutProvider, { children: React.createElement(DataThread) }),
    }),
  }));
  for (const content of ['Created Daily Trip Trend Workflow.', 'The target date is configurable.']) {
    fireEvent.click(screen.getByText(content));
    expect(store.getState().focusedId?.type).toBe('text');
    expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'file', fileName: file.path });
    expect(screen.getByRole('button', { name: file.displayName }).closest('.selected-artifact-card')).toBeTruthy();
  }
  act(() => store.dispatch(dfActions.setFocused({ type: 'conversation', tableId: CONVERSATION_ROOT_ID })));
  expect(screen.getByRole('button', { name: file.displayName }).closest('.selected-artifact-card')).toBeNull();
});

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
    }
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
  'retains clickable completed execution steps with %s boundaries', boundary => {
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
    expect(container.querySelectorAll('[data-agent-work-group]')).toHaveLength(0);
    expect(screen.queryByText('az inspect')).toBeNull();
    expect(!!screen.queryByText('inspect resource details')).toBe(boundary === 'new-run');
    expect(!!screen.queryByText('list resource details')).toBe(boundary !== 'pending');
    expect(screen.getByText('Final findings')).toBeVisible();
    if (boundary === 'user') expect(screen.getByText('Try another resource')).toBeVisible();
    if (boundary !== 'pending') {
      const focus = store.getState().focusedId;
      const onActivity = vi.fn();
      window.addEventListener('df-view-tool-activity', onActivity, { once: true });
      fireEvent.click(screen.getByText('list resource details'));
      expect(onActivity).not.toHaveBeenCalled();
      const group = screen.getByText('list resource details').closest('[data-tool-activity-row]')! as HTMLElement;
      fireEvent.click(within(group).getByRole('button', { name: 'list' }));
      expect((onActivity.mock.calls[0][0] as CustomEvent).detail.nodeId).toBe('list');
      expect(store.getState().focusedId).toEqual(focus);
    }
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Terminal execution details' })).toBeNull();
    expect(store.getState().textTurns).toHaveLength(3);
  },
);

it('retains one completed execution step while preserving its table and derived output', () => {
  const initialState = dataFormulatorReducer(undefined, { type: 'init' });
  const store = configureStore({ reducer: dataFormulatorReducer, preloadedState: {
    ...initialState,
    loadedTableNodes: [{ kind: 'loaded-table', id: 'usage-reference', tableId: 'usage-input',
      parentNodeId: 'acquire-5', createdAt: 7 }],
  } });
  for (let index = 0; index < 6; index++) store.dispatch(dfActions.addTextTurn({ kind: 'text',
    id: `acquire-${index}`, displayId: `Acquire ${index}`, textKind: 'explain', content: `Acquisition call ${index}`,
    parentNodeId: index ? `acquire-${index - 1}` : CONVERSATION_ROOT_ID, createdAt: index, actionId: 'acquire-run',
    ...(index === 0 ? { prompt: 'Analyze daily usage' } : {}),
    executions: [{ id: `terminal-${index}`, argv: ['az', 'query'], cwd: '.', purpose: `Acquire ${index}`,
      status: index >= 4 ? 'failed' : 'completed' }],
  }));
  store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'usage-input', displayId: 'Daily usage input',
    names: [], metadata: {}, rows: [] } as any));
  store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'usage-result', displayId: 'Usage trend',
    names: [], metadata: {}, rows: [], parentNodeId: 'acquire-5',
    derive: { source: ['usage-input'], code: '', dialog: [], trigger: { tableId: CONVERSATION_ROOT_ID,
      resultTableId: 'usage-result', instruction: 'Visualize daily usage', interaction: [] } },
  } as any));
  const theme = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
  const { container } = render(React.createElement(Provider, { store, children:
    React.createElement(ThemeProvider, { theme, children:
      React.createElement(LayoutProvider, { children: React.createElement(DataThread) }),
    }),
  }));
  expect(container.querySelectorAll('[data-agent-work-group]')).toHaveLength(0);
  expect(screen.getByText('Analyze daily usage')).toBeVisible();
  for (let index = 0; index < 5; index++) expect(screen.queryByText(`Acquisition call ${index}`)).toBeNull();
  const focus = store.getState().focusedId;
  const onActivity = vi.fn();
  window.addEventListener('df-view-tool-activity', onActivity, { once: true });
  fireEvent.click(screen.getByText('Acquisition call 5'));
  expect(onActivity).not.toHaveBeenCalled();
  const group = screen.getByText('Acquisition call 5').closest('[data-tool-activity-row]')! as HTMLElement;
  fireEvent.click(within(group).getByRole('button', { name: 'Acquire 5' }));
  expect((onActivity.mock.calls[0][0] as CustomEvent).detail.nodeId).toBe('acquire-5');
  expect(store.getState().focusedId).toEqual(focus);
  const output = container.querySelector('[data-thread-item="usage-reference"]')!;
  expect(output).toBeVisible();
  expect(screen.getByText('Usage trend')).toBeVisible();
  expect(screen.queryByRole('img', { name: 'Failed' })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(store.getState().loadedTableNodes[0].parentNodeId).toBe('acquire-5');
});

it('shows one live activity spinner and opens the execution step directly', async () => {
  const initialState = dataFormulatorReducer(undefined, { type: 'init' });
  const store = configureStore({ reducer: dataFormulatorReducer, preloadedState: {
    ...initialState,
    draftNodes: [{ kind: 'draft', id: 'live-draft', displayId: 'Draft', parentNodeId: 'command-6', createdAt: 7,
      derive: { source: [], code: '', dialog: [], status: 'running', runningPlan: 'Old fallback text',
        progressSteps: [{ id: 'live-command', kind: 'tool', tool: 'run_terminal', executionId: 'execution-6',
          label: 'Running command fixture', status: 'running' }], trigger: {
        tableId: CONVERSATION_ROOT_ID, resultTableId: 'live-draft', instruction: '', interaction: [],
      } },
    } as any],
  } });
  const turns = Array.from({ length: 7 }, (_, index) => ({ kind: 'text' as const, id: `command-${index}`,
    displayId: `Command ${index}`, textKind: 'explain' as const, content: `Command purpose ${index}`, createdAt: index,
    parentNodeId: index ? `command-${index - 1}` : CONVERSATION_ROOT_ID, actionId: 'one-run',
    ...(index === 0 ? { prompt: 'Analyze usage' } : {}),
    executions: [{ id: `execution-${index}`, argv: ['az', 'query', String(index)], cwd: '.', purpose: `Query ${index}`,
      status: index === 4 ? 'interrupted' as const : index === 5 ? 'failed' as const : index === 6 ? 'running' as const : 'completed' as const }],
  }));
  turns.forEach(turn => store.dispatch(dfActions.addTextTurn(turn)));
  const theme = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
  const { container } = render(React.createElement(Provider, { store, children:
    React.createElement(ThemeProvider, { theme, children:
      React.createElement(LayoutProvider, { children: React.createElement(DataThread) }),
    }),
  }));
  expect(container.querySelectorAll('[data-agent-work-group]')).toHaveLength(0);
  expect(screen.getByText('Analyze usage')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Show earlier turns' })).toBeNull();
  for (let index = 0; index < 7; index++) expect(screen.queryByText(`Command purpose ${index}`)).toBeNull();
  const activity = screen.getByText(/Running command fixture/).closest('[data-thread-item]')! as HTMLElement;
  expect(activity).toBeVisible();
  expect(screen.queryByText('Old fallback text')).toBeNull();
  expect(within(activity).queryByTestId('TerminalIcon')).toBeNull();
  expect(activity.querySelector('[data-activity-gutter] svg')).toBeNull();
  expect(within(activity).getAllByRole('progressbar')).toHaveLength(1);
  expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  expect(screen.queryByRole('img', { name: 'Running' })).toBeNull();
  expect(screen.queryByRole('img', { name: 'Failed' })).toBeNull();
  const focus = store.getState().focusedId;
  const onActivity = vi.fn();
  window.addEventListener('df-view-tool-activity', onActivity, { once: true });
  fireEvent.click(screen.getByText(/Running command fixture/));
  expect(onActivity).not.toHaveBeenCalled();
  expect(within(screen.getByText(/Running command fixture/).closest('button')!).queryByRole('progressbar')).toBeNull();
  expect(within(activity).getAllByRole('progressbar')).toHaveLength(1);
  expect(within(within(activity).getByRole('button', { name: 'Query 6' })).getByRole('progressbar')).toBeVisible();
  expect(within(within(activity).getByRole('button', { name: 'Query 0' })).getByTestId('CheckCircleOutlineIcon')).toBeVisible();
  expect(within(within(activity).getByRole('button', { name: 'Query 4' })).getByTestId('PauseCircleOutlineIcon')).toBeVisible();
  const failedStatus = within(within(activity).getByRole('button', { name: 'Query 5' })).getByTestId('ErrorOutlineIcon');
  expect(failedStatus).toBeVisible();
  expect(failedStatus.parentElement).toHaveStyle({ color: theme.palette.text.secondary, width: '14px', flexShrink: '0' });
  fireEvent.click(within(activity).getByRole('button', { name: 'Query 6' }));
  expect((onActivity.mock.calls[0][0] as CustomEvent).detail.nodeId).toBe('command-6');
  expect(store.getState().focusedId).toEqual(focus);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Collapse thread' }));
  expect(screen.queryByText(/Running command fixture/)).toBeNull();
  expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Expand thread' }));
  act(() => store.dispatch(dfActions.addTextTurn({ ...turns[6],
    executions: [{ ...turns[6].executions[0], status: 'completed' }] })));
  expect(screen.getByText(/Running command fixture/)).toBeVisible();
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(within(screen.getByRole('button', { name: 'Query 6' })).getByTestId('CheckCircleOutlineIcon')).toBeVisible();
  act(() => store.dispatch(dfActions.removeDraftNode('live-draft')));
  expect(screen.queryByText(/Running command fixture/)).toBeNull();
  expect(screen.queryByRole('progressbar')).toBeNull();
  window.addEventListener('df-view-tool-activity', onActivity, { once: true });
  fireEvent.click(screen.getByText('Command purpose 6'));
  const completedGroup = screen.getByText('Command purpose 6').closest('[data-tool-activity-row]')! as HTMLElement;
  fireEvent.click(within(completedGroup).getByRole('button', { name: 'Query 6' }));
  expect((onActivity.mock.calls[1][0] as CustomEvent).detail.nodeId).toBe('command-6');
  expect(store.getState().focusedId).toEqual(focus);
  expect(screen.queryByRole('button', { name: 'Terminal execution details' })).toBeNull();
  expect(store.getState().textTurns).toHaveLength(7);
  expect(store.getState().textTurns[5].executions![0].status).toBe('failed');
});

it('opens terminal and Python calls from their chart step with aligned tool icons', () => {
  const store = configureStore({ reducer: dataFormulatorReducer });
  store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'unrelated-call', displayId: 'Unrelated', textKind: 'explain',
    content: 'Other task', parentNodeId: 'conversation-root:other', actionId: 'other-run', createdAt: 0,
    executions: [{ id: 'unrelated', argv: ['pwd'], cwd: '.', purpose: 'Other task', status: 'completed' }] }));
  store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'terminal-call', displayId: 'Terminal', textKind: 'explain',
    content: 'Fetch input', parentNodeId: CONVERSATION_ROOT_ID, actionId: 'analysis', createdAt: 1,
    executions: [{ id: 'terminal', argv: ['az', 'query'], cwd: '.', purpose: 'Fetch input', status: 'completed' }] }));
  store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'python-call', displayId: 'Python', textKind: 'explain',
    content: 'Inspect input', parentNodeId: 'terminal-call', actionId: 'analysis', createdAt: 2,
    codeExecutions: [{ id: 'python', tool: 'execute_python_script', code: 'print(42)', purpose: 'Inspect input', status: 'completed' }] }));
  store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'chart-result', displayId: 'Chart result', names: [], metadata: {}, rows: [],
    parentNodeId: 'python-call', derive: { source: [], code: 'result_df = source_df.copy()', dialog: [],
      trigger: { tableId: CONVERSATION_ROOT_ID, resultTableId: 'chart-result', interaction: [
        { from: 'data-agent', to: 'datarec-agent', role: 'instruction', content: 'Compare storage accounts' },
      ] } } } as any));
  const onOpen = vi.fn();
  window.addEventListener('df-view-tool-activity', onOpen);
  try {
    const theme = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
    render(React.createElement(Provider, { store, children: React.createElement(ThemeProvider, { theme,
      children: React.createElement(LayoutProvider, { children: React.createElement(DataThread) }) }) }));
    const step = screen.getByText('Compare storage accounts').closest('[data-thread-item]')! as HTMLElement;
    const activity = screen.getByText('Tool activity').closest('button')!;
    expect(within(step).queryByTestId('CodeIcon')).toBeNull();
    const group = activity.closest('[data-secondary-activity]')! as HTMLElement;
    expect(group.querySelector('[data-activity-gutter] svg')).toBeNull();
    expect(within(group).queryByTestId('CodeIcon')).toBeNull();
    expect(activity.compareDocumentPosition(step) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(activity);
    expect(onOpen).not.toHaveBeenCalled();
    expect(within(group).getByRole('button', { name: 'Inspect input' })).toBeVisible();
    const call = within(group).getByRole('button', { name: 'Inspect input' });
    expect(call.parentElement).toHaveStyle({ paddingLeft: '0px' });
    expect(call).toHaveStyle({ paddingLeft: '0px' });
    expect(getComputedStyle(call).gap).toBe(getComputedStyle(activity).gap);
    expect(within(group).getAllByTestId('CodeIcon')[0]).toHaveStyle({ width: '12px', height: '12px' });
    expect(within(group).getByTestId('TerminalIcon')).toHaveStyle({ width: '12px', height: '12px' });
    fireEvent.click(within(group).getByRole('button', { name: 'Inspect input' }));
    const detail = (onOpen.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.execution.id).toBe('python');
    expect(detail).not.toHaveProperty('executions');
    expect(within(group).getByRole('button', { name: 'Inspect input' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(group).getByRole('button', { name: 'Fetch input' }));
    expect(within(group).getByRole('button', { name: 'Inspect input' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(group).getByRole('button', { name: 'Fetch input' })).toHaveAttribute('aria-pressed', 'true');
    act(() => { window.dispatchEvent(new Event('df-tool-activity-closed')); });
    expect(within(group).getByRole('button', { name: 'Fetch input' })).toHaveAttribute('aria-pressed', 'false');
    const focus = store.getState().focusedId;
    const onExplanation = vi.fn();
    window.addEventListener('df-view-explanation', onExplanation);
    try {
      const instruction = within(step).getByText('Compare storage accounts');
      expect(instruction.closest('button, [role="button"]')).toBeNull();
      expect(instruction).toHaveStyle({ overflowWrap: 'anywhere' });
      expect(getComputedStyle(instruction).getPropertyValue('-webkit-line-clamp')).toBe('');
      expect(getComputedStyle(instruction.parentElement!).cursor).toBe('default');
      fireEvent.click(instruction);
      expect(onExplanation).not.toHaveBeenCalled();
      expect(store.getState().focusedId).toEqual(focus);
    } finally {
      window.removeEventListener('df-view-explanation', onExplanation);
    }
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Terminal execution details' })).toBeNull();
  } finally {
    window.removeEventListener('df-view-tool-activity', onOpen);
  }
});

it('keeps a short conversation together in dense layout', () => {
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
  for (let index = 0; index < counts.length - 1; index++) {
    fireEvent.click(screen.getAllByRole('button', { name: 'Expand thread' })[0]);
  }
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
    expect(segmentOf(0)).toBeUndefined();
    expect(container.querySelectorAll('[data-thread-active]')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Expand thread' }));
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
    const lastOutput = container.querySelector('[data-thread-flow-block="output-segment-table-9"]')!;
    const laterOutput = container.querySelector('[data-thread-flow-block="output-later-thread"]')!;
    expect(lastOutput.compareDocumentPosition(laterOutput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(laterOutput.closest('[data-thread-segment]')?.getAttribute('data-thread-segment')).toBe('1');
    expect(container.querySelectorAll('[data-thread-item^="used-table-ref-"]')).toHaveLength(0);
    act(() => { store.dispatch(dfActions.setFocused({ type: 'table', tableId: 'segment-table-0' })); });
    expect(container.querySelectorAll('[data-thread-highlighted="true"]')).toHaveLength(4);
    fireEvent.click(screen.getAllByRole('button', { name: 'view chat' })[1]);
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
    expect(screen.getAllByRole('button', { name: 'view chat' })).toHaveLength(2);
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
  it('places mid-run loads after the output that preceded them', () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    const source = (id: string) => ({ kind: 'table', id, displayId: id, names: [], metadata: {}, rows: [],
      virtual: { tableId: id, rowCount: 0 } }) as any;
    const derived = (id: string, parentNodeId: string, triggerTableId: string, input: string) => ({
      ...source(id), displayId: `${id} chart`, parentNodeId,
      derive: { source: [input], code: '', dialog: [], trigger: { tableId: triggerTableId, resultTableId: id,
        interaction: [{ from: 'data-agent', to: 'user', role: 'instruction', content: `question ${id}` }] } },
    }) as any;
    store.dispatch(dfActions.addTableToStore(source('daily')));
    store.dispatch(dfActions.addTableToStore(source('regional')));
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'opening', displayId: 'opening', textKind: 'explain',
      content: 'opening response', parentNodeId: CONVERSATION_ROOT_ID, createdAt: 1 }));
    store.dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id: 'load-daily', tableId: 'daily',
      parentNodeId: 'opening', createdAt: 2 }));
    store.dispatch(dfActions.insertDerivedTables(derived('trend', 'opening', 'daily', 'daily')));
    store.dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id: 'load-regional', tableId: 'regional',
      parentNodeId: 'trend', createdAt: 3 }));
    store.dispatch(dfActions.insertDerivedTables(derived('regions', 'trend', 'trend', 'regional')));
    const theme = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
    const { container } = render(React.createElement(Provider, { store, children:
      React.createElement(ThemeProvider, { theme, children:
        React.createElement(LayoutProvider, { children: React.createElement(DataThread) }),
      }),
    }));
    const daily = container.querySelector('[data-thread-item="load-daily"]')!;
    const regional = container.querySelector('[data-thread-item="load-regional"]')!;
    expect(daily).toBeTruthy();
    expect(regional).toBeTruthy();
    const trend = screen.getByText('question trend');
    const regions = screen.getByText('question regions');
    expect(daily.compareDocumentPosition(trend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(trend.compareDocumentPosition(regional) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(regional.compareDocumentPosition(regions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

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
    fireEvent.click(screen.getByRole('button', { name: 'Expand thread' }));
    const references = container.querySelectorAll('[data-thread-item] .data-thread-card-wrapper[data-table-id="shared"]');
    expect(references).toHaveLength(2);
    fireEvent.click(references[1].querySelector('button')!);
    expect(references[0].querySelector('.selected-artifact-card')).toBeNull();
    expect(references[1].querySelector('.selected-artifact-card')).toBeTruthy();
    expect(store.getState().focusedId).toEqual({ type: 'reference', referenceId: 'second-reference' });
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