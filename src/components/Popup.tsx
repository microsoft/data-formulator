// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC } from "react";
import { AppConfig, PopupConfig } from "../app/utils";
import { Button } from "@mui/material";
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { DictTable } from "./ComponentType";

export interface Props {
    popupConfig: PopupConfig;
    appConfig: AppConfig;
    table?: DictTable;
}

export const Popup: FC<Props> = function Popup({ popupConfig, appConfig, table }) {

    const popupInNewWindow = () => {
        const newWindow = window.open('', '_blank')!;
        const htmlContent = `
            <!DOCTYPE html>
            <html><body>
                <div id="root"></div>
            </body></html>
        `;

        newWindow.document.open();
        newWindow.document.write(htmlContent);
        newWindow.document.close();

        const scriptNode = newWindow.document.createElement('script');
        scriptNode.src = popupConfig?.jsUrl!;
        scriptNode.defer = true;
        scriptNode.onload = () => {
            // Script loaded successfully
            newWindow.postMessage({ actionName: 'setConfig', actionParams: { serverUrl: appConfig.serverUrl } }, '*');
            newWindow.postMessage({ actionName: 'loadData', actionParams: { tableName: table!.id, table: table!.rows } }, '*');
        };
        scriptNode.onerror = () => {
            // Script failed to load
            console.log(new Error('popup Script failed to load'));
        };
        newWindow.document.body.appendChild(scriptNode);
    };

    if (popupConfig?.allowPopup) {
        return (
            <Button variant='text' onClick={() => { popupInNewWindow() }} endIcon={<OpenInNewIcon />}>
                Popup
            </Button>
        );
    } else {
        return null;
    }
}
