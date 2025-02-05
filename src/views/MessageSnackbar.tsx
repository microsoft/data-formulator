// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import Button from '@mui/material/Button';
import Snackbar from '@mui/material/Snackbar';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import { DataFormulatorState, dfActions } from '../app/dfSlice';
import { useDispatch, useSelector } from 'react-redux';
import { Alert, alpha, Box, Paper, Tooltip, Typography } from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
import AssignmentIcon from '@mui/icons-material/Assignment';

export interface Message {
    type: "success" | "info" | "error",
    timestamp: number,
    value: string,
    detail?: string, // error details
    code?: string // if this message is related to a code error, include code as well
}

export function MessageSnackbar() {
  
    const challenges = useSelector((state: DataFormulatorState) => state.activeChallenges);
    const messages = useSelector((state: DataFormulatorState) => state.messages);
    const displayedMessageIdx = useSelector((state: DataFormulatorState) => state.displayedMessageIdx);
    const dispatch = useDispatch();
    const tables = useSelector((state: DataFormulatorState) => state.tables);

    const [open, setOpen] = React.useState(false);
    const [openChallenge, setOpenChallenge] = React.useState(true);
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

    console.log(challenges);
    let challenge = challenges.find(c => tables.find(t => t.id == c.tableId));

    return (
        <Box>
            <Tooltip placement="right" title="view challenges">
                <IconButton 
                    color="warning"
                    disabled={challenges.length === 0}
                    sx={{
                        position: "absolute", 
                        bottom: 56, 
                        right: 8,
                        animation: challenges.length > 0 ? 'glow 1.5s ease-in-out infinite alternate' : 'none',
                        '@keyframes glow': {
                            from: {
                                boxShadow: '0 0 5px #fff, 0 0 10px #fff, 0 0 15px #ed6c02'
                            },
                            to: {
                                boxShadow: '0 0 10px #fff, 0 0 20px #fff, 0 0 30px #ed6c02'
                            }
                        }
                    }}
                    onClick={() => setOpenChallenge(true)}
                >
                    <AssignmentIcon />
                </IconButton>
            </Tooltip>
            <Tooltip placement="right" title="view last message">
                <IconButton disabled={messages.length == 0} sx={{position: "absolute", bottom: 16, right: 8}}
                    onClick={()=>{
                        setOpen(true);
                        setMessage(messages[messages.length - 1]);
                    }}
                >
                    <InfoIcon />
                </IconButton>
            </Tooltip>
            {challenge != undefined ? <Snackbar
                open={openChallenge}
                anchorOrigin={{vertical: 'bottom', horizontal: 'right'}}
                sx={{maxWidth: '400px'}}
            >
                <Paper sx={{
                    width: '100%',
                    bgcolor: 'white',
                    color: 'text.primary',
                    p: 2,
                    boxShadow: 2,
                    borderRadius: 1,
                    border: '1px solid #e0e0e0',
                    display: 'flex',
                    flexDirection: 'column'
                }}>
                    <Box sx={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1}}>
                        <Typography variant="subtitle1" sx={{fontWeight: 'bold', fontSize: 14}}>
                            Visualization challenges for dataset <Box component="span" sx={{fontWeight: 'bold', color: 'primary.main'}}>{challenge.tableId}</Box>
                        </Typography>
                        <IconButton
                            size="small"
                            aria-label="close"
                            onClick={() => setOpenChallenge(false)}
                        >
                            <CloseIcon fontSize="small" />
                        </IconButton>
                    </Box>
                    <Box sx={{mb: 2}}>
                        {challenge.challenges.map((ch, j) => (
                            <Typography 
                                key={j} 
                                variant="body2" 
                                sx={{
                                    fontSize: 12,
                                    marginBottom: 1,
                                    color: ch.difficulty === 'easy' ? 'success.main'
                                        : ch.difficulty === 'medium' ? 'warning.main' 
                                        : 'error.main'
                                }}
                            >
                                <Box 
                                    component="span" 
                                    sx={{fontWeight: 'bold'}}
                                >
                                    [{ch.difficulty}]
                                </Box>
                                {' '}{ch.text}
                            </Typography>
                        ))}
                    </Box>
                </Paper>
            </Snackbar> : ""}
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