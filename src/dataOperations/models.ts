export const DATA_OPERATION_SCHEMA_VERSION = 1 as const;

export type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };

export type DataOperationStatus =
    | 'draft'
    | 'awaiting_selection'
    | 'running'
    | 'loaded'
    | 'partially_loaded'
    | 'failed'
    | 'cancelled'
    | 'superseded';

export interface OperationFilter {
    column: string;
    operator: string;
    value?: JsonValue;
}

export interface LoadQuery {
    filters?: Array<{ column: string; op: string; value?: JsonValue }>;
    columns?: string[];
    orderBy?: Array<{ column: string; direction: 'asc' | 'desc' }>;
    limit?: number;
}

export interface ConnectorQueryStepSummary {
    kind: 'connector_query';
    displayName: string;
}

export type DataOperationStepSummary = ConnectorQueryStepSummary;

export interface DataOperationPlan {
    id: string;
    hash: string;
    label: string;
    summary: string;
    steps: DataOperationStepSummary[];
}

export interface OperationError {
    code: string;
    message: string;
}

export interface FailedOperationStep {
    stepIndex: number;
    displayName: string;
    error: OperationError;
}

export interface DataOperation {
    schemaVersion: typeof DATA_OPERATION_SCHEMA_VERSION;
    id: string;
    status: DataOperationStatus;
    reason: string;
    description: string;
    canvasTitle: string;
    canvasSummary: string;
    plans: DataOperationPlan[];
    selectedPlanId?: string;
    resultTableIds: string[];
    error?: OperationError;
    failedSteps: FailedOperationStep[];
    supersededByOperationId?: string;
}

const OPERATION_STATUSES = new Set<DataOperationStatus>([
    'draft',
    'awaiting_selection',
    'running',
    'loaded',
    'partially_loaded',
    'failed',
    'cancelled',
    'superseded',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
    if (!isRecord(value)) throw new Error(`${label} must be an object`);
    return value;
};

const requireString = (value: unknown, label: string): string => {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`${label} must be a non-empty string`);
    }
    return value;
};

const optionalString = (value: unknown, label: string): string | undefined =>
    value === undefined || value === null ? undefined : requireString(value, label);

const freezeJson = (value: unknown, label: string): JsonValue => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) {
        return value.map((item, index) => freezeJson(item, `${label}[${index}]`));
    }
    if (isRecord(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, freezeJson(item, `${label}.${key}`)]),
        );
    }
    throw new Error(`${label} must contain only JSON values`);
};

const parseFilter = (value: unknown, index: number): OperationFilter => {
    const item = requireRecord(value, `filters[${index}]`);
    return {
        column: requireString(item.column, `filters[${index}].column`),
        operator: requireString(item.operator, `filters[${index}].operator`),
        ...(item.value === undefined ? {} : {
            value: freezeJson(item.value, `filters[${index}].value`),
        }),
    };
};

const parseStep = (value: unknown, index: number): DataOperationStepSummary => {
    const step = requireRecord(value, `steps[${index}]`);
    if (step.kind !== 'connector_query') {
        throw new Error(`Unsupported data operation step kind: ${String(step.kind)}`);
    }
    return {
        kind: 'connector_query',
        displayName: requireString(step.display_name, `steps[${index}].display_name`),
    };
};

const parsePlan = (value: unknown, index: number): DataOperationPlan => {
    const plan = requireRecord(value, `plans[${index}]`);
    if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
        throw new Error(`plans[${index}].steps must be a non-empty array`);
    }
    const hash = requireString(plan.hash, `plans[${index}].hash`);
    if (!/^[a-f0-9]{64}$/.test(hash)) {
        throw new Error(`plans[${index}].hash must be a SHA-256 hex digest`);
    }
    return {
        id: requireString(plan.id, `plans[${index}].id`),
        hash,
        label: requireString(plan.label, `plans[${index}].label`),
        summary: typeof plan.summary === 'string' ? plan.summary : '',
        steps: plan.steps.map(parseStep),
    };
};

export const parseDataOperation = (value: unknown): DataOperation => {
    const operation = requireRecord(value, 'data operation');
    if (operation.schema_version !== DATA_OPERATION_SCHEMA_VERSION) {
        throw new Error(`Unsupported data operation schema version: ${String(operation.schema_version)}`);
    }
    if (!OPERATION_STATUSES.has(operation.status as DataOperationStatus)) {
        throw new Error(`Unsupported data operation status: ${String(operation.status)}`);
    }
    if (!Array.isArray(operation.plans) || operation.plans.length === 0) {
        throw new Error('data operation plans must be a non-empty array');
    }
    const plans = operation.plans.map(parsePlan);
    const planIds = new Set(plans.map(plan => plan.id));
    if (planIds.size !== plans.length) throw new Error('data operation plan IDs must be unique');

    const selectedPlanId = optionalString(operation.selected_plan_id, 'selected_plan_id');
    if (selectedPlanId !== undefined && !planIds.has(selectedPlanId)) {
        throw new Error('selected_plan_id must identify a plan in this operation');
    }
    const resultTableIds = operation.result_table_ids === undefined
        ? []
        : operation.result_table_ids;
    if (!Array.isArray(resultTableIds)) throw new Error('result_table_ids must be an array');

    const rawError = operation.error === undefined
        ? undefined
        : requireRecord(operation.error, 'error');
    const rawFailedSteps = operation.failed_steps === undefined
        ? []
        : operation.failed_steps;
    if (!Array.isArray(rawFailedSteps)) throw new Error('failed_steps must be an array');
    const failedSteps = rawFailedSteps.map((value, index): FailedOperationStep => {
        const step = requireRecord(value, `failed_steps[${index}]`);
        if (typeof step.step_index !== 'number' || !Number.isInteger(step.step_index)) {
            throw new Error(`failed_steps[${index}].step_index must be an integer`);
        }
        const error = requireRecord(step.error, `failed_steps[${index}].error`);
        return {
            stepIndex: step.step_index,
            displayName: requireString(step.display_name, `failed_steps[${index}].display_name`),
            error: {
                code: requireString(error.code, `failed_steps[${index}].error.code`),
                message: requireString(error.message, `failed_steps[${index}].error.message`),
            },
        };
    });

    return {
        schemaVersion: DATA_OPERATION_SCHEMA_VERSION,
        id: requireString(operation.id, 'id'),
        status: operation.status as DataOperationStatus,
        reason: typeof operation.reason === 'string' ? operation.reason : '',
        description: typeof operation.description === 'string' ? operation.description : '',
        canvasTitle: typeof operation.canvas_title === 'string' ? operation.canvas_title : '',
        canvasSummary: typeof operation.canvas_summary === 'string' ? operation.canvas_summary : '',
        plans,
        selectedPlanId,
        resultTableIds: resultTableIds.map((item, index) =>
            requireString(item, `result_table_ids[${index}]`)),
        error: rawError === undefined ? undefined : {
            code: requireString(rawError.code, 'error.code'),
            message: requireString(rawError.message, 'error.message'),
        },
        failedSteps,
        supersededByOperationId: optionalString(
            operation.superseded_by_operation_id,
            'superseded_by_operation_id',
        ),
    };
};