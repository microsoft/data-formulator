// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC, useRef, useEffect } from 'react'
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
const renderMessageContent = (role: string, message: string) => {
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
                {"There is no conversation history yet"}
            </Typography>
        </Box>
    } else {
        body = 
            <Box sx={{display: "flex", overflowX: "auto", flexDirection: "column", 
                    justifyContent: "space-between", position: "relative", marginTop: "10px", minHeight: "50px"}}>
                
                {/* filter out system messages */}
                {dialog.filter(entry => entry["role"] != 'system').map((chatEntry, idx) => {

                    let role = chatEntry['role'];
                    let message : any = chatEntry['content'] as string;
                    const isUser = role === 'user';

                    message = message.trimEnd();

                    return <Card variant="outlined" key={`chat-dialog-${idx}`}
                        sx={{
                            minWidth: "280px", 
                            maxWidth: "1920px", 
                            display: "flex", 
                            flexGrow: 1, 
                            margin: "6px",
                            backgroundColor: isUser ? alpha(theme.palette.primary.main, 0.05) : alpha(theme.palette.custom.main, 0.05),
                            border: isUser ? "1px solid" : "1px solid",
                            borderColor: isUser ? alpha(theme.palette.primary.main, 0.2) : alpha(theme.palette.custom.main, 0.2),
                            borderRadius: 2,
                        }}>
                        <CardContent sx={{display: "flex", flexDirection: "column", flexGrow: 1, padding: '8px 12px', paddingBottom: '8px !important'}}>
                            <Typography sx={{ 
                                fontSize: 12, 
                                fontWeight: 600,
                                color: isUser ? 'primary.main' : 'custom.main',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px'
                            }} gutterBottom>
                                {isUser ? 'You' : 'Assistant'}
                            </Typography>
                            <Box sx={{display: 'flex', flexDirection: "column", alignItems: "flex-start", flex: 'auto'}}>
                                <Box sx={{maxWidth: 800, width: 'fit-content', display: 'flex', flexDirection: 'column'}}>
                                    <Box sx={{ 
                                        color: isUser ? 'primary.dark' : 'custom.dark',
                                    }}>
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
            <DialogTitle><Typography>Dialog with Agents</Typography></DialogTitle>
            <DialogContent ref={dialogContentRef} sx={{overflowY: "auto", overflowX: "hidden"}} dividers>
                {body}
            </DialogContent>
            <DialogActions>
                <Button onClick={()=>{ handleCloseDialog() }}>Close</Button>
            </DialogActions>
        </Dialog>
    );
}