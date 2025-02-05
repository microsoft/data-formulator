// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState } from 'react';

import {
    Box,
    Tabs,
    Tab,
    IconButton,
} from '@mui/material';

import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';

import { useSelector } from 'react-redux';
import { DataFormulatorState } from '../app/dfSlice';

import AnimateHeight from 'react-animate-height';
import { AgGridReact } from 'ag-grid-react';
import { SelectableGroup } from 'react-selectable-fast';

interface TabPanelProps {
    children?: React.ReactNode;
    value: number;
    index: number;
}

function TabPanel(props: TabPanelProps) {
    const { children, value, index, ...other } = props;
    return (
        <Box style={{ flexGrow: 1, display: "flex", overflow: "auto", minHeight: "360px", maxHeight: "600px" }} role="tabpanel"
            id={`simple-tabpanel-${index}`}
            aria-labelledby={`simple-tab-${index}`}
            {...other}
        >
            {value === index && (
                children
            )}
        </Box>
    );
}

export const InfoPanelFC: FC<{ $tableRef: React.RefObject<AgGridReact | SelectableGroup> }> = function InfoPanel({ $tableRef }) {

    // reference to states
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    let [tabValue, setTabValue] = useState(0);
    let [hidePanel, setHidePanel] = useState(true);

    // useEffect(() => {
    //     // Logs `HTMLInputElement`
    //     if (stagedValues.values.length > 0) {
    //         setTabValue(0);
    //         setHidePanel(false);
    //     }
    // }, [stagedValues]);

    let handleTabSwitch = (event: React.SyntheticEvent, newValue: number) => {
        setHidePanel(false);
        setTabValue(newValue);
    };

    // data selection view
    let dataSelectionView = "";

    let tabEntries = [
        { label: "Selected Data", panelElement: dataSelectionView, highlight: false },
    ];

    function a11yProps(index: number) {
        return {
            id: `simple-tab-${index}`,
            'aria-controls': `simple-tabpanel-${index}`,
        };
    }

    let infoPanel = (
        <Box sx={{ width: '100%', display: "flex", flexDirection: "column", borderTop: "1px solid lightgray" }}>
            {/* {synthesizerRunning ? <Box sx={{
                position: "absolute", height: "100%", width: "100%", zIndex: 20,
                backgroundColor: "rgba(243, 243, 243, 0.8)", display: "flex", alignItems: "center"
            }}>
                <LinearProgress sx={{ width: "100%", height: "100%", opacity: 0.05 }} />
            </Box> : ''} */}
            <Box sx={{ borderBottom: 1, borderColor: 'divider', display: "flex" }}>
                <IconButton color="primary" sx={{ borderRadius: 0 }} onClick={() => { setHidePanel(!hidePanel) }}>{hidePanel ? <UnfoldMoreIcon /> : <UnfoldLessIcon />}</IconButton>
                <Tabs value={Math.abs(tabValue)} >
                    {tabEntries.map((entry, index) => (
                        <Tab
                            key={`simple-tab-${index}`}
                            className={entry.highlight && index != tabValue ? "background-highlight" : ''} 
                            onClick={(event) => { handleTabSwitch(event, index) }} label={entry.label} {...a11yProps(index)} 
                            sx={{ "&.MuiTab-root": { "textTransform": "none" } }} />))}
                </Tabs>
            </Box>
            <AnimateHeight duration={200} height={hidePanel ? 0 : "auto"}>
                {tabEntries.map((entry, index) => (
                    tabValue == index ? <TabPanel value={tabValue} index={index} key={`tabpanel-${index}`}>
                        {entry.panelElement}
                    </TabPanel> : ""
                ))}
            </AnimateHeight>
        </Box>)

    return infoPanel
}