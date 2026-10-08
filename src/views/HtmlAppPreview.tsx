// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useCallback, useMemo } from 'react';

import vegaSource from '../../node_modules/vega/build/vega.min.js?raw';
import vegaLiteSource from '../../node_modules/vega-lite/build/vega-lite.min.js?raw';
import runtimeSource from '../app/htmlApp/dfAppRuntime.js?raw';
import kitStylesheet from '../app/htmlApp/dfAppKit.css?raw';
import { buildAppDocument, parseAppManifest } from '../app/htmlApp/htmlAppDocument';
import { AppSandbox, useAppTheme } from './AppSandbox';

/** A sandboxed HTML app artifact. */
export const HtmlAppPreview: FC<{
    html: string; title: string; reloadKey?: number; reserveTopRight?: boolean; onAskFix?: (errors: string[]) => void;
}> = ({ html, title, reloadKey = 0, reserveTopRight = false, onAskFix }) => {
    const manifest = useMemo(() => parseAppManifest(html), [html]);
    const theme = useAppTheme();
    const buildDocument = useCallback((channel: string) => buildAppDocument(html, {
        runtimeScripts: [vegaSource, vegaLiteSource, runtimeSource],
        theme,
        kitStylesheet,
        config: { channel, hostOrigin: window.location.origin, manifest, theme },
    }), [html, manifest, theme]);
    return <AppSandbox title={title} manifest={manifest} buildDocument={buildDocument} reloadKey={reloadKey}
        reserveTopRight={reserveTopRight} onAskFix={onAskFix} />;
};

export default HtmlAppPreview;
