// Shared sample-task suggestions for the Data Loading Agent. Both the
// upload-dialog entry point (`UnifiedDataUploadDialog`) and the in-session
// chat panel (`DataLoadingChat`) render these via `AgentChatInput`'s
// `focusSuggestions` dropdown. Keep this single source of truth so the
// two surfaces stay in sync.

import { TFunction } from 'i18next';
import React from 'react';
import SearchIcon from '@mui/icons-material/Search';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';
import { apiRequest } from '../app/apiClient';
import { getUrls } from '../app/utils';
import exampleImageTable from '../assets/example-image-table.png';

export interface DataLoadingSuggestion {
    kind: string;
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
}

export interface SuggestionPayload {
    text: string;
    images: string[];
    attachments: string[];
}

export interface BuildSuggestionsArgs {
    t: TFunction;
    setInput: (value: string) => void;
    setImages: (images: string[]) => void;
    setAttachments: (names: string[]) => void;
    /** Optional hook that workspaces use to make sure a session exists before uploading. */
    ensureActiveWorkspace?: () => void;
    /**
     * Optional auto-run hook. When provided, suggestions submit the
     * complete payload immediately (after any required async upload /
     * data-URL prep) instead of just pre-filling the input. Callers
     * typically wire this to a redux pending-submission dispatch so the
     * payload survives the parent→child handoff without prop races.
     * When absent, the suggestion behaves like a paste: it only fills
     * the input fields via the `set*` callbacks.
     */
    requestAutoSend?: (payload: SuggestionPayload) => void;
}

const EXCEL_SAMPLE_NAME = 'climate-gas-indicator.xlsx';

export function buildDataLoadingSuggestions(
    { t, setInput, setImages, setAttachments, ensureActiveWorkspace, requestAutoSend }: BuildSuggestionsArgs,
): DataLoadingSuggestion[] {
    const kindFind = t('upload.agentChatSuggestion.kind.find', { defaultValue: 'find' });
    const kindExtract = t('upload.agentChatSuggestion.kind.extract', { defaultValue: 'extract' });

    const findLabel = t('upload.agentChatSuggestion.findCPI', {
        defaultValue: 'Help me load consumer price index data',
    });
    const extractExcelLabel = t('upload.agentChatSuggestion.extractFromExcel', {
        defaultValue: 'Extract data from an attached Excel file',
    });
    const extractImageLabel = t('dataLoading.examples.extractFromImageExample', {
        defaultValue: 'Extract revenue data from this image',
    });
    const extractTextLabel = t('dataLoading.examples.extractFromTextExample', {
        defaultValue: 'Extract revenue growth data from this text: Business Highlights ...',
    });
    const extractTextPrompt = t('dataLoading.examples.extractFromTextPrompt', {
        defaultValue: extractTextLabel,
    });

    const iconSx = { fontSize: 14 };

    // Common: fill the input fields AND (if auto-run is enabled) submit
    // the payload. Centralising the dual behaviour keeps every
    // suggestion below short and consistent.
    const fillAndMaybeSend = (payload: SuggestionPayload) => {
        setImages(payload.images);
        setAttachments(payload.attachments);
        setInput(payload.text);
        requestAutoSend?.(payload);
    };

    return [
        {
            kind: kindFind,
            label: findLabel,
            icon: React.createElement(SearchIcon, { sx: iconSx }),
            onClick: () => fillAndMaybeSend({ text: findLabel, images: [], attachments: [] }),
        },
        {
            kind: kindExtract,
            label: extractExcelLabel,
            icon: React.createElement(TableChartOutlinedIcon, { sx: iconSx }),
            onClick: () => {
                // Surface the attachment chip / input synchronously so
                // it is visible during the async upload. The auto-send
                // (if enabled) waits until the upload completes so the
                // backend can actually find the scratch file.
                setImages([]);
                setAttachments([EXCEL_SAMPLE_NAME]);
                setInput(extractExcelLabel);
                ensureActiveWorkspace?.();
                fetch(`/${EXCEL_SAMPLE_NAME}`)
                    .then(res => res.blob())
                    .then(blob => {
                        const file = new File([blob], EXCEL_SAMPLE_NAME, {
                            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        });
                        const formData = new FormData();
                        formData.append('file', file);
                        return apiRequest(getUrls().SCRATCH_UPLOAD_URL, {
                            method: 'POST', body: formData,
                        });
                    })
                    .then(({ data }) => {
                        // The backend hash-suffixes the filename, so use the
                        // server-assigned name for the chip and the mention
                        // — otherwise the agent looks for a file that the
                        // upload renamed and reports it missing.
                        const scratchName = (data?.path || `scratch/${EXCEL_SAMPLE_NAME}`).replace(/^scratch\//, '');
                        setAttachments([scratchName]);
                        requestAutoSend?.({
                            text: extractExcelLabel, images: [],
                            attachments: [scratchName],
                        });
                    })
                    .catch(err => console.error('Sample Excel upload failed:', err));
            },
        },
        {
            kind: kindExtract,
            label: extractImageLabel,
            icon: React.createElement(ImageOutlinedIcon, { sx: iconSx }),
            onClick: () => {
                // Image needs to be read into a data URL before we can
                // surface it as a chip or send it. Defer auto-send until
                // the FileReader resolves.
                fetch(exampleImageTable)
                    .then(res => res.blob())
                    .then(blob => {
                        const reader = new FileReader();
                        reader.onload = () => {
                            if (!reader.result) return;
                            const dataUrl = reader.result as string;
                            fillAndMaybeSend({
                                text: extractImageLabel,
                                images: [dataUrl],
                                attachments: [],
                            });
                        };
                        reader.readAsDataURL(blob);
                    });
            },
        },
        {
            kind: kindExtract,
            label: extractTextLabel,
            icon: React.createElement(DescriptionOutlinedIcon, { sx: iconSx }),
            onClick: () => fillAndMaybeSend({ text: extractTextPrompt, images: [], attachments: [] }),
        },
    ];
}

export interface DataLoadingQuickAction {
    kind: string;
    label: string;
    onClick: () => void;
}

/**
 * A short list of one-tap "quick actions" surfaced as pills above the
 * composer (distinct from the `focusSuggestions` dropdown, which holds
 * example prompts). These are the highest-intent entry points — connect a
 * source, or see what connected data is already available. Rendered without
 * icons to keep the empty-state / front page clean.
 */
export function buildDataLoadingQuickActions(
    { t, setInput, setImages, setAttachments, requestAutoSend }: BuildSuggestionsArgs,
): DataLoadingQuickAction[] {
    const connectLabel = t('upload.agentChatQuickAction.connect', {
        defaultValue: 'Help me connect to my data source',
    });
    const askLabel = t('upload.agentChatQuickAction.askConnected', {
        defaultValue: 'What data do we have from connected sources?',
    });

    const fillAndSend = (text: string) => {
        setImages([]);
        setAttachments([]);
        setInput(text);
        requestAutoSend?.({ text, images: [], attachments: [] });
    };

    return [
        {
            kind: 'connect',
            label: connectLabel,
            onClick: () => fillAndSend(connectLabel),
        },
        {
            kind: 'ask',
            label: askLabel,
            onClick: () => fillAndSend(askLabel),
        },
    ];
}
