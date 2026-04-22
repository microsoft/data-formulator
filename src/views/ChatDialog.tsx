// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next';
import { radius } from '../app/tokens';
import { Divider } from "@mui/material";
import {
		Card,
		Box,
		Typography,
		Dialog,
        DialogTitle,
        DialogContent,
        DialogActions,
        Button,
        styled,
        CardContent,
} from '@mui/material';

import React from 'react';
import { alpha, useTheme } from '@mui/material/styles';
import { CodeBox } from './VisualizationView';

export const GroupHeader = styled('div')(({ theme }) => ({
    position: 'sticky',
    top: '-8px',
    padding: '4px 4px',
    color: "darkgray",
    fontSize: "12px",
}));
  
export const GroupItems = styled('ul')({
    padding: 0,
});

// Function to parse message content and render code blocks
/** Try to parse a JSON action from a message string and render it in segments. */
const renderJsonAction = (message: string): React.ReactNode | null => {
    let action: any;
    try {
        action = JSON.parse(message.trim());
    } catch {
        // Try to find JSON within the message
        const jsonMatch = message.match(/\{[\s\S]*"action"\s*:\s*"[^"]+"/);
        if (!jsonMatch) return null;
        try {
            // Find the matching closing brace
            const startIdx = message.indexOf(jsonMatch[0]);
            let depth = 0;
            let endIdx = startIdx;
            for (let i = startIdx; i < message.length; i++) {
                if (message[i] === '{') depth++;
                else if (message[i] === '}') { depth--; if (depth === 0) { endIdx = i + 1; break; } }
            }
            action = JSON.parse(message.slice(startIdx, endIdx));
        } catch { return null; }
    }
    if (!action || typeof action !== 'object' || !action.action) return null;

    const sections: React.ReactNode[] = [];
    const actionType = action.action;

    sections.push(
        <Typography key="action-type" sx={{ fontSize: 12, fontWeight: 600, color: 'primary.main', textTransform: 'uppercase', letterSpacing: '0.5px', mb: 0.5 }}>
            {actionType}
        </Typography>
    );

    if (action.thought) {
        sections.push(
            <Typography key="thought" sx={{ fontSize: 12, color: 'text.secondary', fontStyle: 'italic', mb: 0.5, lineHeight: 1.4 }}>
                {action.thought}
            </Typography>
        );
    }

    if (action.display_instruction) {
        sections.push(
            <Typography key="display" sx={{ fontSize: 12, fontWeight: 500, mb: 0.5, lineHeight: 1.4 }}>
                {action.display_instruction}
            </Typography>
        );
    }

    if (action.message) {
        sections.push(
            <Typography key="message" sx={{ fontSize: 12, mb: 0.5, lineHeight: 1.4 }}>
                {action.message}
            </Typography>
        );
        if (action.options && Array.isArray(action.options)) {
            sections.push(
                <Box key="options" sx={{ pl: 2, mb: 0.5 }}>
                    {action.options.map((opt: string, i: number) => (
                        <Typography key={`opt-${i}`} sx={{ fontSize: 11, color: 'text.secondary', lineHeight: 1.5 }}>
                            {i + 1}. {opt}
                        </Typography>
                    ))}
                </Box>
            );
        }
    }

    if (action.summary) {
        sections.push(
            <Typography key="summary" sx={{ fontSize: 12, fontWeight: 500, mb: 0.5, lineHeight: 1.4 }}>
                {action.summary}
            </Typography>
        );
    }

    if (action.code) {
        sections.push(
            <Box key="code" sx={{ my: 0.5, borderRadius: 1, overflow: 'auto' }}>
                <CodeBox code={action.code} language="python" fontSize={10} />
            </Box>
        );
    }

    if (action.chart) {
        const chartStr = JSON.stringify(action.chart, null, 2);
        sections.push(
            <Box key="chart" sx={{ my: 0.5, borderRadius: 1, overflow: 'auto' }}>
                <CodeBox code={chartStr} language="json" fontSize={10} />
            </Box>
        );
    }

    const meta: string[] = [];
    if (action.output_variable) meta.push(`output: ${action.output_variable}`);
    if (action.field_metadata) meta.push(`field_metadata: ${JSON.stringify(action.field_metadata)}`);
    if (action.table_names) meta.push(`tables: ${action.table_names.join(', ')}`);
    if (meta.length > 0) {
        sections.push(
            <Typography key="meta" sx={{ fontSize: 10, color: 'text.disabled', mt: 0.5, lineHeight: 1.4 }}>
                {meta.join(' · ')}
            </Typography>
        );
    }

    return <Box sx={{ display: 'flex', flexDirection: 'column' }}>{sections}</Box>;
};

const renderMessageContent = (role: string, message: string) => {
    // For assistant messages, try to render as structured JSON action first
    if (role === 'assistant') {
        const actionView = renderJsonAction(message);
        if (actionView) return actionView;
    }

    // Split message by code blocks (```language ... ```)
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(message)) !== null) {
        // Add text before code block
        if (match.index > lastIndex) {
            const textContent = message.slice(lastIndex, match.index);
            if (textContent.trim()) {
                parts.push(
                    <Typography key={`text-${lastIndex}`} sx={{ 
                        fontSize: 13, 
                        whiteSpace: 'pre-wrap',
                        lineHeight: 1.4,
                        marginBottom: 1
                    }}>
                        {textContent}
                    </Typography>
                );
            }
        }

        // Add code block
        const language = match[1] || 'text';
        const code = match[2].trim();
        parts.push(
            <Box key={`code-${match.index}`} sx={{ 
                margin: '0',
                borderRadius: 1,
                overflow: 'auto'
            }}>
                <CodeBox code={code} language={language} fontSize={10} />
            </Box>
        );

        lastIndex = match.index + match[0].length;
    }

    // Add remaining text after last code block
    if (lastIndex < message.length) {
        const textContent = message.slice(lastIndex);
        if (textContent.trim()) {
            parts.push(
                <Typography key={`text-${lastIndex}`} sx={{ 
                    fontSize: 13, 
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.4
                }}>
                    {textContent}
                </Typography>
            );
        }
    }

    // If no code blocks found, return original message
    if (parts.length === 0) {
        return (
            <Typography sx={{ 
                fontSize: 13, 
                whiteSpace: 'pre-wrap',
                lineHeight: 1.4
            }}>
                {message}
            </Typography>
        );
    }

    return <Box>{parts}</Box>;
};

export interface ChatDialogProps {
    code: string, // final code generated
    dialog: any[],
    open: boolean,
    handleCloseDialog: () => void,
}

export const ChatDialog: FC<ChatDialogProps> = function ChatDialog({code, dialog, open, handleCloseDialog}) {
    const { t } = useTranslation();
    let theme = useTheme();
    const dialogContentRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when dialog opens
    useEffect(() => {
        if (open) {
            setTimeout(() => {
                if (dialogContentRef.current) {
                    dialogContentRef.current.scrollTop = dialogContentRef.current.scrollHeight;
                }
            }, 100);
        }
    }, [open]);

 
    let body = undefined
    if (dialog == undefined) {
        body = <Box sx={{display: "flex", overflowX: "auto", flexDirection: "column", 
                         justifyContent: "space-between", position: "relative", marginTop: "10px", minHeight: "50px"}}>
            <Typography sx={{ fontSize: 14 }}  color="text.secondary" gutterBottom>
                {t('chatDialog.noHistory')}
            </Typography>
        </Box>
    } else {
        body = 
            <Box sx={{display: "flex", overflowX: "auto", flexDirection: "column", 
                    justifyContent: "space-between", position: "relative", marginTop: "10px", minHeight: "50px"}}>
                
                {dialog.map((chatEntry, idx) => {

                    let role = chatEntry['role'];
                    let content : any = chatEntry['content'];
                    const isUser = role === 'user';
                    const isSystem = role === 'system';

                    // Handle multimodal content (array with text + image_url objects)
                    let message: string;
                    if (Array.isArray(content)) {
                        message = content
                            .filter((part: any) => part.type === 'text')
                            .map((part: any) => part.text)
                            .join('\n');
                    } else {
                        message = content as string;
                    }

                    message = message.trimEnd();

                    const bgColor = isSystem ? alpha(theme.palette.grey[500], 0.05)
                        : isUser ? alpha(theme.palette.primary.main, 0.05)
                        : alpha(theme.palette.custom.main, 0.05);
                    const borderClr = isSystem ? alpha(theme.palette.grey[500], 0.2)
                        : isUser ? alpha(theme.palette.primary.main, 0.2)
                        : alpha(theme.palette.custom.main, 0.2);
                    const labelColor = isSystem ? 'text.secondary'
                        : isUser ? 'primary.main'
                        : 'custom.main';
                    const textColor = isSystem ? 'text.secondary'
                        : isUser ? 'primary.dark'
                        : 'custom.dark';
                    const label = isSystem ? 'SYSTEM' : isUser ? t('chatDialog.you') : t('chatDialog.assistant');

                    return <Card variant="outlined" key={`chat-dialog-${idx}`}
                        sx={{
                            minWidth: "280px", 
                            maxWidth: "1920px", 
                            display: "flex", 
                            flexGrow: 1, 
                            margin: "6px",
                            backgroundColor: bgColor,
                            border: "1px solid",
                            borderColor: borderClr,
                            borderRadius: radius.md,
                        }}>
                        <CardContent sx={{display: "flex", flexDirection: "column", flexGrow: 1, padding: '8px 12px', paddingBottom: '8px !important'}}>
                            <Typography sx={{ 
                                fontSize: 12, 
                                fontWeight: 600,
                                color: labelColor,
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px'
                            }} gutterBottom>
                                {label}
                            </Typography>
                            <Box sx={{display: 'flex', flexDirection: "column", alignItems: "flex-start", flex: 'auto'}}>
                                <Box sx={{maxWidth: 800, width: 'fit-content', display: 'flex', flexDirection: 'column'}}>
                                    <Box sx={{ color: textColor }}>
                                        {renderMessageContent(role, message)}
                                    </Box>
                                </Box>
                            </Box>
                        </CardContent>
                    </Card>
                })}
                
            </Box>
    }

    return (
        <Dialog
            sx={{ '& .MuiDialog-paper': { maxWidth: '95%', maxHeight: '90%', minWidth: 300 } }}
            maxWidth={false}
            open={open}
            key="chat-dialog-dialog"
        >
            <DialogTitle><Typography>{t('chatDialog.agentLog')}</Typography></DialogTitle>
            <DialogContent ref={dialogContentRef} sx={{overflowY: "auto", overflowX: "hidden"}} dividers>
                {body}
            </DialogContent>
            <DialogActions>
                <Button onClick={()=>{ handleCloseDialog() }}>{t('app.close')}</Button>
            </DialogActions>
        </Dialog>
    );
}