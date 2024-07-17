// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Box, Typography, Button } from "@mui/material";
import React, { FC } from "react";

import dfLogo from '../assets/df-logo.png';
import { toolName } from "../app/App";

export const About: FC<{}> = function About({ }) {

    return (
        <Box sx={{display: "flex", flexDirection: "column", textAlign: "center", overflowY: "auto"}}>
            <Box sx={{display: 'flex', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', marginTop: '40px'}}>
                <Box component="img" sx={{ paddingRight: "12px",  height: 64 }} alt="" src={dfLogo} />
                <Typography variant="h3">
                    {toolName}
                </Typography>
            </Box>
            <Box>
                <Button href="/" variant="outlined" sx={{margin: "20px 0"}}>
                    Use {toolName}
                </Button>
            </Box>
            <Box sx={{textAlign: "initial", maxWidth: '80%',  margin: "auto", fontFamily: 'Arial,Roboto,Helvetica Neue,sans-serif'}}>
                <Typography>{toolName} lets you create and iterate between rich visualizations using combined user interface and natural language descriptions.</Typography>
                <Typography>The AI agent in {toolName} helps you explore visualizations <em>beyond your initial dataset</em>.</Typography>
            </Box>
            <Box component="img" sx={{paddingTop: "20px",  height: 480, margin: "auto" }} alt="" src={"/data-formulator-screenshot.png"} />
        </Box>)
}