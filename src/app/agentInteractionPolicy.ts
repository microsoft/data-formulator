// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function shouldAutoFocusGeneratedChart(userChartFocusLocked: boolean): boolean {
    return !userChartFocusLocked;
}
