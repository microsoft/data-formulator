import React from 'react';
import 'prismjs';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { ThemeProvider, createTheme } from '@mui/material';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataFormulatorReducer, dfActions, dfSelectors } from '../../../../src/app/dfSlice';
import { DataThread } from '../../../../src/views/DataThread';
import { FreeDataViewFC } from '../../../../src/views/DataView';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { InteractionEntryCard, getStepIconComponent, PlanStepsView } from '../../../../src/views/InteractionEntryCard';
import { LayoutProvider } from '../../../../src/app/LayoutProvider';
const CONVERSATION_ROOT_ID = 'conversation-root:test';
import * as workspaceService from '../../../../src/app/workspaceService';
import { buildThreads } from '../../../../src/app/threadGraph';
import type { TextTurn } from '../../../../src/components/ComponentType';

vi.mock('../../../../src/views/SimpleChartRecBox', () => ({ SimpleChartRecBox: () => null }));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => vi.unstubAllGlobals());

const THEME = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
const threadElement = (store: any, props: { denseColumns?: boolean } = {}) => React.createElement(Provider, { store, children:
  React.createElement(ThemeProvider, { theme: THEME, children:
    React.createElement(LayoutProvider, { children: React.createElement(DataThread, props) }),
  }),
});
const renderDataThread = (store: any, props: { denseColumns?: boolean } = {}) => render(threadElement(store, props));
/** A user message node (design-docs/58): the prompt alone; the agent's reply is its own node. */
const userMessage = (id: string, prompt: string, parentNodeId: string, createdAt: number, extra: Partial<TextTurn> = {}) =>
  dfActions.addTextTurn({ kind: 'text', id, displayId: id, textKind: 'explain', content: '', prompt, parentNodeId, createdAt, ...extra });
const agentMessage = (id: string, content: string, parentNodeId: string, createdAt: number, extra: Partial<TextTurn> = {}) =>
  dfActions.addTextTurn({ kind: 'text', id, displayId: id, textKind: 'explain', content, parentNodeId, createdAt, ...extra });
/** A derived table; its conversation lives on the messages before it, not in `trigger.interaction`. */
const derivedTable = (id: string, displayId: string, parentNodeId: string, source: string[] = []) => ({
  kind: 'table', id, displayId, names: [], metadata: {}, rows: [], parentNodeId,
  derive: { source, code: '', dialog: [], trigger: { tableId: CONVERSATION_ROOT_ID, resultTableId: id } },
}) as any;
const sourceTable = (id: string, displayId: string) => ({ kind: 'table', id, displayId, names: [], metadata: {}, rows: [] }) as any;

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
  expect(document.querySelector('[data-thread-item^="textturn-old"]')).toBeNull();
  expect(screen.getByText('Analyze old pickups').closest('[data-thread-summary]')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'view chat' })).toHaveLength(2);
  const previousFocus = store.getState().focusedId;
  // The collapsed thread is one button: its request, its dotted timeline, and a line to expand it.
  const summary = screen.getByRole('button', { name: /^Analyze old pickups/ });
  expect(summary).toHaveAttribute('data-thread-summary');
  expect(summary).toHaveAttribute('aria-expanded', 'false');
  expect(summary).toHaveStyle({ fontFamily: theme.typography.fontFamily });
  expect(summary.querySelector('[data-thread-preview-line][data-role="user"]')?.textContent).toBe('Analyze old pickups');
  const gutter = summary.querySelector('[data-thread-collapsed-gutter]')!;
  expect(gutter).toHaveAttribute('aria-hidden', 'true');
  expect(gutter.firstElementChild).toHaveStyle({ borderLeftWidth: '2px', borderLeftStyle: 'dotted' });
  expect(summary.querySelector('[data-thread-collapsed-more]')?.textContent).toBe('Click to expand');
  fireEvent.click(summary);
  expect(store.getState().focusedId).toEqual(previousFocus);
  expect(screen.getByText('old response')).toBeTruthy();
  act(() => { addTurn('followup', 'new', 3); });
  expect(screen.getByText('old response')).toBeTruthy();
  expect(screen.getByText('followup response')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: 'Collapse thread' })[0]);
  expect(document.querySelector('[data-thread-item^="textturn-old"]')).toBeNull();
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
  expect(document.querySelector('[data-thread-item^="textturn-old"]')).toBeNull();
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
  const store = configureStore({ reducer: dataFormulatorReducer });
  // Six rounds, each a user message followed by the agent's reply.
  const rounds = [['first', 'Analyze token usage'], ['second', 'Use azure command'], ['third', 'Check third'],
    ['fourth', 'Check fourth'], ['fifth', 'Check fifth'], ['latest', 'Check latest']];
  const nodeIds: string[] = [];
  let parent = CONVERSATION_ROOT_ID;
  rounds.forEach(([id, prompt], index) => {
    store.dispatch(userMessage(`${id}-ask`, prompt, parent, index * 3));
    store.dispatch(agentMessage(id, `${id} response`, `${id}-ask`, index * 3 + 1));
    nodeIds.push(`${id}-ask`, id);
    parent = id;
    if (hasReport && id === 'second') {
      store.dispatch(dfActions.saveGeneratedReport({ id: 'pending-report', title: 'Pending report', content: '',
        parentNodeId: 'second', selectedChartIds: [], createdAt: index * 3 + 2, status: 'generating' }));
      nodeIds.push('pending-report');
      parent = 'pending-report';
    }
  });
  if (producesTable) {
    store.dispatch(userMessage('visualize', 'Visualize this result', 'latest', 20));
    store.dispatch(agentMessage('inspect-step', 'Inspecting resource usage', 'visualize', 21));
    store.dispatch(dfActions.addTableToStore(derivedTable('result-chart-table', 'Result', 'inspect-step')));
    store.dispatch(agentMessage('creation-done', 'Creation completed', 'result-chart-table', 23));
    store.dispatch(agentMessage('after-result', 'Response after the result', 'creation-done', 24));
    store.dispatch(dfActions.addChart({ id: 'result-chart', chartType: 'Bar Chart', tableRef: 'result-chart-table',
      source: 'user', encodingMap: {} } as any));
    nodeIds.push('visualize', 'inspect-step', 'result-chart-table', 'creation-done', 'after-result');
  }
  const segmentFocus = { type: 'conversation', tableId: 'thread-first-ask', nodeIds };
  const theme = THEME;
  const { container } = renderDataThread(store);
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
    expect(screen.getByText('Pending report')).toBeTruthy();
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
  expect(screen.getByText('second response')).toBeVisible();
  if (producesTable) {
    expect(screen.getByText('latest response')).toBeTruthy();
    expect(screen.getByText('Visualize this result')).toBeTruthy();
    expect(screen.getByText('Inspecting resource usage')).toBeTruthy();
  }
  expect(store.getState().focusedId).toEqual(segmentFocus);
  fireEvent.click(screen.getByText('second response'));
  expect(store.getState().focusedId).toEqual({ type: 'text', textId: 'second' });
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
    const hasDraft = scenario === 'live-draft' || scenario === 'interrupted-draft';
    const pending = scenario === 'pending';
    const initialState = dataFormulatorReducer(undefined, { type: 'init' });
    // A run continues after the table it produced: its live draft follows that table.
    const store = configureStore({ reducer: dataFormulatorReducer, preloadedState: {
      ...initialState,
      draftNodes: hasDraft ? [{ kind: 'draft', id: 'active-draft', displayId: 'Draft', parentNodeId: 'result', createdAt: 30,
        derive: { source: [], status: scenario === 'live-draft' ? 'running' : 'interrupted', runningPlan: 'Checking the result',
          trigger: { tableId: CONVERSATION_ROOT_ID, instruction: 'Inspect files' } } } as any] : [],
    } });
    const ids = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'latest'];
    ids.forEach((id, index) => {
      store.dispatch(userMessage(`${id}-ask`, `Ask ${id}`, index ? ids[index - 1] : CONVERSATION_ROOT_ID, index * 2));
      store.dispatch(agentMessage(id, `${id} response`, `${id}-ask`, index * 2 + 1, id === 'second'
        ? { executions: [{ id: 'command', argv: ['ls'], cwd: '.', purpose: 'Inspect files',
          status: pending ? 'awaiting_approval' : 'completed' }] } : {}));
    });
    if (scenario === 'loaded') {
      store.dispatch(dfActions.addTableToStore(sourceTable('result', 'Result')));
      store.dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id: 'load-result', tableId: 'result',
        parentNodeId: 'latest', createdAt: 20 }));
    }
    if (hasDraft) {
      store.dispatch(agentMessage('creating', 'Creating result', 'latest', 20));
      store.dispatch(dfActions.addTableToStore(derivedTable('result', 'Result', 'creating')));
    }
    renderDataThread(store);
    // A round awaiting approval stays out of the fold; settled middle rounds fold away.
    expect(!!screen.queryByText('second response')).toBe(pending);
    expect(screen.queryByRole('button', { name: 'Terminal execution details' })).toBeNull();
    expect(screen.getByText('first response')).toBeTruthy();
    expect(screen.getByText('latest response')).toBeTruthy();
    if (hasDraft) expect(screen.getByText('Creating result')).toBeTruthy();
    if (scenario === 'live-draft') expect(screen.getByText(/Checking the result/)).toBeTruthy();
    if (scenario === 'interrupted-draft') expect(screen.getByText(/Interrupted by page refresh/)).toBeTruthy();
    expect(screen.getByText(`${pending ? 4 : 5} earlier turns`)).toBeTruthy();
    if (!pending) expect(screen.getAllByText('Result').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Show earlier turns' }));
    for (const id of ids) expect(screen.getByText(`${id} response`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide earlier turns' }));
    expect(!!screen.queryByText('second response')).toBe(pending);
    expect(screen.getByText('latest response')).toBeTruthy();
    expect(store.getState().textTurns.find(turn => turn.id === 'second')?.executions?.[0].status)
      .toBe(pending ? 'awaiting_approval' : 'completed');
  },
);

it('highlights the displayed file when its closing chat response or follow-up is selected', () => {
  const store = configureStore({ reducer: dataFormulatorReducer });
  store.dispatch(userMessage('request', 'Create a daily trip workflow', CONVERSATION_ROOT_ID, 1));
  const file = { kind: 'file' as const, id: 'workflow-file', path: 'files/daily_trip_trend_workflow.md',
    displayName: 'Daily Trip Trend Workflow', parentNodeId: 'request', createdAt: 2, contentHash: 'workflow-hash' };
  store.dispatch(dfActions.upsertFileNode(file));
  store.dispatch(agentMessage('file-summary', 'Created Daily Trip Trend Workflow.', file.id, 3));
  store.dispatch(userMessage('follow-up-ask', 'Can the date change?', 'file-summary', 4));
  store.dispatch(agentMessage('follow-up', 'The target date is configurable.', 'follow-up-ask', 5));
  renderDataThread(store);
  for (const content of ['Created Daily Trip Trend Workflow.', 'The target date is configurable.']) {
    fireEvent.click(screen.getByText(content));
    expect(store.getState().focusedId?.type).toBe('text');
    expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'file', fileName: file.path });
    expect(screen.getByRole('button', { name: file.displayName }).closest('.selected-artifact-card')).toBeTruthy();
  }
  act(() => store.dispatch(dfActions.setFocused({ type: 'conversation', tableId: 'thread-request' })));
  expect(screen.getByRole('button', { name: file.displayName }).closest('.selected-artifact-card')).toBeNull();
});

it('renders a later branch off the turn that produced a table, with its file', () => {
  const store = configureStore({ reducer: dataFormulatorReducer });
  store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'lead', displayId: 'Lead', textKind: 'explain',
    prompt: 'Summarize the stocks', content: 'Here is the summary.', parentNodeId: CONVERSATION_ROOT_ID, createdAt: 1 }));
  store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'result', displayId: 'Result', names: [], metadata: {}, rows: [],
    parentNodeId: 'lead', derive: { source: [], code: '', dialog: [], trigger: {
      tableId: CONVERSATION_ROOT_ID, resultTableId: 'result', instruction: 'Summarize',
      interaction: [{ from: 'data-agent', to: 'user', role: 'instruction', content: 'Summarize' }],
    } } } as any));
  // Asked later while the first explanation was focused: a second branch off 'lead'.
  store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'branch', displayId: 'Branch', textKind: 'explain',
    prompt: 'Build an interactive app', content: 'Built the explorer app.', parentNodeId: 'lead', createdAt: 5 }));
  store.dispatch(dfActions.upsertFileNode({ kind: 'file', id: 'file-explorer.app.jsx', path: 'explorer.app.jsx',
    displayName: 'Stock Explorer', parentNodeId: 'branch', createdAt: 6, contentHash: 'app-hash' }));
  const theme = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
  render(React.createElement(Provider, { store, children:
    React.createElement(ThemeProvider, { theme, children:
      React.createElement(LayoutProvider, { children: React.createElement(DataThread) }),
    }),
  }));
  expect(screen.getByText('Built the explorer app.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Stock Explorer' })).toBeTruthy();
  expect(document.querySelectorAll('[data-thread-item="file-explorer.app.jsx"]')).toHaveLength(1);
});

it('opens, updates, and deletes a file result without a text turn, retaining it on deletion failure', async () => {
  const store = configureStore({ reducer: dataFormulatorReducer });
  const file = { kind: 'file' as const, id: 'file-result', path: 'scratch/cpi.parquet',
    displayName: 'CPI Summary', contentHash: 'v1', parentNodeId: CONVERSATION_ROOT_ID, createdAt: 1 };
  store.dispatch(dfActions.upsertFileNode(file));
  renderDataThread(store);
  expect(store.getState().textTurns).toEqual([]);
  expect(buildThreads(dfSelectors.getThreadGraph(store.getState())).map(thread => thread.nodeIds)).toEqual([[file.id]]);
  fireEvent.click(screen.getByRole('button', { name: 'CPI Summary' }));
  expect(store.getState().focusedId).toEqual({ type: 'file', fileName: file.path });
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
  const store = configureStore({ reducer: dataFormulatorReducer });
  store.dispatch(agentMessage('only-turn', 'Inspect deployment volume', CONVERSATION_ROOT_ID, 1));
  if (scenario === 'derived') store.dispatch(dfActions.addTableToStore(derivedTable('result', 'Result', 'only-turn')));
  else {
    store.dispatch(dfActions.addTableToStore(sourceTable('result', 'Result')));
    store.dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id: 'load-result', tableId: 'result',
      parentNodeId: 'only-turn', createdAt: 2 }));
  }
  renderDataThread(store);
  expect(screen.getByText('Inspect deployment volume')).toBeTruthy();
  expect(screen.getAllByText('Result').length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: 'Show earlier turns' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Hide earlier turns' })).toBeNull();
  expect(screen.queryByText('1 earlier turns')).toBeNull();
});

it.each(['derived', 'loaded', 'ongoing'].flatMap(scenario => [5, 6].map(count => ({ scenario, count }))))(
  'keeps complete endpoint exchanges and folds only more than three middle turns: $scenario, $count turns', ({ scenario, count }) => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    for (let index = 0; index < count; index++) {
      store.dispatch(userMessage(`request-${index}`, `Request ${index}`, index ? `response-${index - 1}` : CONVERSATION_ROOT_ID, index * 2));
      store.dispatch(agentMessage(`response-${index}`, `Response ${index}`, `request-${index}`, index * 2 + 1));
    }
    const lastResponse = `response-${count - 1}`;
    if (scenario === 'derived') store.dispatch(dfActions.addTableToStore(derivedTable('result', 'Result', lastResponse)));
    if (scenario === 'loaded') {
      store.dispatch(dfActions.addTableToStore(sourceTable('result', 'Result')));
      store.dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id: 'load-result', tableId: 'result',
        parentNodeId: lastResponse, createdAt: count * 2 }));
    }
    renderDataThread(store);
    for (const index of [0, count - 1]) {
      expect(screen.getByText(`Request ${index}`)).toBeTruthy();
      expect(screen.getByText(`Response ${index}`)).toBeTruthy();
      const block = screen.getByText(`Request ${index}`).closest('[data-thread-flow-block]');
      expect(block).toBeTruthy();
      expect(screen.getByText(`Response ${index}`).closest('[data-thread-flow-block]')).toBe(block);
    }
    if (scenario !== 'ongoing') {
      const result = screen.getAllByText('Result').find(element => element.closest('[data-thread-flow-block]'))!;
      expect(result).toBeTruthy();
      expect(screen.getByText(`Response ${count - 1}`).compareDocumentPosition(result) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    const call = (id: string, status: 'completed' | 'awaiting_approval' = 'completed') =>
      ({ id: `${id}-command`, argv: ['az', id], cwd: '.', purpose: id, status });
    // A step's tool calls collect on its agent message; a user message or a new run starts another step.
    const separate = boundary === 'user' || boundary === 'new-run';
    store.dispatch(agentMessage('inspect', 'inspect resource details', CONVERSATION_ROOT_ID, 0, { actionId: 'same-run',
      executions: separate ? [call('inspect')] : [call('inspect'), call('list', boundary === 'pending' ? 'awaiting_approval' : 'completed')] }));
    if (boundary === 'user') store.dispatch(userMessage('retry', 'Try another resource', 'inspect', 1, { actionId: 'same-run' }));
    if (separate) store.dispatch(agentMessage('list', 'list resource details', boundary === 'user' ? 'retry' : 'inspect', 2,
      { actionId: boundary === 'new-run' ? 'another-run' : 'same-run', executions: [call('list')] }));
    const owner = separate ? 'list' : 'inspect';
    store.dispatch(agentMessage('findings', 'Final findings', owner, 3, { actionId: 'same-run' }));
    const { container } = renderDataThread(store);
    expect(container.querySelectorAll('[data-agent-work-group]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-tool-activity-row]')).toHaveLength(separate ? 2 : 1);
    expect(screen.queryByText('az inspect')).toBeNull();
    expect(screen.getByText('inspect resource details')).toBeVisible();
    expect(!!screen.queryByText('list resource details')).toBe(separate);
    expect(screen.getByText('Final findings')).toBeVisible();
    if (boundary === 'user') expect(screen.getByText('Try another resource')).toBeVisible();
    const focus = store.getState().focusedId;
    const onActivity = vi.fn();
    window.addEventListener('df-view-tool-activity', onActivity, { once: true });
    const label = `${owner} resource details`;
    fireEvent.click(screen.getByText(label));
    expect(onActivity).not.toHaveBeenCalled();
    const group = screen.getByText(label).closest('[data-tool-activity-row]')! as HTMLElement;
    fireEvent.click(within(group).getByRole('button', { name: 'list' }));
    const detail = (onActivity.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.nodeId).toBe(owner);
    expect(detail.execution).toMatchObject({ id: 'list-command', status: boundary === 'pending' ? 'awaiting_approval' : 'completed' });
    expect(store.getState().focusedId).toEqual(focus);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Terminal execution details' })).toBeNull();
    expect(store.getState().textTurns).toHaveLength(boundary === 'user' ? 4 : separate ? 3 : 2);
  },
);

it('keeps a step\'s tool calls on one message while preserving its loaded and derived outputs', () => {
  const store = configureStore({ reducer: dataFormulatorReducer });
  store.dispatch(userMessage('ask', 'Analyze daily usage', CONVERSATION_ROOT_ID, 0, { actionId: 'acquire-run' }));
  store.dispatch(agentMessage('acquire', 'Acquiring usage', 'ask', 1, { actionId: 'acquire-run',
    executions: Array.from({ length: 6 }, (_, index) => ({ id: `terminal-${index}`, argv: ['az', 'query'], cwd: '.',
      purpose: `Acquire ${index}`, status: index >= 4 ? 'failed' as const : 'completed' as const })) }));
  store.dispatch(dfActions.addTableToStore(sourceTable('usage-input', 'Daily usage input')));
  store.dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id: 'usage-reference', tableId: 'usage-input',
    parentNodeId: 'acquire', createdAt: 2 }));
  store.dispatch(agentMessage('visualize-step', 'Visualize daily usage', 'usage-reference', 3, { actionId: 'acquire-run' }));
  store.dispatch(dfActions.addTableToStore(derivedTable('usage-result', 'Usage trend', 'visualize-step', ['usage-input'])));
  const { container } = renderDataThread(store);
  expect(container.querySelectorAll('[data-agent-work-group]')).toHaveLength(0);
  expect(screen.getByText('Analyze daily usage')).toBeVisible();
  expect(container.querySelectorAll('[data-tool-activity-row]')).toHaveLength(1);
  expect(screen.queryByRole('img', { name: 'Failed' })).toBeNull();
  const focus = store.getState().focusedId;
  const onActivity = vi.fn();
  window.addEventListener('df-view-tool-activity', onActivity, { once: true });
  fireEvent.click(screen.getByText('Acquiring usage'));
  expect(onActivity).not.toHaveBeenCalled();
  const group = screen.getByText('Acquiring usage').closest('[data-tool-activity-row]')! as HTMLElement;
  for (let index = 0; index < 6; index++) expect(within(group).getByRole('button', { name: `Acquire ${index}` })).toBeVisible();
  fireEvent.click(within(group).getByRole('button', { name: 'Acquire 5' }));
  expect((onActivity.mock.calls[0][0] as CustomEvent).detail.nodeId).toBe('acquire');
  expect(store.getState().focusedId).toEqual(focus);
  const output = container.querySelector('[data-thread-item="usage-reference"]')!;
  expect(output).toBeVisible();
  const instruction = screen.getByText('Visualize daily usage');
  expect(group.compareDocumentPosition(output) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(output.compareDocumentPosition(instruction) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText('Usage trend')).toBeVisible();
  expect(instruction.compareDocumentPosition(screen.getByText('Usage trend')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(store.getState().loadedTableNodes[0].parentNodeId).toBe('acquire');
});

it('shows one live activity spinner and opens the execution step directly', async () => {
  const initialState = dataFormulatorReducer(undefined, { type: 'init' });
  const store = configureStore({ reducer: dataFormulatorReducer, preloadedState: {
    ...initialState,
    draftNodes: [{ kind: 'draft', id: 'live-draft', displayId: 'Draft', parentNodeId: 'command', createdAt: 7,
      derive: { source: [], code: '', dialog: [], status: 'running', runningPlan: 'Old fallback text',
        progressSteps: [{ id: 'live-command', kind: 'tool', tool: 'run_terminal', executionId: 'execution-6',
          label: 'Running command fixture', status: 'running' }], trigger: {
        tableId: CONVERSATION_ROOT_ID, resultTableId: 'live-draft', instruction: '', interaction: [],
      } },
    } as any],
  } });
  store.dispatch(userMessage('ask', 'Analyze usage', CONVERSATION_ROOT_ID, 0, { actionId: 'one-run' }));
  // The run's step: every tool call so far sits on its one agent message.
  const step = { kind: 'text' as const, id: 'command', displayId: 'Command', textKind: 'explain' as const,
    content: 'Querying usage', createdAt: 1, parentNodeId: 'ask', actionId: 'one-run',
    executions: Array.from({ length: 7 }, (_, index) => ({ id: `execution-${index}`, argv: ['az', 'query', String(index)],
      cwd: '.', purpose: `Query ${index}`, createdAt: index,
      status: index === 4 ? 'interrupted' as const : index === 5 ? 'failed' as const : index === 6 ? 'running' as const : 'completed' as const })) };
  store.dispatch(dfActions.addTextTurn(step));
  const theme = THEME;
  const { container } = renderDataThread(store);
  expect(container.querySelectorAll('[data-agent-work-group]')).toHaveLength(0);
  expect(screen.getByText('Analyze usage')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Show earlier turns' })).toBeNull();
  const activity = screen.getByText('Querying usage').closest('[data-thread-item]')! as HTMLElement;
  expect(activity).toBeVisible();
  expect(activity.querySelector('[data-activity-gutter] svg')).toBeNull();
  expect(screen.getByText(/Running command fixture/)).toBeVisible();
  expect(screen.queryByText('Old fallback text')).toBeNull();
  // KNOWN PRODUCT BUG (fails today): the running call spins twice, once on the step's
  // tool activity row (ToolActivityRow `active`) and once on the draft's thinking row.
  expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  expect(screen.queryByRole('img', { name: 'Running' })).toBeNull();
  expect(screen.queryByRole('img', { name: 'Failed' })).toBeNull();
  const focus = store.getState().focusedId;
  const onActivity = vi.fn();
  window.addEventListener('df-view-tool-activity', onActivity, { once: true });
  fireEvent.click(screen.getByText('Querying usage'));
  expect(onActivity).not.toHaveBeenCalled();
  expect(within(within(activity).getByRole('button', { name: 'Query 6' })).getByRole('progressbar')).toBeVisible();
  expect(within(within(activity).getByRole('button', { name: 'Query 0' })).getByTestId('CheckCircleOutlineIcon')).toBeVisible();
  expect(within(within(activity).getByRole('button', { name: 'Query 4' })).getByTestId('PauseCircleOutlineIcon')).toBeVisible();
  const failedStatus = within(within(activity).getByRole('button', { name: 'Query 5' })).getByTestId('ErrorOutlineIcon');
  expect(failedStatus).toBeVisible();
  expect(failedStatus.parentElement).toHaveStyle({ color: theme.palette.text.secondary, width: '12px', flexShrink: '0' });
  fireEvent.click(within(activity).getByRole('button', { name: 'Query 6' }));
  expect((onActivity.mock.calls[0][0] as CustomEvent).detail.nodeId).toBe('command');
  expect(store.getState().focusedId).toEqual(focus);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Collapse thread' }));
  expect(screen.queryByText(/Running command fixture/)).toBeNull();
  expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Expand thread' }));
  act(() => store.dispatch(dfActions.addTextTurn({ ...step,
    executions: step.executions.map(execution => execution.id === 'execution-6' ? { ...execution, status: 'completed' as const } : execution) })));
  act(() => store.dispatch(dfActions.removeDraftNode('live-draft')));
  expect(screen.queryByText(/Running command fixture/)).toBeNull();
  expect(screen.queryByRole('progressbar')).toBeNull();
  window.addEventListener('df-view-tool-activity', onActivity, { once: true });
  // The selected call keeps its step's row open across re-renders.
  const completedGroup = screen.getByText('Querying usage').closest('[data-tool-activity-row]')! as HTMLElement;
  expect(within(within(completedGroup).getByRole('button', { name: 'Query 6' })).getByTestId('CheckCircleOutlineIcon')).toBeVisible();
  fireEvent.click(within(completedGroup).getByRole('button', { name: 'Query 6' }));
  expect((onActivity.mock.calls[1][0] as CustomEvent).detail.nodeId).toBe('command');
  expect(store.getState().focusedId).toEqual(focus);
  expect(screen.queryByRole('button', { name: 'Terminal execution details' })).toBeNull();
  expect(store.getState().textTurns).toHaveLength(2);
  expect(store.getState().textTurns[1].executions![5].status).toBe('failed');
});

it('opens terminal and Python calls from their chart step with aligned tool icons', () => {
  const store = configureStore({ reducer: dataFormulatorReducer });
  store.dispatch(agentMessage('unrelated-call', 'Other task', 'conversation-root:other', 0, { actionId: 'other-run',
    executions: [{ id: 'unrelated', argv: ['pwd'], cwd: '.', purpose: 'Other task', status: 'completed' }] }));
  // The step that made the table holds both of its tool calls.
  store.dispatch(agentMessage('analysis-step', 'Compare storage accounts', CONVERSATION_ROOT_ID, 1, { actionId: 'analysis',
    executions: [{ id: 'terminal', argv: ['az', 'query'], cwd: '.', purpose: 'Fetch input', status: 'completed', createdAt: 1 }],
    codeExecutions: [{ id: 'python', tool: 'execute_python_script', code: 'print(42)', purpose: 'Inspect input',
      status: 'completed', createdAt: 2 }] } as Partial<TextTurn>));
  store.dispatch(dfActions.addTableToStore(derivedTable('chart-result', 'Chart result', 'analysis-step')));
  const onOpen = vi.fn();
  window.addEventListener('df-view-tool-activity', onOpen);
  try {
    const { container } = renderDataThread(store);
    const step = container.querySelector('[data-thread-item="textturn-analysis-step"]')! as HTMLElement;
    const group = container.querySelector('[data-thread-item="textturn-analysis-step-activity"]')! as HTMLElement;
    expect(step).toBeTruthy();
    expect(group).toHaveAttribute('data-secondary-activity');
    const activity = within(group).getByRole('button', { name: 'View step tool calls' });
    expect(document.querySelectorAll('[data-tool-activity-row]')).toHaveLength(1);
    expect(within(step).queryByTestId('CodeIcon')).toBeNull();
    expect(group.querySelector('[data-activity-gutter] svg')).toBeNull();
    expect(within(group).queryByTestId('CodeIcon')).toBeNull();
    expect(activity.compareDocumentPosition(step) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(activity);
    expect(onOpen).not.toHaveBeenCalled();
    const call = within(group).getByRole('button', { name: 'Inspect input' });
    expect(call).toBeVisible();
    expect(call.parentElement).toHaveStyle({ paddingLeft: '0px' });
    expect(call).toHaveStyle({ paddingLeft: '0px' });
    expect(getComputedStyle(call).gap).toBe(getComputedStyle(activity).gap);
    const codeIcon = within(group).getByTestId('CodeIcon');
    const terminalIcon = within(group).getByTestId('TerminalIcon');
    expect(getComputedStyle(codeIcon).width).toBe(getComputedStyle(terminalIcon).width);
    expect(getComputedStyle(codeIcon).height).toBe(getComputedStyle(terminalIcon).height);
    fireEvent.click(call);
    const detail = (onOpen.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.nodeId).toBe('analysis-step');
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

it('keeps a long thread whole across dense columns and renders each output once', () => {
  const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  const store = configureStore({ reducer: dataFormulatorReducer });
  const appendTable = (index: number) => {
    const parent = index ? `segment-table-${index - 1}` : CONVERSATION_ROOT_ID;
    store.dispatch(agentMessage(`segment-step-${index}`, `Result ${index}`, parent, index * 2));
    store.dispatch(dfActions.addTableToStore(derivedTable(`segment-table-${index}`, `Output ${index}`, `segment-step-${index}`)));
  };
  for (let index = 0; index < 4; index++) appendTable(index);
  store.dispatch(agentMessage('later-step', 'Later analysis', 'conversation-root:later', 100));
  store.dispatch(dfActions.addTableToStore(derivedTable('later-thread', 'Later thread', 'later-step')));
  try {
    const { container, rerender } = renderDataThread(store, { denseColumns: true });
    const outputBlock = (id: string) => container.querySelectorAll(`[data-thread-flow-block="output-${id}"]`);
    const segmentOf = (index: number) => outputBlock(`segment-table-${index}`)[0]
      ?.closest('[data-thread-segment]')?.getAttribute('data-thread-segment');
    // Only the newest thread opens at first.
    expect(segmentOf(0)).toBeUndefined();
    expect(container.querySelectorAll('[data-thread-active]')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Expand thread' }));
    expect(new Set(Array.from({ length: 4 }, (_, index) => segmentOf(index))).size).toBe(1);
    act(() => { for (let index = 4; index < 10; index++) appendTable(index); });
    const segments = Array.from({ length: 10 }, (_, index) => segmentOf(index));
    expect(segments.every(segment => segment !== undefined)).toBe(true);
    expect(new Set(segments).size).toBe(1);
    for (let index = 0; index < 10; index++) {
      expect(outputBlock(`segment-table-${index}`)).toHaveLength(1);
      if (index) expect(outputBlock(`segment-table-${index - 1}`)[0]
        .compareDocumentPosition(outputBlock(`segment-table-${index}`)[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    const lastOutput = outputBlock('segment-table-9')[0];
    const laterOutput = outputBlock('later-thread')[0];
    expect(lastOutput.compareDocumentPosition(laterOutput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll('[data-thread-item^="used-table-ref-"]')).toHaveLength(0);
    act(() => { store.dispatch(dfActions.setFocused({ type: 'table', tableId: 'segment-table-0' })); });
    expect(container.querySelectorAll('[data-thread-highlighted="true"]')).toHaveLength(1);
    expect(lastOutput.closest('[data-thread-highlighted]')).toHaveAttribute('data-thread-highlighted', 'true');
    fireEvent.click(screen.getAllByRole('button', { name: 'view chat' })[0]);
    expect(store.getState().focusedId).toEqual({ type: 'conversation', tableId: 'thread-segment-step-0',
      nodeIds: Array.from({ length: 10 }, (_, index) => [`segment-step-${index}`, `segment-table-${index}`]).flat() });
    expect(container.querySelectorAll('[data-thread-active="true"]')).toHaveLength(1);
    rerender(threadElement(store, { denseColumns: false }));
    expect(container.querySelectorAll('[data-thread-segment]')).toHaveLength(1);
    for (let index = 0; index < 10; index++) expect(segmentOf(index)).toBe('0');
    expect(container.querySelectorAll('[data-thread-active]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-thread-joined-above="true"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-thread-joined-below="true"]')).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: 'view chat' })).toHaveLength(2);
    for (let index = 0; index < 10; index++) expect(outputBlock(`segment-table-${index}`)).toHaveLength(1);
    rerender(threadElement(store, { denseColumns: true }));
    expect(new Set(Array.from({ length: 10 }, (_, index) => segmentOf(index))).size).toBe(1);
    expect(container.querySelectorAll('[data-thread-joined-above="true"]')).toHaveLength(0);
  } finally {
    height.mockRestore();
  }
});

// The design-docs/58 renderer packs whole threads into columns; it no longer splits
// one long thread into joined pieces (SingleThreadGroupView's isSplitThread/joinedAbove/
// joinedBelow props are never passed by DataThread).
it.todo('splits a long thread into visually joined pieces across dense columns');

describe('thread provenance', () => {
  it('places mid-run loads after the output that preceded them', () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    const source = (id: string) => ({ kind: 'table', id, displayId: id, names: [], metadata: {}, rows: [],
      virtual: { tableId: id, rowCount: 0 } }) as any;
    const derived = (id: string, parentNodeId: string, triggerTableId: string, input: string) => ({
      ...source(id), displayId: `${id} chart`, parentNodeId,
      derive: { source: [input], code: '', dialog: [], trigger: { tableId: triggerTableId, resultTableId: id } },
    }) as any;
    store.dispatch(dfActions.addTableToStore(source('daily')));
    store.dispatch(dfActions.addTableToStore(source('regional')));
    // One run: every load and table joins the chain, each step's message just before its table.
    store.dispatch(agentMessage('opening', 'opening response', CONVERSATION_ROOT_ID, 1));
    store.dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id: 'load-daily', tableId: 'daily',
      parentNodeId: 'opening', createdAt: 2 }));
    store.dispatch(agentMessage('trend-step', 'question trend', 'load-daily', 3));
    store.dispatch(dfActions.insertDerivedTables(derived('trend', 'trend-step', 'daily', 'daily')));
    store.dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id: 'load-regional', tableId: 'regional',
      parentNodeId: 'trend', createdAt: 5 }));
    store.dispatch(agentMessage('regions-step', 'question regions', 'load-regional', 6));
    store.dispatch(dfActions.insertDerivedTables(derived('regions', 'regions-step', 'trend', 'regional')));
    const { container } = renderDataThread(store);
    expect(buildThreads(dfSelectors.getThreadGraph(store.getState())).find(thread => thread.nodeIds.includes('regions'))?.nodeIds)
      .toEqual(['opening', 'load-daily', 'trend-step', 'trend', 'load-regional', 'regions-step', 'regions']);
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
    // Data lineage (derive.source, inputSources, trigger) never decides placement (design-docs/58 §2.3).
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.addTableToStore(sourceTable('other', 'Other')));
    store.dispatch(userMessage('ask', 'Combine the inputs', CONVERSATION_ROOT_ID, 1));
    store.dispatch(agentMessage('step', 'Joining inputs', 'ask', 2));
    store.dispatch(dfActions.addTableToStore({ ...derivedTable('result', 'Result', 'step', ['other']), derive: {
      source: ['other'], code: '', dialog: [], inputSources: [
        { kind: 'file', id: 'scratch/inputs.csv', displayName: 'Inputs' },
        { kind: 'data', id: 'other', displayName: 'Other' },
      ], trigger: { tableId: 'other', resultTableId: 'result' },
    } }));
    const graph = dfSelectors.getThreadGraph(store.getState());
    expect(graph.parentOf('result')).toBe('step');
    expect(graph.rootOf('result')).toBe(CONVERSATION_ROOT_ID);
    const threads = buildThreads(graph);
    expect(threads.find(thread => thread.nodeIds.includes('result'))).toMatchObject({
      rootId: CONVERSATION_ROOT_ID, nodeIds: ['ask', 'step', 'result'] });
    expect(threads.find(thread => thread.nodeIds.includes('other'))?.nodeIds).toEqual(['other']);
  });
});

it('names the connected source a loaded table was queried from in its table view, not the thread', () => {
  const store = configureStore({ reducer: dataFormulatorReducer });
  store.dispatch(dfActions.upsertExternalTableReference({ kind: 'external-table-reference', id: 'external:kusto:Beats',
    connectorId: 'kusto', tableKey: 'Beats', sourceTable: { id: 'Beats', name: 'Beats' }, displayName: 'Beats alerts (Kusto)',
    capturedAt: '2026-10-11T00:00:00Z', summary: { columns: [], rowCount: 5 } } as any));
  store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'beats_alerts', displayId: 'Beats Security Alerts', names: ['severity'],
    metadata: { severity: { type: 'string' } }, rows: [{ severity: 'high' }], virtual: { tableId: 'beats_alerts', rowCount: 1 },
    source: { type: 'database', importedFrom: { connectorId: 'kusto', tableKey: 'Beats' } } } as any));
  store.dispatch(userMessage('ask', 'Load Beats alerts', CONVERSATION_ROOT_ID, 1));
  store.dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id: 'loaded', tableId: 'beats_alerts', parentNodeId: 'ask', createdAt: 2 }));
  const thread = renderDataThread(store);
  expect(thread.container.querySelector('[data-thread-item="loaded"]')!.textContent).toBe('Beats Security Alerts');
  thread.unmount();
  render(React.createElement(Provider, { store, children: React.createElement(DndProvider, { backend: HTML5Backend,
    children: React.createElement(FreeDataViewFC, { tableId: 'beats_alerts', showHeaderBar: true }) }) }));
  const source = screen.getByRole('button', { name: /from .*Beats/ });
  fireEvent.click(source);
  expect(store.getState().focusedId).toEqual({ type: 'external-table', referenceId: 'external:kusto:Beats' });
});


it.each([['gave an instruction', 'Compare alert severity by scenario'], ['gave none', '']])(
  'shows the step before a derived table as its tool calls, plus its instruction only when the agent %s', (_label, content) => {
  const store = configureStore({ reducer: dataFormulatorReducer });
  store.dispatch(userMessage('ask', 'Compare all three', CONVERSATION_ROOT_ID, 1));
  store.dispatch(agentMessage('step', content, 'ask', 2, { codeExecutions: [{ id: 'check', tool: 'execute_python_script',
    purpose: 'Check coverage', code: 'print(1)', status: 'completed' }], progressSteps: [{ id: 'tool', kind: 'tool',
    tool: 'execute_python_script', executionId: 'check', label: 'Running code Check coverage', status: 'completed' }] }));
  store.dispatch(dfActions.addTableToStore(derivedTable('result', 'Scenario Severity Comparison', 'step') as any));
  store.dispatch(dfActions.addChart({ id: 'chart', chartType: 'Bar Chart', tableRef: 'result', source: 'user', encodingMap: {},
    title: 'Security alert volume by scenario and severity' } as any));
  const { container } = renderDataThread(store);
  const items = [...container.querySelectorAll('[data-thread-item]')].map(item => item.getAttribute('data-thread-item'));
  // request → the step's one tool call → (its instruction) → the table; the chart title is not a message
  expect(items.slice(0, content ? 4 : 3)).toEqual(['textturn-prompt-ask-0', 'textturn-step-activity',
    ...(content ? ['textturn-step'] : []), 'regular-table-box-result']);
  if (content) {
    expect(container.querySelector('[data-thread-item="textturn-step"]')!.textContent).toContain(content);
    expect(container.querySelector('[data-thread-item="textturn-step"]')!.textContent).not.toContain('Check coverage');
  }
  expect(container.querySelector('[data-thread-item="textturn-step-activity"]')!.textContent).toContain('1');
});

it('highlights every member of a set on the focused chain', () => {
  const store = configureStore({ reducer: dataFormulatorReducer });
  store.dispatch(userMessage('ask', 'Compare all three', CONVERSATION_ROOT_ID, 1));
  for (const id of ['beats', 'titan']) {
    store.dispatch(dfActions.addTableToStore({ kind: 'table', id, displayId: id, names: [], metadata: {}, rows: [] } as any));
    store.dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id: `loaded-${id}`, tableId: id, parentNodeId: 'ask', createdAt: 2 }));
  }
  store.dispatch(dfActions.addArtifactSet({ kind: 'artifact-set', id: 'set', parentNodeId: 'ask', memberIds: ['loaded-beats', 'loaded-titan'], createdAt: 2 }));
  store.dispatch(dfActions.addTableToStore(derivedTable('result', 'Result', 'set') as any));
  store.dispatch(dfActions.setFocused({ type: 'table', tableId: 'result' }));
  const { container } = renderDataThread(store);
  const onChain = (key: string) => container.querySelector(`[data-thread-item="${key}"]`)!.getAttribute('data-thread-on-chain');
  expect(['artifact-set-set', 'loaded-beats', 'loaded-titan', 'regular-table-box-result'].map(onChain)).toEqual(['true', 'true', 'true', 'true']);
});


it('shows a running step by its shimmer, without a ticking client timer', () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'Date'] });
  try {
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(userMessage('ask', 'Find security tables', CONVERSATION_ROOT_ID, 1));
    store.dispatch(dfActions.createDraftNode({ id: 'live', displayId: 'Live', parentNodeId: 'ask', parentTableId: 'ask',
      source: [], interaction: [] }));
    store.dispatch(dfActions.updateDraftRunningPlan({ draftId: 'live', plan: 'Searching: (table)', progressSteps: [
      { id: 'search', kind: 'tool', tool: 'find_data', label: 'Searching: (table)', status: 'running' }] }));
    const { container } = renderDataThread(store);
    act(() => { vi.advanceTimersByTime(5000); });
    const thinking = container.querySelector('[data-thread-item="agent-thinking-live"]')!;
    expect(thinking.textContent).toContain('Searching: (table)');
    expect(thinking.textContent).not.toMatch(/\d+s\b/);
  } finally {
    vi.useRealTimers();
  }
});

it('re-packs columns when threads grow while no run is active, and holds them still during a run', () => {
  // Each thread is 40px per row; the layout measures entries and packs them into two columns.
  const offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-thread-entry') ? 40 * this.querySelectorAll('[data-thread-item]').length : 0;
  });
  try {
    const store = configureStore({ reducer: dataFormulatorReducer });
    const grow = (thread: string, from: number, to: number) => {
      for (let turn = from; turn < to; turn++) store.dispatch(agentMessage(`${thread}-${turn}`, `${thread} response ${turn}`,
        turn ? `${thread}-${turn - 1}` : `conversation-root:${thread}`, turn + (thread === 'a' ? 0 : thread === 'b' ? 100 : 200)));
    };
    grow('a', 0, 3); grow('b', 0, 1); grow('c', 0, 1);
    const { container } = renderDataThread(store, { denseColumns: true });
    for (let index = 0; index < 2; index++) fireEvent.click(screen.getAllByRole('button', { name: 'Expand thread' })[0]);
    const columns = () => ['a', 'b', 'c'].map(thread => screen.getByText(`${thread} response 0`)
      .closest('[data-thread-column]')?.getAttribute('data-thread-column'));
    // a=3 rows | b=1, c=1
    expect(columns()).toEqual(['0', '1', '1']);
    // c grows during a run: the columns hold still.
    act(() => {
      store.dispatch(dfActions.createDraftNode({ id: 'live', displayId: 'Live', parentNodeId: 'c-0', parentTableId: 'c-0',
        source: [], interaction: [] }));
    });
    act(() => {
      grow('c', 1, 10);
      store.dispatch(dfActions.moveDraftNode({ draftId: 'live', parentNodeId: 'c-9' }));
    });
    expect(columns()).toEqual(['0', '1', '1']);
    // The run ends: c is re-measured and the columns re-pack as a+b | c.
    act(() => { store.dispatch(dfActions.removeDraftNode('live')); });
    expect(columns()).toEqual(['0', '0', '1']);
    // Outside a run, a thread that grows is re-measured too: a=20 rows | b, c.
    act(() => grow('a', 3, 20));
    expect(columns()).toEqual(['0', '1', '1']);
    expect(container.querySelectorAll('[data-thread-column]')).toHaveLength(2);
  } finally {
    offsetHeight.mockRestore();
  }
});

it('previews a collapsed thread as muted lines: its first turn, how many more, and its latest', () => {
  const store = configureStore({ reducer: dataFormulatorReducer });
  // An older thread that produced two tables, and a newer one that only answered.
  store.dispatch(userMessage('ask', 'Compare review scores', 'conversation-root:old', 1));
  store.dispatch(agentMessage('step', 'Score bands', 'ask', 2));
  store.dispatch(dfActions.addTableToStore(derivedTable('bands', 'Score Bands', 'step') as any));
  store.dispatch(agentMessage('step-2', 'Portfolio', 'bands', 3));
  store.dispatch(dfActions.addTableToStore(derivedTable('portfolio', 'Portfolio Reception', 'step-2') as any));
  store.dispatch(agentMessage('closing', 'Reception **varies** across the portfolio.', 'portfolio', 4));
  store.dispatch(userMessage('hello', 'Which sources are connected?', 'conversation-root:new', 10));
  store.dispatch(agentMessage('answer', 'Three sources are connected.', 'hello', 11));
  act(() => { store.dispatch(dfActions.setFocused(undefined)); });
  const { container } = renderDataThread(store);
  for (const button of screen.queryAllByRole('button', { name: 'Collapse thread' })) fireEvent.click(button);
  const previews = [...container.querySelectorAll('[data-thread-summary]')];
  expect(previews).toHaveLength(2);
  const lines = (preview: Element) => [...preview.querySelectorAll('[data-thread-preview-line], [data-thread-preview-more]')]
    .map(line => line.textContent);
  // Plain muted text, no card; markdown symbols are dropped.
  expect(previews[0].querySelector('[data-thread-preview-request]')).toBeNull();
  expect(lines(previews[0])).toEqual(['Compare review scores', '… 4 more turns', 'Reception varies across the portfolio.']);
  expect(lines(previews[1])).toEqual(['Which sources are connected?', 'Three sources are connected.']);
  // The lines, the dotted timeline with its arrow, and "Click to expand" are one button.
  expect(previews[0].tagName).toBe('BUTTON');
  expect(previews[0].querySelector('[data-thread-collapsed-more]')?.textContent).toBe('Click to expand');
  expect(previews[0].querySelector('[data-testid="KeyboardArrowDownIcon"]')).toBeTruthy();
  expect(previews[0].querySelectorAll('button')).toHaveLength(0);
  fireEvent.click(previews[0].querySelector('[data-thread-collapsed-more]')!);
  expect(container.querySelector('[data-thread-item="regular-table-box-portfolio"]')).toBeTruthy();
});


it('keeps a collapsed thread grey when the focus is only further down its chain', () => {
  const store = configureStore({ reducer: dataFormulatorReducer });
  // ask → step → bands → closing (thread 1); bands → branch (thread 2, focused)
  store.dispatch(userMessage('ask', 'Score bands', CONVERSATION_ROOT_ID, 1));
  store.dispatch(agentMessage('step', 'Bands', 'ask', 2));
  store.dispatch(dfActions.addTableToStore(derivedTable('bands', 'Score Bands', 'step') as any));
  store.dispatch(agentMessage('closing', 'Done.', 'bands', 4));
  store.dispatch(userMessage('branch', 'Now by platform', 'bands', 5));
  store.dispatch(dfActions.setFocused({ type: 'text', textId: 'branch' }));
  const { container } = renderDataThread(store);
  const collapse = screen.getAllByRole('button', { name: 'Collapse thread' })
    .find(button => button.closest('[data-thread-entry]')?.getAttribute('data-thread-entry')?.startsWith('thread-ask'));
  if (collapse) fireEvent.click(collapse);
  const entry = container.querySelector('[data-thread-entry^="thread-ask"]')!;
  expect(entry.getAttribute('data-thread-entry')).toContain('collapsed');
  expect(entry.querySelector('[data-thread-collapsed-gutter]')).toHaveStyle({ color: 'rgba(0, 0, 0, 0.2)' });
  expect(entry.querySelector('[data-thread-flow-header] [aria-hidden="true"]')).toHaveStyle({ color: 'rgba(0, 0, 0, 0.15)' });
});

it('deletes a stranded tool step, then the reply nothing answers, reopening the question', () => {
  const store = configureStore({ reducer: dataFormulatorReducer });
  store.dispatch(userMessage('ask', 'Build a usage workflow', CONVERSATION_ROOT_ID, 0));
  store.dispatch(agentMessage('question', 'Where should the data come from?', 'ask', 1, { textKind: 'clarify', answered: true }));
  store.dispatch(userMessage('reply', 'Test it with my credentials', 'question', 2));
  store.dispatch(agentMessage('step', '', 'reply', 3, { executions: [{ id: 'cmd', argv: ['az', 'account', 'show'], cwd: '.',
    purpose: 'Check access', status: 'running' as const }],
    progressSteps: [{ id: 'cmd', kind: 'tool', tool: 'run_terminal', label: 'Checking access', status: 'running' }] as any }));
  const { container } = renderDataThread(store);
  // Only the open end of the thread is deletable.
  expect(screen.queryAllByRole('button', { name: 'Delete message' })).toHaveLength(0);
  const row = container.querySelector('[data-tool-activity-row]') as HTMLElement;
  fireEvent.click(within(row).getByRole('button', { name: 'Delete step' }));
  expect(store.getState().textTurns.map((turn: TextTurn) => turn.id)).toEqual(['ask', 'question', 'reply']);
  const reply = screen.getByText('Test it with my credentials').closest('[data-user-message]') as HTMLElement;
  expect(screen.getAllByRole('button', { name: 'Delete message' })).toHaveLength(1);
  fireEvent.click(within(reply).getByRole('button', { name: 'Delete message' }));
  expect(store.getState().textTurns.map((turn: TextTurn) => turn.id)).toEqual(['ask', 'question']);
  expect(store.getState().textTurns.find((turn: TextTurn) => turn.id === 'question')?.answered).toBe(false);
});

it('notes what a fixed artifact replaced', () => {
  const store = configureStore({ reducer: dataFormulatorReducer });
  store.dispatch(userMessage('ask', 'Fix the trend', CONVERSATION_ROOT_ID, 0));
  store.dispatch(agentMessage('step', 'Recompute the trend', 'ask', 1));
  store.dispatch(dfActions.addTableToStore({ ...derivedTable('d_fixed', 'Fixed trend', 'step'), replaced: { id: 'd_old', name: 'Old trend' } }));
  store.dispatch(agentMessage('app-step', '', 'd_fixed', 2));
  store.dispatch(dfActions.upsertFileNode({ kind: 'file', id: 'file-app.app.jsx', path: 'app.app.jsx', displayName: 'Trend app',
    contentHash: 'h', parentNodeId: 'app-step', createdAt: 3, replaced: { id: 'file-app.app.jsx', name: 'Trend app' } }));
  const { container } = renderDataThread(store);
  const notes = [...container.querySelectorAll('[data-replaced-note]')].map(note => note.textContent);
  expect(notes).toEqual(['Replaced Old trend', 'Replaced the earlier version']);
});
