// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import Button from '@mui/material/Button';
import Snackbar from '@mui/material/Snackbar';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import { DataFormulatorState, dfActions } from '../app/dfSlice';
import { useDispatch, useSelector } from 'react-redux';
import { Alert, Box, Tooltip, Typography } from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';


export interface Message {
    type: "success" | "info" | "error",
    timestamp: number,
    value: string,
    detail?: string, // error details
    code?: string // if this message is related to a code error, include code as well
}

export function MessageSnackbar() {
  
    const messages = useSelector((state: DataFormulatorState) => state.messages);
    const displayedMessageIdx = useSelector((state: DataFormulatorState) => state.displayedMessageIdx);
    const dispatch = useDispatch();

    const [open, setOpen] = React.useState(false);
    const [message, setMessage] = React.useState<Message | undefined>();

    React.useEffect(()=>{
        if (displayedMessageIdx < messages.length) {
            setOpen(true);
            setMessage(messages[displayedMessageIdx]);
            dispatch(dfActions.setDisplayedMessageIndex(displayedMessageIdx + 1));
        }
    }, [messages])


    const handleClose = (event: React.SyntheticEvent | Event, reason?: string) => {
        if (reason === 'clickaway') { return; }
        setOpen(false);
        setMessage(undefined);
    };

    const action = (
        <React.Fragment>
            <IconButton
                size="small"
                aria-label="close"
                color="inherit"
                onClick={handleClose}
            >
                <CloseIcon fontSize="small" />
            </IconButton>
        </React.Fragment>
    );

    let timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let timestamp = message == undefined ? "" : new Date((message as Message).timestamp).toLocaleString('en-US', { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit" });

    return (
        <Box>
            <Tooltip placement="right" title="view last message"><IconButton disabled={messages.length == 0} sx={{position: "absolute", bottom: 16, right: 0}}
                onClick={()=>{
                    setOpen(true);
                    setMessage(messages[messages.length - 1]);
            }}><InfoIcon /></IconButton></Tooltip>
            {message != undefined ? <Snackbar
                open={open && message != undefined}
                autoHideDuration={message?.type == "error" ? 15000 : 5000}
                anchorOrigin={{vertical: 'bottom', horizontal: 'right'}}
                onClose={handleClose}
                action={action}
            >
                <Alert onClose={handleClose} severity={message?.type} sx={{ maxWidth: '400px' }}>
                    <Typography fontSize={10} component="span" sx={{margin: "auto", opacity: 0.7}}>[{timestamp}]</Typography>  &nbsp;
                    {message?.value} 
                    {message?.detail ? 
                        <>
                            <br />
                            <Typography fontSize={12} component="span" sx={{marginBottom: 0, fontWeight: 'bold'}}>
                                [error details]
                            </Typography>
                            <br />
                            <Typography fontSize={12} component="span" sx={{margin: "auto", opacity: 0.7}}>
                                {message?.detail}   
                            </Typography>
                        </>
                    : ""}
                    {message?.code ? 
                        <>
                            <br />
                            <Typography fontSize={12} component="span" sx={{marginBottom: 0, fontWeight: 'bold'}}>
                                [generated code]
                            </Typography>
                            <Typography fontSize={10} component="span" sx={{margin: "auto", opacity: 0.7}}>
                                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 1 }}>
                                    {message?.code?.split('\n').filter(line => line.trim() !== '').join('\n')}
                                </pre>
                            </Typography>
                        </>
                    : ""}
                </Alert>    
            </Snackbar> : ""}
        </Box>
    );
}