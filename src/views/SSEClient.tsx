// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function connectToSSE(dispatch?: any) {
    const eventSource = new EventSource('/api/sse/connect', {
        withCredentials: true // Include cookies for session management
    });

    eventSource.onopen = function(event) {
        console.log('SSE connection opened');
    };

    eventSource.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            console.log('Received SSE message:', data);
            
            // If dispatch is provided, send message to Redux store
            if (dispatch) {
                dispatch({ type: 'dataFormulatorSlice/handleSSEMessage', payload: data });
            }
        } catch (error) {
            console.log('Received raw message:', event.data);
        }
    };

    eventSource.onerror = function(event) {
        if (eventSource.readyState === EventSource.CLOSED) {
            console.error('SSE connection was closed');
        } else if (eventSource.readyState === EventSource.CONNECTING) {
            console.error('SSE connection is reconnecting');
        }
    };

    return eventSource;
}
