import type { CodeExecution, TextTurn, ToolCall } from '../components/ComponentType';

/** Tools whose call is code the user can read and rerun. */
export const CODE_TOOLS = new Set(['execute_python_script', 'explore']);

export const isCodeCall = (call: ToolCall): boolean => CODE_TOOLS.has(call.tool);

/** A code call as code views show it. */
export const asCodeExecution = (call: ToolCall): CodeExecution => ({
    id: call.id, tool: call.tool, createdAt: call.createdAt, output: call.output, error: call.error,
    // Only MCP calls wait for approval or are rejected; code calls never do.
    status: call.status === 'awaiting_approval' ? 'running' : call.status === 'rejected' ? 'failed' : call.status,
    code: typeof call.args?.code === 'string' ? call.args.code : '',
    purpose: typeof call.args?.purpose === 'string' ? call.args.purpose : '',
});

/** The message's code calls, for views that show only code (the thread, the tool activity panel). */
export const codeCallsOf = (turn: Pick<TextTurn, 'toolCalls'> | undefined): CodeExecution[] =>
    (turn?.toolCalls || []).filter(isCodeCall).map(asCodeExecution);

/** A saved code record (sessions before tool-call records) as a tool call. */
export const toolCallFromCodeExecution = (execution: CodeExecution): ToolCall => ({
    id: execution.id, tool: execution.tool || 'execute_python_script', status: execution.status,
    args: { code: execution.code, ...(execution.purpose ? { purpose: execution.purpose } : {}) },
    ...(execution.output !== undefined ? { output: execution.output } : {}),
    ...(execution.error !== undefined ? { error: execution.error } : {}),
    ...(execution.createdAt !== undefined ? { createdAt: execution.createdAt } : {}),
});
