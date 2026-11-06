// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux'
import { DataFormulatorState, dfActions, dfSelectors, generateFreshChart } from '../app/dfSlice';

import embed from 'vega-embed';

import {
    Box,
    Typography,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    ListSubheader,
    ListItemIcon,
    ListItemText,
    IconButton,
    Tooltip,
    TextField,
    Card,
    Autocomplete,
    Menu,
    Divider,
    alpha,
    useTheme,
    Slider,
    LinearProgress,
    Collapse,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import { WritingPencil } from '../components/FunComponents';
import { Channel, Chart, Trigger, duplicateChart } from "../components/ComponentType";

import _ from 'lodash';

export const ConfigSlider: FC<{
    value: number;
    propDef: { label: string; min?: number; max?: number; step?: number };
    onCommit: (value: number) => void;
}> = ({ value, propDef, onCommit }) => {
    const [localValue, setLocalValue] = useState(value);
    useEffect(() => { setLocalValue(value); }, [value]);

    return (
        <>
            <Slider
                size="small"
                value={localValue}
                min={propDef.min}
                max={propDef.max}
                step={propDef.step}
                onChange={(_event, newValue) => setLocalValue(newValue as number)}
                onChangeCommitted={(_event, newValue) => onCommit(newValue as number)}
                valueLabelDisplay="auto"
                sx={{
                    flex: 1, height: 3, mx: 0.5,
                    '& .MuiSlider-thumb': { width: 10, height: 10 },
                    '& .MuiSlider-valueLabel': { fontSize: textVar.xxs, padding: '2px 4px', lineHeight: 1.2 },
                }}
            />
            <Typography variant="caption" sx={{ fontSize: textVar.xxs, color: 'text.secondary', minWidth: '20px', textAlign: 'right' }}>
                {localValue}
            </Typography>
        </>
    );
};

import '../scss/EncodingShelf.scss';
import { DictTable } from "../components/ComponentType";

import { resolveChartFields, assembleVegaChart, resolveRecommendedChart } from '../app/utils';
import { downscaleImageForAgent } from '../app/chartCache';
import { EncodingBox } from './EncodingBox';

import { channelGroups, CHART_TEMPLATES, getChartChannels, getChartTemplate } from '../components/ChartTemplates';
import { checkChartAvailability, getDataTable } from './ChartUtils';

const chartNameToI18nKey: Record<string, string> = {
    "Auto": "auto", "Table": "table",
    "Scatter Plot": "scatterPlot", "Regression": "regression",
    "Ranged Dot Plot": "rangedDotPlot", "Boxplot": "boxplot", "Strip Plot": "stripPlot",
    "Bar Chart": "barChart", "Grouped Bar Chart": "groupedBarChart",
    "Stacked Bar Chart": "stackedBarChart", "Histogram": "histogram",
    "Lollipop Chart": "lollipopChart", "Pyramid Chart": "pyramidChart",
    "Line Chart": "lineChart",
    "Bump Chart": "bumpChart", "Area Chart": "areaChart", "Streamgraph": "streamgraph",
    "Pie Chart": "pieChart", "Rose Chart": "roseChart",
    "Heatmap": "heatmap", "Waterfall Chart": "waterfallChart",
    "Density Plot": "densityPlot", "Radar Chart": "radarChart",
    "Candlestick Chart": "candlestickChart",
    "US Map": "usMap", "World Map": "worldMap",
    "Custom Point": "customPoint", "Custom Line": "customLine",
    "Custom Bar": "customBar", "Custom Rect": "customRect", "Custom Area": "customArea",
};

const chartCategoryToI18nKey: Record<string, string> = {
    "Points": "points",
    "Bars": "bars",
    "Distributions": "distributions",
    "Lines & Areas": "linesAndAreas",
    "Circular": "circular",
    "Tables & Maps": "tablesAndMaps",
    "Custom": "custom",
};

import { AppDispatch } from '../app/store';

import { iconVar, textVar } from '../app/layout';

// Property and state of an encoding shelf
export interface EncodingShelfCardProps { 
    chartId: string;
    trigger?: Trigger;
    noBorder?: boolean;
    // Render only the chat / follow-up box (+ ideas). Used by the floating
    // chat FAB so the chat lives off-canvas.
    chatOnly?: boolean;
    // Render the encoding shelf without the chat box (+ no ideas). Used by the
    // floating encoding popover at the top-right of the chart.
    hideChat?: boolean;
}



export const EncodingShelfCard: FC<EncodingShelfCardProps> = function ({ chartId, chatOnly, hideChat }) {
    const { t } = useTranslation();
    const theme = useTheme();

    const getChartNameTip = (chartName: string) => {
        const key = chartNameToI18nKey[chartName];
        return key ? t(`chart.templateNames.${key}`) : '';
    };
    const getChartCategoryTip = (category: string) => {
        const key = chartCategoryToI18nKey[category];
        return key ? t(`chart.chartCategoryTip.${key}`) : '';
    };

    // reference to states
    const tables = useSelector(dfSelectors.getAllTables);
    const focusedId = useSelector((state: DataFormulatorState) => state.focusedId);

    let allCharts = useSelector(dfSelectors.getAllCharts);

    // The table the user is currently looking at (from focused state)
    const focusedTableId = (() => {
        if (!focusedId) return undefined;
        if (focusedId.type === 'table') return focusedId.tableId;
        if (focusedId.type === 'chart') {
            const focusedChart = allCharts.find(c => c.id === focusedId.chartId);
            return focusedChart?.tableRef;
        }
        return undefined;
    })();

    let chart = allCharts.find(c => c.id == chartId) as Chart;
    const triggerTable = chart.source == "trigger" ? tables.find(t => t.derive?.trigger?.chart?.id == chartId) : undefined;
    let trigger = triggerTable?.derive?.trigger;

    // The instruction that made a trigger chart's table is the agent message right before it (design-docs/58).
    const threadGraph = useSelector(dfSelectors.getThreadGraph);
    const textTurns = useSelector((state: DataFormulatorState) => state.textTurns);
    const instructionId = triggerTable ? threadGraph.edgeInto(triggerTable.id).at(-1) : undefined;
    const triggerPrompt = textTurns.find(turn => turn.id === instructionId && !turn.prompt)?.content || '';
    let [prompt, setPrompt] = useState<string>(triggerPrompt);

    const chartSynthesisInProgress = useSelector(
        (state: DataFormulatorState) => state.chartSynthesisInProgress,
    );
    const isDataAgentRunning = chartSynthesisInProgress.includes(chartId);

    useEffect(() => {
        setPrompt(triggerPrompt);
    }, [chartId]);

    let encodingMap = chart?.encodingMap;

    const dispatch = useDispatch<AppDispatch>();

    const [chartTypeMenuOpen, setChartTypeMenuOpen] = useState<boolean>(false);

    // Encoding channels are always shown (no auto hide/expand on hover/drag).
    const shouldExpandAll = true;
    

    let handleUpdateChartType = (newChartType: string) => {
        dispatch(dfActions.updateChartType({chartId, chartType: newChartType}));
        // Close the menu after selection
        setChartTypeMenuOpen(false);
    }

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const activeModel = useSelector(dfSelectors.getActiveModel);

    let currentTable = getDataTable(chart, tables, allCharts, conceptShelfItems);

    // Check if chart is available
    let isChartAvailable = checkChartAvailability(chart, conceptShelfItems, currentTable.rows);


    let encodingBoxGroups = Object.entries(channelGroups)
        .filter(([group, channelList]) => channelList.some(ch => Object.keys(encodingMap).includes(ch)))
        .map(([group, channelList]) => {
            let channels = channelList.filter(channel => Object.keys(encodingMap).includes(channel));
            let occupiedChannels = channels.filter(ch => encodingMap[ch as Channel]?.fieldID);
            let unoccupiedChannels = channels.filter(ch => !encodingMap[ch as Channel]?.fieldID);

            let hasVisibleContent = occupiedChannels.length > 0 || shouldExpandAll;

            let component = <Box key={`encoding-group-box-${group}`} sx={{ mt: (group && shouldExpandAll) ? '6px' : 0 }}>
                {channels.map(channel => {
                    const isOccupied = encodingMap[channel as Channel]?.fieldID;
                    const box = <EncodingBox key={`shelf-${channel}`} channel={channel as Channel} chartId={chartId} tableId={currentTable.id} />;
                    return isOccupied ? box : (
                        <Collapse key={`collapse-${channel}`} in={shouldExpandAll} timeout={200}>
                            {box}
                        </Collapse>
                    );
                })}
            </Box>
            return component;
        });

    let channelComponent = (
        <Box sx={{ width: "100%", minWidth: "220px", height: '100%', display: "flex", flexDirection: "column", gap: '4px' }}>
            {!chatOnly && (<>
            <Box key='mark-selector-box' sx={{ ml: 1, flex: '0 0 auto', display: 'flex', alignItems: 'center' }}>
                <FormControl sx={{ m: 1, minWidth: 120, flex: 1, margin: "0px 0"}} size="small">
                    <Select
                        variant="standard"
                        labelId="chart-mark-select-label"
                        id="chart-mark-select"
                        value={chart.chartType}
                        // Add these props to control the open state
                        open={chartTypeMenuOpen}
                        onOpen={() => setChartTypeMenuOpen(true)}
                        onClose={() => setChartTypeMenuOpen(false)}
                        MenuProps={{
                            // Use a plain "menu" rather than the default
                            // "selectedMenu": the latter shifts the popup up so
                            // the selected item overlaps the trigger (and
                            // auto-scrolls to it), which makes the dropdown feel
                            // like it jumps. "menu" simply opens straight below.
                            variant: 'menu',
                            anchorOrigin: {
                                vertical: 'bottom',
                                horizontal: 'left',
                            },
                            transformOrigin: {
                                vertical: 'top',
                                horizontal: 'left',
                            },
                            PaperProps: {
                                sx: {
                                    mt: 1,
                                    maxHeight: '60vh',
                                    '& .MuiList-root': {
                                        display: 'grid',
                                        gridTemplateColumns: '1fr 1fr',
                                        gap: 0,
                                        padding: '8px'
                                    }
                                }
                            }
                        }}
                        renderValue={(value: string) => {
                            const tmpl = getChartTemplate(value);
                            return (
                                <Tooltip title={getChartNameTip(value)} placement="left" arrow>
                                <div style={{display: 'flex', padding: "0px 0px 0px 4px"}}>
                                    <ListItemIcon sx={{minWidth: "24px"}}>
                                        {typeof tmpl?.icon == 'string' ? <img height="24px" width="24px" src={tmpl?.icon} alt="" role="presentation" /> : 
                                         <Box sx={{width: "24px", height: "24px"}}>{tmpl?.icon}</Box>}
                                        </ListItemIcon>
                                    <ListItemText sx={{marginLeft: "2px", whiteSpace: "initial"}} slotProps={{primary: {fontSize: textVar.sm}}}>{tmpl?.chart}</ListItemText>
                                </div>
                                </Tooltip>
                            )
                        }}
                        onChange={(event) => { }}>
                        {Object.entries(CHART_TEMPLATES).map(([group, templates]) => {
                            return [
                                <ListSubheader sx={{ 
                                    color: "text.secondary", 
                                    lineHeight: 2, 
                                    fontSize: textVar.sm,
                                    gridColumn: '1 / -1'
                                }} key={group}>
                                    <Tooltip title={getChartCategoryTip(group)} placement="left" arrow>
                                        <span>{group}</span>
                                    </Tooltip>
                                </ListSubheader>,
                                ...templates.map((t, i) => (
                                    <MenuItem 
                                        sx={{ 
                                            fontSize: textVar.sm, 
                                            paddingLeft: 2, 
                                            paddingRight: 2,
                                            minHeight: '32px',
                                            margin: '1px 0'
                                        }} 
                                        value={t.chart} 
                                        key={`${group}-${i}`}
                                        onClick={(e) => {
                                            console.log('MenuItem clicked:', t.chart);
                                            handleUpdateChartType(t.chart);
                                        }}
                                    >
                                        <Tooltip title={getChartNameTip(t.chart)} placement="left" arrow>
                                        <Box sx={{display: 'flex', width: '100%'}}>
                                            <ListItemIcon sx={{minWidth: "20px"}}>
                                                {typeof t?.icon == 'string' ? 
                                                    <img height="20px" width="20px" src={t?.icon} alt="" role="presentation" /> : 
                                                    <Box sx={{width: "20px", height: "20px"}}>{t?.icon}</Box>
                                                }
                                            </ListItemIcon>
                                            <ListItemText 
                                                slotProps={{primary: {fontSize: textVar.xs}}} 
                                                sx={{ margin: 0 }}
                                            >
                                                {t.chart}
                                            </ListItemText>
                                        </Box>
                                        </Tooltip>
                                    </MenuItem>
                                ))
                            ]
                        })}
                    </Select>
                </FormControl>
            </Box>
            {/* Template-driven config property selectors */}
            <Box key='encoding-and-config' sx={{
                    ml: 1,
                    flex: '1 1 auto',
                }} style={{ height: "calc(100% - 100px)" }} className="encoding-list">
            {(() => {
                    const template = getChartTemplate(chart.chartType);
                    const configProps = template?.properties;
                    if (!configProps || configProps.length === 0) return null;
                    // Minimal encodings view for a property's own `check`. This
                    // static popover has no live data/semantics, so a data-aware
                    // property's check returns `applicable: false` here and the
                    // property self-hides — surfacing only in the quick-config bar.
                    const shelfEncodings: Record<string, { field: any }> = {};
                    for (const ch of Object.keys(chart.encodingMap)) {
                        const fieldID = chart.encodingMap[ch as Channel]?.fieldID;
                        if (fieldID != null) shelfEncodings[ch] = { field: fieldID };
                    }
                    return (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '1px', mb: '6px' }}>
                            {configProps.map((propDef) => {
                                // A property gates itself via its own applicability
                                // check. Without one it is always shown.
                                if (propDef.check &&
                                    !propDef.check({ encodings: shelfEncodings as any }).applicable) {
                                    return null;
                                }
                                if (propDef.type === 'continuous') {
                                    const currentValue = chart.config?.[propDef.key] ?? propDef.defaultValue ?? propDef.min ?? 0;
                                    return (
                                        <Box key={`config-${propDef.key}`} sx={{
                                            display: 'flex', alignItems: 'center', 
                                            borderRadius: '12px',
                                            minHeight: '18px',
                                            overflow: 'hidden', padding: '0px 10px 0px 0px',
                                        }}>
                                            <Typography variant="caption" sx={{
                                                padding: '0px 6px', color: 'text.secondary', fontSize: textVar.xxs,
                                                whiteSpace: 'nowrap', fontWeight: 500, minWidth: '40px', userSelect: 'none',
                                            }}>
                                                {propDef.label}
                                            </Typography>
                                            <ConfigSlider
                                                value={currentValue}
                                                propDef={propDef}
                                                onCommit={(newValue) => dispatch(dfActions.updateChartConfig({chartId, key: propDef.key, value: newValue}))}
                                            />
                                        </Box>
                                    );
                                }
                                if (propDef.type === 'binary') {
                                    const currentValue = chart.config?.[propDef.key] ?? propDef.defaultValue ?? false;
                                    return (
                                        <Box key={`config-${propDef.key}`} sx={{
                                            display: 'flex', alignItems: 'center',
                                            borderRadius: '12px',
                                            minHeight: '18px',
                                            overflow: 'hidden', padding: '0px 8px',
                                            cursor: 'pointer',
                                            '&:hover': { backgroundColor: 'rgba(0,0,0,0.04)' },
                                        }}
                                        onClick={() => {
                                            dispatch(dfActions.updateChartConfig({chartId, key: propDef.key, value: !currentValue}));
                                        }}>
                                            <Typography variant="caption" sx={{
                                                flex: 1, color: 'text.secondary', fontSize: textVar.xxs,
                                                whiteSpace: 'nowrap', fontWeight: 500, userSelect: 'none',
                                            }}>
                                                {propDef.label}
                                            </Typography>
                                            <Box sx={{
                                                width: 28, height: 14, borderRadius: '7px',
                                                backgroundColor: currentValue ? theme.palette.primary.main : 'rgba(0,0,0,0.2)',
                                                position: 'relative', transition: 'background-color 0.2s',
                                                flexShrink: 0,
                                            }}>
                                                <Box sx={{
                                                    width: 10, height: 10, borderRadius: '50%',
                                                    backgroundColor: 'white',
                                                    position: 'absolute', top: 2,
                                                    left: currentValue ? 16 : 2,
                                                    transition: 'left 0.2s',
                                                }} />
                                            </Box>
                                        </Box>
                                    );
                                }
                                if (propDef.type !== 'discrete' || !propDef.options) return null;
                                const currentValue = chart.config?.[propDef.key] ?? propDef.defaultValue;
                                const options = propDef.options;
                                // Find the index of the current value in options (deep compare via JSON)
                                const currentSerialized = JSON.stringify(currentValue);
                                let selectedIndex = options.findIndex(o => JSON.stringify(o.value) === currentSerialized);
                                if (selectedIndex < 0) selectedIndex = 0;
                                return (
                                    <Box key={`config-${propDef.key}`} sx={{
                                        display: 'flex', alignItems: 'center', 
                                        borderRadius: '12px',
                                        minHeight: '22px',
                                        overflow: 'hidden',
                                    }}>
                                        <Typography variant="caption" sx={{
                                            padding: '0px 8px', color: 'text.secondary', fontSize: textVar.xxs,
                                            whiteSpace: 'nowrap', fontWeight: 500, userSelect: 'none',
                                        }}>
                                            {propDef.label}
                                        </Typography>
                                        <Select
                                            variant="standard"
                                            id={`config-${propDef.key}-select`}
                                            value={selectedIndex}
                                            onChange={(event) => {
                                                const idx = event.target.value as number;
                                                dispatch(dfActions.updateChartConfig({chartId, key: propDef.key, value: options[idx].value}));
                                            }}
                                            disableUnderline
                                            sx={{
                                                flex: 1, fontSize: textVar.xs, height: '22px',
                                                backgroundColor: 'rgba(0,0,0,0.04)',
                                                borderRadius: '6px',
                                                '&:hover': { backgroundColor: 'rgba(0,0,0,0.07)' },
                                                '& .MuiSelect-select': { padding: '1px 20px 1px 6px !important', fontSize: textVar.xs },
                                                '& .MuiSvgIcon-root': { fontSize: iconVar.sm, right: 2 },
                                            }}
                                            renderValue={(idx: number) => {
                                                return <span style={{fontSize: textVar.xs}}>{options[idx]?.label || "Default"}</span>;
                                            }}
                                        >
                                            {options.map((opt, i) => (
                                                <MenuItem value={i} key={`config-${propDef.key}-${i}`} sx={{ fontSize: textVar.xs, minHeight: '28px' }}>
                                                    {opt.label}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </Box>
                                );
                            })}
                        </Box>
                    );
                })()}
                {encodingBoxGroups}
            </Box>
            </>)}
        </Box>);

    // Whether the data agent is synthesizing this chart; drives the overlay
    // status line shown below.
    const isAgentWorking = isDataAgentRunning;
    const agentStatusText = 'preparing data for the chart…';

    const encodingShelfCard = (
        <Box sx={{ 
            position: 'relative',
            padding: '4px 6px', 
            maxWidth: "400px", 
            display: 'flex', 
            flexDirection: 'column', 
        }}>
            {/* Opaque agent-working overlay blocks the encoding shelf while
                the data agent runs, without dimming the chart canvas. */}
            {isAgentWorking && (
                <Box sx={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: alpha(theme.palette.background.paper, 0.88),
                    backdropFilter: 'blur(3px)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 0.5,
                    zIndex: 2,
                    px: 2,
                }}>
                    <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 0.75 }}>
                        <WritingPencil size={12} />
                        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500, fontSize: textVar.xs, lineHeight: 1.4 }}>
                            {agentStatusText}
                        </Typography>
                    </Box>
                    <LinearProgress sx={{
                        position: 'absolute', bottom: 0, left: 0, right: 0, height: 2,
                        backgroundColor: alpha(theme.palette.primary.main, 0.15),
                        '& .MuiLinearProgress-bar': { backgroundColor: theme.palette.primary.main },
                    }} />
                </Box>
            )}
            <Box sx={{ padding: '4px 0px' }}>
                {channelComponent}
            </Box>
        </Box>
    );

    return encodingShelfCard;
}

// Function to convert Vega-Lite spec to PNG data URL with improved resolution
const vegaLiteSpecToPng = async (spec: any, scale: number = 2.0, quality: number = 1.0): Promise<string | null> => {
    try {
        // Create a temporary container
        const tempId = `temp-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const tempContainer = document.createElement('div');
        tempContainer.id = tempId;
        tempContainer.style.position = 'absolute';
        tempContainer.style.left = '-9999px';
        tempContainer.style.top = '-9999px';
        document.body.appendChild(tempContainer);

        // Embed the chart with higher resolution settings
        const result = await embed('#' + tempId, spec, { 
            actions: false, 
            renderer: "canvas",
            scaleFactor: scale // Apply scale factor for higher resolution
        });

        // Get the canvas and apply high-resolution rendering
        const canvas = await result.view.toCanvas(scale); // Pass scale to toCanvas
        const pngDataUrl = canvas.toDataURL('image/png', quality);

        // Clean up
        document.body.removeChild(tempContainer);

        return pngDataUrl;
    } catch (error) {
        console.error('Error converting Vega-Lite spec to PNG:', error);
        return null;
    }
};

// Alternative method using toImageURL for even better quality
const vegaLiteSpecToPngWithImageURL = async (spec: any, scale: number = 2.0): Promise<string | null> => {
    try {
        // Create a temporary container
        const tempId = `temp-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const tempContainer = document.createElement('div');
        tempContainer.id = tempId;
        tempContainer.style.position = 'absolute';
        tempContainer.style.left = '-9999px';
        tempContainer.style.top = '-9999px';
        document.body.appendChild(tempContainer);

        // Embed the chart
        const result = await embed('#' + tempId, spec, { 
            actions: false, 
            renderer: "canvas",
            scaleFactor: scale
        });

        // Use toImageURL for better quality
        const pngDataUrl = await result.view.toImageURL('png', scale);

        // Clean up
        document.body.removeChild(tempContainer);

        return pngDataUrl;
    } catch (error) {
        console.error('Error converting Vega-Lite spec to PNG:', error);
        return null;
    }
};
