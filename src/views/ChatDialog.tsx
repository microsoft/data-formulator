// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC } from 'react'
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

export interface ChatDialogProps {
    code: string, // final code generated
    dialog: any[],
    open: boolean,
    handleCloseDialog: () => void,
}

export const ChatDialog: FC<ChatDialogProps> = function ChatDialog({code, dialog, open, handleCloseDialog}) {

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
                
                {dialog.filter(entry => entry["role"] != 'system').map((chatEntry, idx) => {

                    let role = chatEntry['role'];
                    let message : any = chatEntry['content'] as string;
                    // if (message.search("Instruction: ") != -1)
                    //     message = message.slice(message.search("Instruction: "));
                    
                    // let matches = message.match(/```json[^`]+```/);
                    // if (matches) {
                    //     for (let match of matches) {
                    //         console.log(match)
                    //         message = message.replace(match, '')
                    //     }
                    // }

                    message = message.trimEnd();
                    // if (role == "assistant") {
                    //     message = <CodeBox code={message} language="python" />
                    // }

                    return <Card variant="outlined" key={`chat-dialog-${idx}`}
                        sx={{minWidth: "280px", maxWidth: "1920px", display: "flex", flexGrow: 1, margin: "6px", 
                            border: "1px solid rgba(33, 33, 33, 0.1)"}}>
                        <CardContent sx={{display: "flex", flexDirection: "column", flexGrow: 1, padding: '4px 8px', paddingBottom: '4px !important'}}>
                            <Typography sx={{ fontSize: 14 }}  gutterBottom>
                                {role}
                            </Typography>
                            <Box sx={{display: 'flex', flexDirection: "row", alignItems: "center", flex: 'auto'}}>
                                <Box sx={{maxWidth: 600, width: 'fit-content',  display: 'flex'}}>
                                    <Typography sx={{ fontSize: 12, whiteSpace: 'pre-wrap' }}  color="text.secondary">
                                        {message}
                                    </Typography>
                                </Box>
                            </Box>
                        </CardContent>
                    </Card>
                })}
                
            </Box>
    }

    

    return (
        <Dialog
            sx={{ '& .MuiDialog-paper': { maxWidth: '95%', maxHeight: 860, minWidth: 300 } }}
            maxWidth={false}
            open={open}
            key="chat-dialog-dialog"
        >
            <DialogTitle><Typography>Data Formulation Chat Log</Typography></DialogTitle>
            <DialogContent sx={{overflowX: "auto"}} dividers>
                <Divider ><Typography fontSize='small' sx={{color: 'gray'}}>Transformation Code</Typography></Divider>
                <Box sx={{maxWidth: 800}}><CodeBox code={code.trimStart()} language="python" /></Box>
                <Divider sx={{marginTop: 2}}><Typography fontSize='small' sx={{color: 'gray'}}>Derivation Dialog</Typography></Divider>
                {body}
            </DialogContent>
            <DialogActions>
                <Button onClick={()=>{ handleCloseDialog() }}>Close</Button>
            </DialogActions>
        </Dialog>
    );
}