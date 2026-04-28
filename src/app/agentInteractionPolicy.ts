// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const AUTO_SELECT_CLARIFICATION_MESSAGE_CODE = 'agent.clarifyExhausted';

export function shouldAutoSelectClarification(messageCode?: string | null): boolean {
    return messageCode === AUTO_SELECT_CLARIFICATION_MESSAGE_CODE;
}

export function shouldAutoFocusGeneratedChart(userChartFocusLocked: boolean): boolean {
    return !userChartFocusLocked;
}
