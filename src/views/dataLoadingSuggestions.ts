// Shared sample-task suggestions for the Data Loading Agent. Both the
// upload-dialog entry point (`UnifiedDataUploadDialog`) and the in-session
// chat panel (`DataLoadingChat`) render these via `AgentChatInput`'s
// `focusSuggestions` dropdown. Keep this single source of truth so the
// two surfaces stay in sync.

import { TFunction } from 'i18next';
import React from 'react';
import QuestionAnswerOutlinedIcon from '@mui/icons-material/QuestionAnswerOutlined';
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

export interface BuildSuggestionsArgs {
    t: TFunction;
    setInput: (value: string) => void;
    setImages: (images: string[]) => void;
    setAttachments: (names: string[]) => void;
    /** Optional hook that workspaces use to make sure a session exists before uploading. */
    ensureActiveWorkspace?: () => void;
}

const EXCEL_SAMPLE_NAME = 'climate-gas-indicator.xlsx';

export function buildDataLoadingSuggestions(
    { t, setInput, setImages, setAttachments, ensureActiveWorkspace }: BuildSuggestionsArgs,
): DataLoadingSuggestion[] {
    const kindAsk = t('upload.agentChatSuggestion.kind.ask', { defaultValue: 'ask' });
    const kindFind = t('upload.agentChatSuggestion.kind.find', { defaultValue: 'find' });
    const kindExtract = t('upload.agentChatSuggestion.kind.extract', { defaultValue: 'extract' });

    const askLabel = t('upload.agentChatSuggestion.askConnected', {
        defaultValue: 'What datasets do we have from connected sources?',
    });
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

    return [
        {
            kind: kindAsk,
            label: askLabel,
            icon: React.createElement(QuestionAnswerOutlinedIcon, { sx: iconSx }),
            onClick: () => {
                setImages([]);
                setAttachments([]);
                setInput(askLabel);
            },
        },
        {
            kind: kindFind,
            label: findLabel,
            icon: React.createElement(SearchIcon, { sx: iconSx }),
            onClick: () => {
                setImages([]);
                setAttachments([]);
                setInput(findLabel);
            },
        },
        {
            kind: kindExtract,
            label: extractExcelLabel,
            icon: React.createElement(TableChartOutlinedIcon, { sx: iconSx }),
            onClick: () => {
                // Surface the attachment chip synchronously so it is
                // always present when the user hits send, even if the
                // upload below is still mid-flight. The chip is what
                // gets serialised into the outgoing `[Uploaded: name]`
                // mention and ultimately the chat bubble.
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
                    .catch(err => console.error('Sample Excel upload failed:', err));
            },
        },
        {
            kind: kindExtract,
            label: extractImageLabel,
            icon: React.createElement(ImageOutlinedIcon, { sx: iconSx }),
            onClick: () => {
                fetch(exampleImageTable)
                    .then(res => res.blob())
                    .then(blob => {
                        const reader = new FileReader();
                        reader.onload = () => {
                            if (reader.result) {
                                setImages([reader.result as string]);
                                setAttachments([]);
                                setInput(extractImageLabel);
                            }
                        };
                        reader.readAsDataURL(blob);
                    });
            },
        },
        {
            kind: kindExtract,
            label: extractTextLabel,
            icon: React.createElement(DescriptionOutlinedIcon, { sx: iconSx }),
            onClick: () => {
                setImages([]);
                setAttachments([]);
                setInput(extractTextPrompt);
            },
        },
    ];
}
