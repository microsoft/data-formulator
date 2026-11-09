// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Optional app modules (d3, lodash, @df/geo) are separate bundles the host
 * injects only into apps that use them (see vite-plugins/dfReactRuntime.ts).
 * Each registers itself here; the core runtime's `require` reads the registry.
 */

export const OPTIONAL_REGISTRY = '__DF_OPTIONAL_MODULES__';

export function registerOptionalModule(name: string, value: unknown): void {
    const host = window as unknown as Record<string, Record<string, unknown> | undefined>;
    const registry = host[OPTIONAL_REGISTRY] ?? (host[OPTIONAL_REGISTRY] = {});
    registry[name] = value;
}

export function optionalModule(name: string): unknown {
    return (window as unknown as Record<string, Record<string, unknown> | undefined>)[OPTIONAL_REGISTRY]?.[name];
}
