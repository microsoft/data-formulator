export type LoadableStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';

export interface LoadableState<T> {
    status: LoadableStatus;
    data?: T;
    error?: string;
    updatedAt?: number;
}

export const idleLoadable = <T>(): LoadableState<T> => ({
    status: 'idle',
});

export const loadingLoadable = <T>(previous?: LoadableState<T>): LoadableState<T> => ({
    status: 'loading',
    data: previous?.data,
    updatedAt: previous?.updatedAt,
});

export const successLoadable = <T>(
    data: T,
    isEmpty?: (data: T) => boolean,
): LoadableState<T> => ({
    status: isEmpty?.(data) ? 'empty' : 'success',
    data,
    updatedAt: Date.now(),
});

export const errorLoadable = <T>(
    error: unknown,
    fallbackData?: T,
): LoadableState<T> => ({
    status: 'error',
    data: fallbackData,
    error: getLoadableErrorMessage(error),
    updatedAt: Date.now(),
});

export function getLoadableErrorMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'apiError' in error) {
        const apiError = (error as { apiError?: { message?: string } }).apiError;
        if (apiError?.message) return apiError.message;
    }
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'Unknown error';
}
