// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DictTable } from "../components/ComponentType";
import { createTableFromFromObjectArray } from "../data/utils";
import { AppConfig } from "./utils";

interface Action {
    actionName: string;
    actionParams: object;
}

interface LoadDataAction extends Action {
    actionName: "loadData";
    actionParams: {
        tableName: string;
        table: object[];
    }
}

interface SetConfigAction extends Action {
    actionName: "setConfig";
    actionParams: AppConfig;
}

export interface ActionSubscription {
    loadData?: (table: DictTable) => void;
    setAppConfig?: (appConfig: AppConfig) => void;
}

const actionQueue: Action[] = [];
const subscribers: ActionSubscription[] = [];

export const subscribe = (subscription: ActionSubscription) => {
    subscribers.push(subscription);
    if (actionQueue.length) {
        //send queued events to subscribers, on the next thread cycle.
        //remove events after they are sent.
        setTimeout(() => {
            actionQueue.forEach(sendEventToSubscribers);
            actionQueue.length = 0;
        }, 0);
    }
};

export const unsubscribe = (subscription: ActionSubscription) => {
    const index = subscribers.indexOf(subscription);
    if (index !== -1) {
        subscribers.splice(index, 1);
    }
};

function sendEventToSubscribers(action: Action) {
    subscribers.forEach(subscription => {
        switch (action.actionName) {
            case "loadData": {
                if (subscription.loadData) {
                    let loadDataAction = action as LoadDataAction;
                    let table: undefined | DictTable = undefined;
                    try {
                        table = createTableFromFromObjectArray(loadDataAction.actionParams.tableName || 'dataset', loadDataAction.actionParams.table);
                    } catch (error) {
                        console.error("ActionQueue: error creating table from message", error);
                    }
                    if (table) {
                        console.log('ActionQueue: success creating table from message');
                        subscription.loadData(table);
                    }
                }
                break;
            }
            case "setConfig": {
                if (subscription.setAppConfig) {
                    let setConfigAction = action as SetConfigAction;
                    subscription.setAppConfig(setConfigAction.actionParams as AppConfig);
                }
                break;
            }
            default: {
                console.log("ActionQueue: unknown action", action.actionName);
                break;
            }
        }
    });
}

window.addEventListener("message", (event: MessageEvent<Action>) => {
    const action = event.data;
    //console.log("ActionQueue: received action message", action);
    if (action?.actionName) {
        if (subscribers.length === 0) {
            console.log("ActionQueue: no subscribers, queuing event");
            actionQueue.push(action);
            return;
        } else {
            console.log("ActionQueue: sending event to subscribers");
            sendEventToSubscribers(action);
        }
    }
});
