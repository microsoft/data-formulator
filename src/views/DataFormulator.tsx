// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useEffect, useState } from 'react';
import '../scss/App.scss';

import { useDispatch, useSelector } from "react-redux"; /* code change */
import {
    DataFormulatorState,
    dfActions,
    dfSelectors,
} from '../app/dfSlice'

import _ from 'lodash';

import { Allotment } from "allotment";
import "allotment/dist/style.css";

import {

    Typography,
    Box,
    Tooltip,
    Button,
    Divider,
    useTheme,
    alpha,
} from '@mui/material';
import {
    FolderOpen as FolderOpenIcon,
    ContentPaste as ContentPasteIcon,
    Category as CategoryIcon,
    CloudQueue as CloudQueueIcon,
    AutoFixNormal as AutoFixNormalIcon,
} from '@mui/icons-material';

import { FreeDataViewFC } from './DataView';
import { VisualizationViewFC } from './VisualizationView';

import { ConceptShelf } from './ConceptShelf';
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { TableCopyDialogV2, DatasetSelectionDialog } from './TableSelectionView';
import { TableUploadDialog } from './TableSelectionView';
import { toolName } from '../app/App';
import { DataThread } from './DataThread';
import { useTranslation } from 'react-i18next';

import dfLogo from '../assets/df-logo.png';
import exampleImageTable from "../assets/example-image-table.png";
import { ModelSelectionButton } from './ModelSelectionDialog';
import { DBTableSelectionDialog } from './DBTableManager';
import { getUrls } from '../app/utils';
import { DataLoadingChatDialog } from './DataLoadingChat';
import { ReportView } from './ReportView';
import { ExampleSession, exampleSessions, ExampleSessionCard } from './ExampleSessions';

export const DataFormulatorFC = ({ }) => {
    const { t } = useTranslation();

    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const models = useSelector((state: DataFormulatorState) => state.models);
    const modelSlots = useSelector((state: DataFormulatorState) => state.modelSlots);
    const viewMode = useSelector((state: DataFormulatorState) => state.viewMode);
    const theme = useTheme();

    const noBrokenModelSlots = useSelector((state: DataFormulatorState) => {
        const slotTypes = dfSelectors.getAllSlotTypes();
        return slotTypes.every(
            slotType => state.modelSlots[slotType] !== undefined && state.testedModels.find(t => t.id == state.modelSlots[slotType])?.status != 'error');
    });

    const dispatch = useDispatch();

    const handleLoadExampleSession = (session: ExampleSession) => {
        dispatch(dfActions.addMessages({
            timestamp: Date.now(),
            type: 'info',
            component: 'data formulator',
            value: t('messages.loadingExample', { title: session.title }),
        }));

        // Load the complete state from the JSON file
        fetch(session.dataFile)
            .then(res => res.json())
            .then(savedState => {
                // Use loadState to restore the complete session state
                dispatch(dfActions.loadState(savedState));

                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    type: 'success',
                    component: 'data formulator',
                    value: t('messages.loadedExample', { title: session.title }),
                }));
            })
            .catch(error => {
                console.error('Error loading session:', error);
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    type: 'error',
                    component: 'data formulator',
                    value: t('messages.failedToLoad', { title: session.title, error: error.message }),
                }));
            });
    };

    useEffect(() => {
        document.title = toolName;

        // Preload imported images (public images are preloaded in index.html)
        const imagesToPreload = [
            { src: dfLogo, type: 'image/png' },
            { src: exampleImageTable, type: 'image/png' },
        ];

        const preloadLinks: HTMLLinkElement[] = [];
        imagesToPreload.forEach(({ src, type }) => {
            // Use link preload for better priority
            const link = document.createElement('link');
            link.rel = 'preload';
            link.as = 'image';
            link.href = src;
            link.type = type;
            document.head.appendChild(link);
            preloadLinks.push(link);
        });

        // Cleanup function to remove preload links when component unmounts
        return () => {
            preloadLinks.forEach(link => {
                if (link.parentNode) {
                    link.parentNode.removeChild(link);
                }
            });
        };
    }, []);

    useEffect(() => {
        const findWorkingModel = async () => {
            let assignedModels = models.filter(m => Object.values(modelSlots).includes(m.id));
            let unassignedModels = models.filter(m => !Object.values(modelSlots).includes(m.id));

            // Test assigned models in parallel for faster loading
            const assignedPromises = assignedModels.map(async (model) => {
                const message = {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', },
                    body: JSON.stringify({ model }),
                };
                try {
                    const response = await fetch(getUrls().TEST_MODEL, { ...message });
                    const data = await response.json();
                    const status = data["status"] || 'error';
                    dispatch(dfActions.updateModelStatus({ id: model.id, status, message: data["message"] || "" }));
                    return { model, status };
                } catch (error) {
                    dispatch(dfActions.updateModelStatus({ id: model.id, status: 'error', message: (error as Error).message || 'Failed to test model' }));
                    return { model, status: 'error' };
                }
            });

            await Promise.all(assignedPromises);

            // Then test unassigned models sequentially until one works
            for (let model of unassignedModels) {
                const message = {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', },
                    body: JSON.stringify({ model }),
                };
                try {
                    const response = await fetch(getUrls().TEST_MODEL, { ...message });
                    const data = await response.json();
                    const status = data["status"] || 'error';
                    dispatch(dfActions.updateModelStatus({ id: model.id, status, message: data["message"] || "" }));
                    if (status == 'ok') break;
                } catch (error) {
                    dispatch(dfActions.updateModelStatus({ id: model.id, status: 'error', message: (error as Error).message || 'Failed to test model' }));
                }
            }
        };

        if (models.length > 0) {
            findWorkingModel();
        }
    }, []);

    const visPaneMain = (
        <Box sx={{ width: "100%", overflow: "hidden", display: "flex", flexDirection: "row" }}>
            <VisualizationViewFC />
        </Box>);

    const visPane = (
        <Box sx={{
            width: '100%', height: '100%',
            "& .split-view-view:first-of-type": {
                display: 'flex',
                overflow: 'hidden',
            }
        }}>
            <Allotment vertical>
                <Allotment.Pane minSize={200} >
                    {visPaneMain}
                </Allotment.Pane>
                <Allotment.Pane minSize={120} preferredSize={200}>
                    <Box className="table-box">
                        <FreeDataViewFC />
                    </Box>
                </Allotment.Pane>
            </Allotment>
        </Box>);

    let borderBoxStyle = {
        border: '1px solid rgba(0,0,0,0.1)',
        borderRadius: '16px',
        boxShadow: '0 0 5px rgba(0,0,0,0.1)',
    }

    const fixedSplitPane = (
        <Box sx={{ display: 'flex', flexDirection: 'row', height: '100%' }}>
            <Box sx={{
                ...borderBoxStyle,
                margin: '4px 4px 4px 8px', backgroundColor: 'white',
                display: 'flex', height: '100%', width: 'fit-content', flexDirection: 'column'
            }}>
                {tables.length > 0 ? <DataThread sx={{
                    minWidth: 201,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    alignContent: 'flex-start',
                    height: '100%',
                }} /> : ""}
            </Box>
            <Box sx={{
                ...borderBoxStyle,
                margin: '4px 8px 4px 4px', backgroundColor: 'white',
                display: 'flex', height: '100%', flex: 1, overflow: 'hidden', flexDirection: 'row'
            }}>
                {viewMode === 'editor' ? (
                    <>
                        {visPane}
                        <ConceptShelf />
                    </>
                ) : (
                    <ReportView />
                )}
            </Box>

        </Box>
    );

    let exampleMessyText = `Rank	NOC	Gold	Silver	Bronze	Total
1	 South Korea	5	1	1	7
2	 France*	0	1	1	2
 United States	0	1	1	2
4	 China	0	1	0	1
 Germany	0	1	0	1
6	 Mexico	0	0	1	1
 Turkey	0	0	1	1
Totals (7 entries)	5	5	5	15
`

    let footer = <Box sx={{
        color: 'text.secondary', display: 'flex',
        backgroundColor: 'rgba(255, 255, 255, 0.89)',
        alignItems: 'center', justifyContent: 'center'
    }}>
        <Button size="small" color="inherit"
            sx={{ textTransform: 'none' }}
            target="_blank" rel="noopener noreferrer"
            href="https://www.microsoft.com/en-us/privacy/privacystatement">{t('dataFormulator.privacyCookies')}</Button>
        <Divider orientation="vertical" variant="middle" flexItem sx={{ mx: 1 }} />
        <Button size="small" color="inherit"
            sx={{ textTransform: 'none' }}
            target="_blank" rel="noopener noreferrer"
            href="https://www.microsoft.com/en-us/legal/intellectualproperty/copyright">{t('dataFormulator.termsOfUse')}</Button>
        <Divider orientation="vertical" variant="middle" flexItem sx={{ mx: 1 }} />
        <Button size="small" color="inherit"
            sx={{ textTransform: 'none' }}
            target="_blank" rel="noopener noreferrer"
            href="https://github.com/microsoft/data-formulator/issues">{t('dataFormulator.contactUs')}</Button>
        <Typography sx={{ display: 'inline', fontSize: '12px', ml: 1 }}> @ {new Date().getFullYear()}</Typography>
    </Box>

    let dataUploadRequestBox = <Box sx={{
        margin: '4px 4px 4px 8px',
        width: 'calc(100vw - 16px)', overflow: 'auto', display: 'flex', flexDirection: 'column', height: '100%',
    }}
    >
        <Box sx={{ margin: 'auto', pb: '5%', display: "flex", flexDirection: "column", textAlign: "center" }}>
            <Box sx={{
                display: 'flex', mx: 'auto', mb: 2, width: 'fit-content', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                background: `
                linear-gradient(90deg, ${alpha(theme.palette.text.secondary, 0.02)} 1px, transparent 1px),
                linear-gradient(0deg, ${alpha(theme.palette.text.secondary, 0.02)} 1px, transparent 1px)
            `,
                backgroundSize: '16px 16px',
                p: 2,
                borderRadius: '8px',
            }}>
                <Box component="img" sx={{ width: 84, }} alt="" src={dfLogo} fetchPriority="high" />
                <Typography fontSize={64} sx={{ ml: 2, letterSpacing: '0.05em', fontWeight: 200, color: 'text.primary' }}>{toolName}</Typography>
            </Box>
            <Typography fontSize={24} sx={{ color: 'text.secondary' }}>{t('dataFormulator.tagline')}</Typography>
            <Box sx={{
                mt: 4, width: '100%', borderRadius: 8,
                background: `
                    linear-gradient(90deg, ${alpha(theme.palette.text.secondary, 0.02)} 1px, transparent 1px),
                    linear-gradient(0deg, ${alpha(theme.palette.text.secondary, 0.02)} 1px, transparent 1px)
                `,
                backgroundSize: '16px 16px',
                p: 2
            }}>
                <Divider sx={{ width: '200px', mx: 'auto', mb: 2, fontSize: '1.2rem', color: 'text.disabled' }}>
                    <Typography sx={{ fontSize: 14, color: 'text.disabled' }}>
                        {t('dataFormulator.loadSomeData')}
                    </Typography>
                </Divider>
                <Typography variant="h4" sx={{ mx: 'auto', width: 1080, fontSize: 24 }}>
                    <DataLoadingChatDialog buttonElement={<><AutoFixNormalIcon sx={{ mr: 1, verticalAlign: 'middle' }} />{t('dataFormulator.messyData')}</>} />
                    <Box component="span" sx={{ mx: 2, color: 'text.disabled', fontSize: '0.8em' }}>•</Box>
                    <DatasetSelectionDialog buttonElement={<><CategoryIcon sx={{ mr: 1, verticalAlign: 'middle' }} />{t('dataFormulator.examples')}</>} />
                    <Box component="span" sx={{ mx: 2, color: 'text.disabled', fontSize: '0.8em' }}>•</Box>
                    <TableUploadDialog buttonElement={<><FolderOpenIcon sx={{ mr: 1, verticalAlign: 'middle' }} />{t('dataFormulator.files')}</>} disabled={false} />
                    <Box component="span" sx={{ mx: 2, color: 'text.disabled', fontSize: '0.8em' }}>•</Box>
                    <TableCopyDialogV2 buttonElement={<><ContentPasteIcon sx={{ mr: 1, verticalAlign: 'middle' }} />{t('dataFormulator.clipboard')}</>} disabled={false} />
                    <Box component="span" sx={{ mx: 2, color: 'text.disabled', fontSize: '0.8em' }}>•</Box>
                    <DBTableSelectionDialog buttonElement={<><CloudQueueIcon sx={{ mr: 1, verticalAlign: 'middle' }} />{t('dataFormulator.database')}</>} />
                    {/* <br /> */}
                    {/* <Typography sx={{ml: 10, fontSize: 14, color: 'darkgray', transform: 'translateY(-12px)'}}>(csv, tsv, xlsx, json or database)</Typography> */}
                    <Typography variant="body1" color="text.secondary" sx={{ mt: 2, width: '100%' }}>
                        {t('dataFormulator.loadDataDescription')}{' '}
                        <Tooltip title={<Box>{t('tooltips.exampleScreenshot')} <Box component="img" sx={{ width: '100%', marginTop: '6px' }} alt="" src={exampleImageTable} /></Box>}>
                            <Box component="span" sx={{ color: 'secondary.main', cursor: 'help', "&:hover": { textDecoration: 'underline' } }}>{t('dataFormulator.screenshots')}</Box>
                        </Tooltip>{' '}
                        and{' '}
                        <Tooltip title={<Box>{t('tooltips.exampleMessyText')} <Typography sx={{ fontSize: 10, marginTop: '6px' }} component="pre">{exampleMessyText}</Typography></Box>}>
                            <Box component="span" sx={{ color: 'secondary.main', cursor: 'help', "&:hover": { textDecoration: 'underline' } }}>{t('dataFormulator.textBlocks')}</Box>
                        </Tooltip>{' '}
                        {t('dataFormulator.usingAI')}
                    </Typography>
                </Typography>
            </Box>
            <Box sx={{
                mt: 4, borderRadius: 8, p: 2,
                background: `
                 linear-gradient(90deg, ${alpha(theme.palette.text.secondary, 0.02)} 1px, transparent 1px),
                 linear-gradient(0deg, ${alpha(theme.palette.text.secondary, 0.02)} 1px, transparent 1px)
                `,
                backgroundSize: '16px 16px',
            }}>
                <Divider sx={{ width: '200px', mx: 'auto', mb: 3, fontSize: '1.2rem', color: 'text.disabled' }}>
                    <Typography sx={{ fontSize: 14, color: 'text.disabled' }}>
                        {t('dataFormulator.orExploreExamples')}
                    </Typography>
                </Divider>
                <Box sx={{ alignItems: 'center' }}>
                    <Box sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        maxWidth: 1000,
                        margin: '0 auto',
                        px: 1
                    }}>
                        {exampleSessions.map((session) => (
                            <ExampleSessionCard
                                key={session.id}
                                session={session}
                                theme={theme}
                                onClick={() => handleLoadExampleSession(session)}
                            />
                        ))}
                    </Box>
                </Box>
            </Box>
        </Box>
        {footer}
    </Box>;

    return (
        <Box sx={{ display: 'block', width: "100%", height: 'calc(100% - 54px)', position: 'relative' }}>
            <DndProvider backend={HTML5Backend}>
                {tables.length > 0 ? fixedSplitPane : dataUploadRequestBox}
                {!noBrokenModelSlots && (
                    <Box sx={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: alpha(theme.palette.background.default, 0.85),
                        backdropFilter: 'blur(4px)',
                        display: 'flex',
                        flexDirection: 'column',
                        zIndex: 1000,
                    }}>
                        <Box sx={{ margin: 'auto', pb: '5%', display: "flex", flexDirection: "column", textAlign: "center" }}>
                            <Box component="img" sx={{ width: 196, margin: "auto" }} alt="" src={dfLogo} fetchPriority="high" />
                            <Typography variant="h3" sx={{ marginTop: "20px", fontWeight: 200, letterSpacing: '0.05em' }}>
                                {toolName}
                            </Typography>
                            <Typography variant="h4" sx={{ mt: 3, fontSize: 28, letterSpacing: '0.02em' }}>
                                {t('dataFormulator.firstLetsSelectModel')} <ModelSelectionButton />
                            </Typography>
                            <Typography color="text.secondary" variant="body1" sx={{ mt: 2, width: 600 }}>{t('messages.bestExperience')}</Typography>
                        </Box>
                        {footer}
                    </Box>
                )}
            </DndProvider>
        </Box>);
}