// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useState } from 'react';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { Box, IconButton, Tooltip } from '@mui/material';
import WrapTextIcon from '@mui/icons-material/WrapText';

import { iconVar, textVar } from '../app/layout';

interface MarkdownEditorProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    readOnly?: boolean;
}

const editorTheme = EditorView.theme({
    '&': {
        height: '100%',
        fontSize: textVar.sm,
        backgroundColor: '#fff',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
        overflow: 'auto',
        fontFamily: 'var(--df-font-mono)',
        lineHeight: '1.65',
    },
    '.cm-content': {
        padding: '18px 0',
        caretColor: '#1976d2',
    },
    '.cm-line': { padding: '0 18px' },
    '.cm-gutters': {
        backgroundColor: '#f7f8fa',
        color: '#8a9099',
        borderRight: '1px solid #e2e5e9',
    },
    '.cm-activeLine, .cm-activeLineGutter': {
        backgroundColor: 'rgba(25, 118, 210, 0.045)',
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
        backgroundColor: 'rgba(25, 118, 210, 0.16) !important',
    },
});

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({ value, onChange, placeholder, readOnly = false }) => {
    const [lineWrap, setLineWrap] = useState(true);
    const extensions = [markdown(), editorTheme, ...(lineWrap ? [EditorView.lineWrapping] : [])];

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, bgcolor: 'background.paper' }}>
            <Box sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                minHeight: 34, px: 0.75, borderBottom: '1px solid', borderColor: 'divider',
                bgcolor: '#f7f8fa', flexShrink: 0,
            }}>
                <Tooltip title={lineWrap ? 'Disable line wrap' : 'Enable line wrap'}>
                    <IconButton
                        size="small"
                        aria-label={lineWrap ? 'Disable line wrap' : 'Enable line wrap'}
                        aria-pressed={lineWrap}
                        onClick={() => setLineWrap(wrapped => !wrapped)}
                        sx={{
                            width: 26, height: 26,
                            color: lineWrap ? 'primary.main' : 'text.secondary',
                            bgcolor: lineWrap ? 'rgba(25, 118, 210, 0.08)' : 'transparent',
                        }}
                    >
                        <WrapTextIcon sx={{ fontSize: iconVar.md }} />
                    </IconButton>
                </Tooltip>
            </Box>
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', bgcolor: readOnly ? '#fafafa' : 'background.paper' }}>
                <CodeMirror
                    value={value}
                    onChange={onChange}
                    placeholder={placeholder}
                    height="100%"
                    extensions={extensions}
                    readOnly={readOnly}
                    editable={!readOnly}
                    indentWithTab
                    basicSetup={{
                        lineNumbers: true,
                        highlightActiveLineGutter: true,
                        foldGutter: true,
                        highlightActiveLine: true,
                        highlightSelectionMatches: true,
                        searchKeymap: true,
                        history: true,
                    }}
                    aria-label="Markdown document editor"
                />
            </Box>
        </Box>
    );
};