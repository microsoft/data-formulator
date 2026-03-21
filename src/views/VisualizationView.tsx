// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, {
  FC,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Alert,
  Box,
  Button,
  CardContent,
  CircularProgress,
  Collapse,
  Dialog,
  DialogContent,
  Divider,
  Fade,
  Grow,
  Icon,
  IconButton,
  LinearProgress,
  MenuItem,
  Popover,
  Slider,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import _ from "lodash";

import ButtonGroup from "@mui/material/ButtonGroup";

import embed from "vega-embed";
import AnimateOnChange from "react-animate-on-change";

import "../scss/VisualizationView.scss";
import { useDispatch, useSelector } from "react-redux";
import { DataFormulatorState, dfActions, getSessionId } from "../app/dfSlice";
import {
  assembleVegaChart,
  extractFieldsFromEncodingMap,
  getUrls,
  prepVisTable,
} from "../app/utils";
import {
  Chart,
  EncodingItem,
  EncodingMap,
  FieldItem,
} from "../components/ComponentType";
import { DictTable } from "../components/ComponentType";

import AddchartIcon from "@mui/icons-material/Addchart";
import DeleteIcon from "@mui/icons-material/Delete";
import StarIcon from "@mui/icons-material/Star";
import TerminalIcon from "@mui/icons-material/Terminal";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import QuestionAnswerIcon from "@mui/icons-material/QuestionAnswer";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import TextSnippetIcon from "@mui/icons-material/TextSnippet";
import FilterAltIcon from "@mui/icons-material/FilterAlt";
import CheckIcon from "@mui/icons-material/Check";
import CloudQueueIcon from "@mui/icons-material/CloudQueue";
import InfoIcon from "@mui/icons-material/Info";
import CasinoIcon from "@mui/icons-material/Casino";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import AutorenewIcon from "@mui/icons-material/Autorenew";

import {
  CHART_TEMPLATES,
  getChartTemplate,
} from "../components/ChartTemplates";

import Prism from "prismjs";
import "prismjs/components/prism-python"; // Language
import "prismjs/components/prism-sql"; // Language
import "prismjs/components/prism-markdown"; // Language
import "prismjs/components/prism-typescript"; // Language
import "prismjs/themes/prism.css"; //Example style, you can use another

import { ChatDialog } from "./ChatDialog";
import { EncodingShelfThread } from "./EncodingShelfThread";
import { CustomReactTable } from "./ReactTable";
import InsightsIcon from "@mui/icons-material/Insights";

import { MuiMarkdown, getOverrides } from "mui-markdown";

import { dfSelectors } from "../app/dfSlice";
import { ChartRecBox } from "./ChartRecBox";
import { ConceptShelf } from "./ConceptShelf";
import {
  CodeExplanationCard,
  ConceptExplCards,
  extractConceptExplanations,
} from "./ExplComponents";
import { buildQcDataQuery, toSafeQcTableName } from "./DBTableManager";
import CodeIcon from "@mui/icons-material/Code";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { any } from "prop-types";

export interface VisPanelProps {}

export interface VisPanelState {
  focusedIndex: number;
  focusUpdated: boolean;
  viewMode: "gallery" | "carousel";
}

export let generateChartSkeleton = (
  icon: any,
  width: number = 160,
  height: number = 160,
  opacity: number = 0.5,
) => (
  <Box width={width} height={height} sx={{ display: "flex" }}>
    {icon == undefined ? (
      <AddchartIcon sx={{ color: "lightgray", margin: "auto" }} />
    ) : typeof icon == "string" ? (
      <Box width="100%" sx={{ display: "flex", opacity: opacity }}>
        <img
          height={Math.min(64, height)}
          width={Math.min(64, width)}
          style={{
            maxHeight: Math.min(height, Math.max(32, 0.5 * height)),
            maxWidth: Math.min(width, Math.max(32, 0.5 * width)),
            margin: "auto",
          }}
          src={icon}
          alt=""
          role="presentation"
        />
      </Box>
    ) : (
      <Box width="100%" sx={{ display: "flex", opacity: opacity }}>
        {React.cloneElement(icon, {
          style: {
            maxHeight: Math.min(height, 32),
            maxWidth: Math.min(width, 32),
            margin: "auto",
          },
        })}
      </Box>
    )}
  </Box>
);

export let renderTableChart = (
  chart: Chart,
  conceptShelfItems: FieldItem[],
  extTable: any[],
  width: number = 120,
  height: number = 120,
) => {
  let fields = Object.entries(chart.encodingMap)
    .filter(([channel, encoding]) => {
      return encoding.fieldID != undefined;
    })
    .map(
      ([channel, encoding]) =>
        conceptShelfItems.find((f) => f.id == encoding.fieldID) as FieldItem,
    );

  if (fields.length == 0) {
    fields = conceptShelfItems.filter((f) =>
      Object.keys(extTable[0]).includes(f.name),
    );
  }

  let rows = extTable.map((row) =>
    Object.fromEntries(
      fields
        .filter((f) => Object.keys(row).includes(f.name))
        .map((f) => [f.name, row[f.name]]),
    ),
  );

  let colDefs = fields.map((field) => {
    let name = field.name;
    return {
      id: name,
      label: name,
      minWidth: 30,
      align: undefined,
      format: (value: any) => `${value}`,
      source: field.source,
    };
  });

  return (
    <Box
      sx={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        margin: "auto",
      }}
    >
      <CustomReactTable
        rows={rows}
        columnDefs={colDefs}
        rowsPerPageNum={10}
        maxCellWidth={180}
        compact
      />
    </Box>
  );
};

export let getDataTable = (
  chart: Chart,
  tables: DictTable[],
  charts: Chart[],
  conceptShelfItems: FieldItem[],
  ignoreTableRef = false,
) => {
  // given a chart, determine which table would be used to visualize the chart

  // return the table directly
  if (chart.tableRef && !ignoreTableRef) {
    return tables.find((t) => t.id == chart.tableRef) as DictTable;
  }

  let activeFields = conceptShelfItems.filter((field) =>
    Array.from(Object.values(chart.encodingMap))
      .map((enc: EncodingItem) => enc.fieldID)
      .includes(field.id),
  );

  let workingTableCandidates = tables.filter((t) => {
    return activeFields.every((f) => t.names.includes(f.name));
  });

  let confirmedTableCandidates = workingTableCandidates.filter(
    (t) => !charts.some((c) => c.saved && c.tableRef == t.id),
  );
  if (confirmedTableCandidates.length > 0) {
    return confirmedTableCandidates[0];
  } else if (workingTableCandidates.length > 0) {
    return workingTableCandidates[0];
  } else {
    // sort base tables based on how many active fields are covered by existing tables
    return tables
      .filter((t) => t.derive == undefined)
      .sort(
        (a, b) =>
          activeFields.filter((f) => a.names.includes(f.name)).length -
          activeFields.filter((f) => b.names.includes(f.name)).length,
      )
      .reverse()[0];
  }
};

export let CodeBox: FC<{ code: string; language: string; fontSize?: number }> =
  function CodeBox({ code, language, fontSize = 10 }) {
    useEffect(() => {
      Prism.highlightAll();
    }, [code]);

    return (
      <pre style={{ fontSize: fontSize }}>
        <code className={`language-${language}`}>{code}</code>
      </pre>
    );
  };

export let checkChartAvailabilityOnPreparedData = (
  chart: Chart,
  conceptShelfItems: FieldItem[],
  visTableRows: any[],
) => {
  let visFieldsFinalNames = Object.keys(chart.encodingMap)
    .filter(
      (key) => chart.encodingMap[key as keyof EncodingMap].fieldID != undefined,
    )
    .map((key) => [
      chart.encodingMap[key as keyof EncodingMap].fieldID,
      chart.encodingMap[key as keyof EncodingMap].aggregate,
    ])
    .map(([id, aggregate]) => {
      let field = conceptShelfItems.find((f) => f.id == id);
      if (field) {
        if (aggregate) {
          return aggregate == "count" ? "_count" : `${field.name}_${aggregate}`;
        } else {
          return field.name;
        }
      }
      return undefined;
    })
    .filter((f) => f != undefined);
  return (
    visFieldsFinalNames.length > 0 &&
    visTableRows.length > 0 &&
    visFieldsFinalNames.every((name) =>
      Object.keys(visTableRows[0]).includes(name),
    )
  );
};

export let checkChartAvailability = (
  chart: Chart,
  conceptShelfItems: FieldItem[],
  visTableRows: any[],
) => {
  let visFieldIds = Object.keys(chart.encodingMap)
    .filter(
      (key) => chart.encodingMap[key as keyof EncodingMap].fieldID != undefined,
    )
    .map((key) => chart.encodingMap[key as keyof EncodingMap].fieldID);
  let visFields = conceptShelfItems.filter((f) => visFieldIds.includes(f.id));
  return (
    visFields.length > 0 &&
    visTableRows.length > 0 &&
    visFields.every((f) => Object.keys(visTableRows[0]).includes(f.name))
  );
};

export let SampleSizeEditor: FC<{
  initialRange: [number, number];
  totalSize: number;
  onSampleSizeChange: (newRange: [number, number]) => void;
}> = function SampleSizeEditor({
  initialRange,
  totalSize,
  onSampleSizeChange,
}) {
  const maxSliderSize = totalSize;
  const minSliderSize = 1;

  const normalizeRange = (range: [number, number]) => {
    const lower = Math.min(Math.max(range[0], minSliderSize), maxSliderSize);
    const upper = Math.min(Math.max(range[1], minSliderSize), maxSliderSize);
    return [Math.min(lower, upper), Math.max(lower, upper)] as [number, number];
  };

  const [sampleRange, setSampleRange] = useState<[number, number]>(() =>
    normalizeRange(initialRange),
  );
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  useEffect(() => {
    setSampleRange(normalizeRange(initialRange));
  }, [initialRange, maxSliderSize]);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
    <Box
      component="span"
      sx={{ display: "flex", flexDirection: "row", alignItems: "center" }}
    >
      <Button
        onClick={handleClick}
        sx={{ textTransform: "none", fontSize: "12px" }}
      >
        {sampleRange[0]} - {sampleRange[1]} / {totalSize}
      </Button>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "left",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "left",
        }}
      >
        <Box sx={{ p: 2, width: 350 }}>
          <Typography fontSize="small" gutterBottom>
            Adjust sample range: {sampleRange[0]} - {sampleRange[1]} rows
          </Typography>
          {/* Slider Section */}
          <Box
            sx={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              mb: 2,
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
              {minSliderSize}
            </Typography>
            <Slider
              size="small"
              min={minSliderSize}
              max={maxSliderSize}
              sx={{ mr: 1, flex: 1 }}
              value={sampleRange}
              disableSwap
              onChange={(_, value) => setSampleRange(value as [number, number])}
              valueLabelDisplay="auto"
              getAriaLabel={(index) =>
                index === 0 ? "minimum sample size" : "maximum sample size"
              }
            />
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              {maxSliderSize}
            </Typography>
          </Box>

          {/* Number Input Section */}
          <Box
            sx={{
              display: "flex",
              flexDirection: "row",
              gap: 1.5,
              alignItems: "flex-end",
              mb: 2,
            }}
          >
            <TextField
              label="Min"
              type="number"
              size="small"
              variant="outlined"
              value={sampleRange[0]}
              onChange={(e) => {
                const minVal = Math.max(
                  minSliderSize,
                  Math.min(parseInt(e.target.value) || 0, sampleRange[1]),
                );
                setSampleRange([minVal, sampleRange[1]]);
              }}
              inputProps={{
                min: minSliderSize,
                max: sampleRange[1],
                step: 1,
              }}
              sx={{ width: 120 }}
            />
            <Typography variant="caption" color="text.secondary">
              to
            </Typography>
            <TextField
              label="Max"
              type="number"
              size="small"
              variant="outlined"
              value={sampleRange[1]}
              onChange={(e) => {
                const maxVal = Math.min(
                  maxSliderSize,
                  Math.max(
                    parseInt(e.target.value) || maxSliderSize,
                    sampleRange[0],
                  ),
                );
                setSampleRange([sampleRange[0], maxVal]);
              }}
              inputProps={{
                min: sampleRange[0],
                max: maxSliderSize,
                step: 1,
              }}
              sx={{ width: 120 }}
            />
          </Box>

          {/* Button Section */}
          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Button
              sx={{ textTransform: "none", fontSize: "12px" }}
              onClick={() => {
                onSampleSizeChange(sampleRange);
                setAnchorEl(null);
              }}
            >
              Resample
            </Button>
          </Box>
        </Box>
      </Popover>
    </Box>
  );
};

// Simple component that only handles Vega chart rendering
/* eslint-disable react/prop-types */
const VegaChartRenderer: FC<{
  chart: Chart;
  conceptShelfItems: FieldItem[];
  visTableRows: any[];
  tableMetadata: any;
  chartWidth: number;
  chartHeight: number;
  scaleFactor: number;
  chartUnavailable: boolean;
  originalTable?: any[]; // Original full table with all columns
}> = React.memo(
  ({
    chart,
    conceptShelfItems,
    visTableRows,
    tableMetadata,
    chartWidth,
    chartHeight,
    scaleFactor,
    chartUnavailable,
    originalTable,
  }) => {
    const elementId = `focused-chart-element-${chart.id}`;
    const containerRef = useRef<HTMLDivElement>(null);
    const dispatch = useDispatch();
    const [isChartRendering, setIsChartRendering] = useState<boolean>(false);

    // Track active Vega view to properly finalize it when switching charts
    const vegaViewRef = useRef<any>(null);
    useEffect(() => {
      // Log all vega containers in DOM at this moment
      const vegaContainers = document.querySelectorAll(
        '[id^="focused-chart-element-"]',
      );
      if (
        chart.chartType === "Auto" ||
        chart.chartType === "Table" ||
        chartUnavailable
      ) {
        setIsChartRendering(false);
        return;
      }

      // Skip embed when there is no data yet (stale-guard or still loading).
      // Avoids container-not-found retries while the chart is transitioning.
      if (visTableRows.length === 0) {
        setIsChartRendering(false);
        return;
      }

      // 🚀 Show placeholder immediately
      setIsChartRendering(true);

      // ✅ Wrap in async IIFE to properly await assembleVegaChart

      (async () => {
        try {
          const dataToVisualize = visTableRows;
          const assembledChart = await assembleVegaChart(
            chart.chartType,
            chart.encodingMap,
            conceptShelfItems,
            dataToVisualize,
            tableMetadata,
            24,
            true,
            chartWidth,
            chartHeight,
            true,
            chart.qcLimitsMode || false,
            undefined,
            undefined,
            originalTable,
          );

          // Clear the container before rendering new chart to prevent overlapping
          // IMPORTANT: Try to finalize old Vega view if it exists
          if (vegaViewRef.current) {
            try {
              vegaViewRef.current.finalize?.();
              vegaViewRef.current = null;
            } catch (e) {
              console.warn(`[VegaRenderer] Error finalizing previous view:`, e);
            }
          }

          const container = containerRef.current;
          if (container) {
            container.innerHTML = "";
          }

          // Helper function to try embedding with retries
          const tryEmbed = (retryCount = 0) => {
            requestAnimationFrame(() => {
              if (!containerRef.current) {
                // Fallback: try to get container by ID from DOM
                const fallbackContainer = document.getElementById(
                  elementId,
                ) as HTMLDivElement;
                if (fallbackContainer) {
                  performEmbed(fallbackContainer, retryCount);
                } else if (retryCount < 3) {
                  // Retry up to 3 times
                  tryEmbed(retryCount + 1);
                }
                return;
              }

              performEmbed(containerRef.current, retryCount);
            });
          };

          const performEmbed = (
            container: HTMLDivElement,
            retryCount: number,
          ) => {
            embed(
              container as any,
              { ...assembledChart },
              { actions: true, renderer: "svg" },
            )
              .then(function (result) {
                // Store the Vega view for later finalization
                vegaViewRef.current = result.view;

                if (result.view.container()?.getElementsByTagName("svg")) {
                  let comp = result.view
                    .container()
                    ?.getElementsByTagName("svg")[0];
                  if (comp) {
                    const { width, height } = comp.getBoundingClientRect();
                    comp?.setAttribute(
                      "style",
                      `width: ${width * scaleFactor}px; height: ${
                        height * scaleFactor
                      }px;`,
                    );
                  }
                }

                if (result.view.container()?.getElementsByTagName("canvas")) {
                  let comp = result.view
                    .container()
                    ?.getElementsByTagName("canvas")[0];
                  if (comp && scaleFactor != 1) {
                    const { width, height } = comp.getBoundingClientRect();
                    comp?.setAttribute(
                      "style",
                      `width: ${width * scaleFactor}px; height: ${
                        height * scaleFactor
                      }px;`,
                    );
                  }
                }

                // ✅ Chart is now visible, mark as done rendering
                setIsChartRendering(false);

                // ⏳ Defer preview caching to next event loop (non-blocking)
                setTimeout(() => {
                  try {
                    const container = result.view.container();
                    if (!container) return;

                    // Get the canvas element
                    const canvasElement =
                      container.getElementsByTagName("canvas")[0];
                    if (!canvasElement) return;

                    // Convert canvas to dataUrl (base64 string) - this persists and never expires
                    const dataUrl = canvasElement.toDataURL("image/png");
                    const { width, height } =
                      canvasElement.getBoundingClientRect();

                    // Cache the preview image (as dataUrl) in Redux
                    dispatch(
                      dfActions.updateChartPreviewImage({
                        chartId: chart.id,
                        url: dataUrl,
                        width: Math.round(width),
                        height: Math.round(height),
                      }),
                    );
                  } catch (error) {
                    console.warn(
                      `Failed to cache preview for chart ${chart.id}:`,
                      error,
                    );
                  }
                }, 0); // Defer to next event loop
              })
              .catch((error) => {
                setIsChartRendering(false);
                //console.error('Chart rendering error:', error);
              });
          };

          // Start embedding with retry logic
          tryEmbed();
        } catch (error) {
          setIsChartRendering(false);
          console.error("Failed to assemble chart:", error);
        }
      })();

      // Cleanup: finalize Vega view when component unmounts or chart changes
      return () => {
        if (vegaViewRef.current) {
          try {
            vegaViewRef.current.finalize?.();
            vegaViewRef.current = null;
          } catch (e) {
            console.warn(`[VegaRenderer] Error finalizing on unmount:`, e);
          }
        }
      };
    }, [
      chart.id,
      chart.chartType,
      chart.encodingMap,
      chart.qcLimitsMode,
      conceptShelfItems,
      visTableRows,
      tableMetadata,
      chartWidth,
      chartHeight,
      scaleFactor,
      chartUnavailable,
      dispatch,
    ]);

    if (chart.chartType === "Auto") {
      return (
        <Box
          sx={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            margin: "auto",
            color: "darkgray",
          }}
        >
          <InsightsIcon fontSize="large" />
        </Box>
      );
    }

    if (chart.chartType === "Table") {
      return visTableRows.length > 0 ? (
        renderTableChart(chart, conceptShelfItems, visTableRows)
      ) : (
        <Box
          sx={{
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <InsightsIcon fontSize="large" />
        </Box>
      );
    }

    const chartTemplate = getChartTemplate(chart.chartType);
    if (
      !checkChartAvailabilityOnPreparedData(
        chart,
        conceptShelfItems,
        visTableRows,
      )
    ) {
      return (
        <Box
          sx={{
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {generateChartSkeleton(chartTemplate?.icon, 48, 48)}
        </Box>
      );
    }

    // 🚀 Show skeleton placeholder immediately while async rendering happens
    return (
      <>
        {isChartRendering && (
          <Box
            sx={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "absolute",
              width: "100%",
              backgroundColor: "rgba(255, 255, 255, 0.7)",
              zIndex: 0,
            }}
          >
            {generateChartSkeleton(chartTemplate?.icon, 48, 48)}
          </Box>
        )}
        <Box
          ref={containerRef}
          id={elementId}
          sx={{ mx: 2, position: "relative", zIndex: 1 }}
        ></Box>
      </>
    );
  },
);
VegaChartRenderer.displayName = "VegaChartRenderer";

export const ChartEditorFC: FC<{}> = function ChartEditorFC({}) {
  const config = useSelector(dfSelectors.getConfig);
  const componentRef = useRef<HTMLHeadingElement>(null);

  // Add ref for the container box that holds all exploration components
  const explanationComponentsRef = useRef<HTMLDivElement>(null);

  let tables = useSelector(dfSelectors.getTables);

  let charts = useSelector(dfSelectors.getAllCharts);
  let focusedChartId = useSelector(
    (state: DataFormulatorState) => state.focusedChartId,
  );
  let chartSynthesisInProgress = useSelector(
    dfSelectors.getChartSynthesisInProgress,
  );

  let synthesisRunning = focusedChartId
    ? chartSynthesisInProgress.includes(focusedChartId)
    : false;
  let handleDeleteChart = () => {
    focusedChartId && dispatch(dfActions.deleteChartById(focusedChartId));
  };

  let focusedChart = charts.find((c) => c.id == focusedChartId) as Chart;
  let trigger =
    focusedChart.source == "trigger"
      ? tables.find((t) => t.derive?.trigger?.chart?.id == focusedChartId)
          ?.derive?.trigger
      : undefined;

  const dispatch = useDispatch();
  const conceptShelfItems = useSelector(
    (state: DataFormulatorState) => state.conceptShelfItems,
  );
  const dataLoaderConnectParams = useSelector(
    (state: DataFormulatorState) => state.dataLoaderConnectParams,
  );

  // Get current table early so it's available for all hooks
  let table = getDataTable(focusedChart, tables, charts, conceptShelfItems);

  const [codeViewOpen, setCodeViewOpen] = useState<boolean>(false);
  const [codeExplViewOpen, setCodeExplViewOpen] = useState<boolean>(false);
  const [conceptExplanationsOpen, setConceptExplanationsOpen] =
    useState<boolean>(false);

  // Add new state for the explanation mode
  const [explanationMode, setExplanationMode] = useState<
    "none" | "code" | "explanation" | "concepts"
  >("none");

  const [chatDialogOpen, setChatDialogOpen] = useState<boolean>(false);
  const [localScaleFactor, setLocalScaleFactor] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Sync isFullscreen state with the browser Fullscreen API
  // (handles ESC / F11 exit from outside React)
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleBrowserFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {
        // Fallback: just toggle the dialog if browser blocks fullscreen
        setIsFullscreen((prev) => !prev);
      });
    } else {
      document.exitFullscreen();
    }
  };

  const exitBrowserFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      setIsFullscreen(false);
    }
  };
  const [qcRefreshInterval, setQcRefreshInterval] = useState<number>(900);
  const [qcCountdown, setQcCountdown] = useState<number>(900);
  const [qcDaysRange, setQcDaysRange] = useState<number>(7);
  const chartWidth =
    focusedChart?.chartWidth || config.defaultChartWidth || 800;
  const chartHeight =
    focusedChart?.chartHeight || config.defaultChartHeight || 450;

  // Track previous chart ID to disable Data Live of the OLD chart when switching
  const prevFocusedChartIdRef = useRef<string | undefined>(undefined);

  // Reset local UI state when focused chart changes
  useEffect(() => {
    setLocalScaleFactor(1);
    if (document.fullscreenElement) {
      document.exitFullscreen();
    }
    setIsFullscreen(false);
    setCodeViewOpen(false);
    setCodeExplViewOpen(false);
    setConceptExplanationsOpen(false);
    setExplanationMode("none");
    setChatDialogOpen(false);
    // NOTE: Sample range reset moved to useLayoutEffect below to run synchronously
    // before other effects, ensuring closure values are fresh in fetchDisplayRows

    // Auto-disable Data Live of the PREVIOUS chart (not the current one!)
    // This prevents cross-chart contamination when switching charts
    const previousChartId = prevFocusedChartIdRef.current;
    if (previousChartId && charts) {
      const previousChart = charts.find((c) => c.id === previousChartId);
      if (previousChart?.qcLive) {
        dispatch(
          dfActions.updateChartQcLive({
            chartId: previousChartId,
            qcLive: false,
          }),
        );
      }

      // Clear DOM container of the previous chart to prevent visualization overlay
      const previousContainer = document.getElementById(
        `focused-chart-element-${previousChartId}`,
      );
      if (previousContainer) {
        previousContainer.innerHTML = "";
      }
    }

    // IMPORTANT: Clear DOM containers of ALL OTHER charts to prevent overlay
    // This ensures no lingering Vega visualization from any previously viewed chart
    if (charts) {
      charts.forEach((chart) => {
        if (chart.id !== focusedChartId) {
          const otherContainer = document.getElementById(
            `focused-chart-element-${chart.id}`,
          );
          if (otherContainer && otherContainer.innerHTML.length > 0) {
            otherContainer.innerHTML = "";
          }
        }
      });
    }

    // Cancel any pending fetch requests from the previous chart
    // This prevents stale responses from updating the new chart's state
    currentRequestRef.current = `cancelled-${focusedChartId}`;

    // Clear the live chart tracking from previous chart
    liveChartIdRef.current = undefined;
    liveTableNameRef.current = undefined;

    // Reset prevQcLiveRef so the qcLive effect always gets a clean slate for the
    // new chart. We deliberately do NOT dispatch qcLive=false here: doing so creates
    // a Redux state change that re-triggers the qcLive effect and produces a spurious
    // ON→OFF cycle that overwrites data.  Instead the qcLive effect itself guards
    // against stale state by comparing chart IDs (see prevQcLiveChartIdRef below).
    prevQcLiveRef.current = false;
    // Update ref to track current chart as "previous" for next switch
    prevFocusedChartIdRef.current = focusedChartId;
  }, [focusedChartId, dispatch]);

  // Data Live: keep a stable ref to fetchDisplayRows to avoid stale closure in setInterval
  const fetchDisplayRowsRef = useRef<
    (
      range?: [number, number],
      totalRowsOverride?: number,
      isLive?: boolean,
    ) => void
  >(() => {});
  const tableRef = useRef<DictTable | null>(null);
  // Keep a stable ref to the full tables list to avoid stale closures in Data Live callbacks
  const tablesRef = useRef<typeof tables>(tables);
  // Keep a stable ref to the live table name (_live) returned from backend
  // This ensures fetchDisplayRows fetches from the correct table that backend re-ingested
  const liveTableNameRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    fetchDisplayRowsRef.current = fetchDisplayRows;
  });

  // Resolve QC params for a specific table and avoid cross-chart contamination.
  const resolveQcParamsForTable = (
    targetTable: DictTable | undefined,
  ): Record<string, string> => {
    const globalQcParams = dataLoaderConnectParams["QC_Data"] ?? {};
    if (!targetTable) return { ...globalQcParams };

    const directLoaderParams = targetTable.virtual?.loaderParams;
    if (directLoaderParams?.["std_param_name"]) {
      return { ...globalQcParams, ...directLoaderParams };
    }

    const inferredStdParam =
      targetTable.rows?.find(
        (r: any) =>
          typeof r?.QCSTDPARAMNAME === "string" &&
          r.QCSTDPARAMNAME.trim().length > 0,
      )?.QCSTDPARAMNAME ??
      targetTable.rows?.find(
        (r: any) =>
          typeof r?.STDPARAMREPORTNAME === "string" &&
          r.STDPARAMREPORTNAME.trim().length > 0,
      )?.STDPARAMREPORTNAME;

    if (typeof inferredStdParam === "string" && inferredStdParam.trim()) {
      return {
        ...globalQcParams,
        ...(directLoaderParams ?? {}),
        std_param_name: inferredStdParam.trim(),
      };
    }

    return { ...globalQcParams, ...(directLoaderParams ?? {}) };
  };

  // QC Live: ref so countdown timer always calls the latest handleQcRefreshNow
  const doQcRefreshRef = useRef<() => Promise<void>>(async () => {});
  // Flag to trigger an immediate refresh once the ref is synced to the new handleQcRefreshNow
  const triggerImmediateRef = useRef<boolean>(false);
  // Track previous qcLimitsMode to detect when it's turned off → restore original data
  const prevQcLiveRef = useRef<boolean>(false);
  // Track which chart currently has Data Live active to prevent cross-chart updates
  const liveChartIdRef = useRef<string | undefined>(undefined);
  // Tracks which chart the last qcLive state read belongs to.
  // When focusedChartId changes, we reset prevQcLiveRef in the chart-switch effect,
  // but the qcLive effect may still fire with stale prevQcLiveRef.  By storing the
  // chart ID we can detect a chart-switch mid-effect and skip ON/OFF logic.
  const prevQcLiveChartIdRef = useRef<string | undefined>(undefined);

  // QC Live: when turned OFF, re-ingest with original params to restore previous data
  useEffect(() => {
    const wasOn = prevQcLiveRef.current;
    const wasOnChartId = prevQcLiveChartIdRef.current;
    prevQcLiveRef.current = !!focusedChart.qcLive;
    prevQcLiveChartIdRef.current = focusedChartId as string;

    // If the chart just changed, skip ON/OFF logic entirely for this run.
    // prevQcLiveRef was reset to false by the chart-switch effect, so wasOn is
    // already correct for the NEW chart on the next effect run.
    if (wasOnChartId !== focusedChartId) {
      return;
    }

    // Turning ON Data Live: trigger immediate refresh with is_live=true
    if (!wasOn && focusedChart.qcLive) {
      // Trigger immediate refresh when Data Live is turned ON
      // Data will be loaded into separate _live tables by handleQcRefreshNow
      triggerImmediateRef.current = true;
    }

    // Turning OFF Data Live: restore original data by re-ingesting without is_live flag
    if (wasOn && !focusedChart.qcLive) {
      liveTableNameRef.current = undefined;
      // Look up fresh table using focusedChart.tableRef to avoid stale closure
      const tableToRestore = focusedChart.tableRef
        ? tables.find((t) => t.id === focusedChart.tableRef)
        : undefined;

      // Restore original data by re-ingesting from base table (without _live suffix)
      if (tableToRestore?.derive?.code) {
        // Agent-derived table: restore source virtual tables (orig), then re-execute SQL
        const virtualSources = (tableToRestore.derive.source ?? [])
          .map((id) => tables.find((t) => t.id === id))
          .filter((t): t is (typeof tables)[0] => !!t?.virtual);

        if (virtualSources.length > 0) {
          Promise.all(
            virtualSources.map((srcTable) => {
              const qcParams = resolveQcParamsForTable(srcTable);
              // Re-ingest WITHOUT is_live to restore base data
              const built = buildQcDataQuery(qcParams, { is_live: false });
              if (!built) return Promise.resolve();
              return fetch(getUrls().DATA_LOADER_INGEST_DATA_FROM_QUERY, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  data_loader_type: "QC_Data",
                  data_loader_params: qcParams,
                  query: built.query,
                  name_as: built.name_as,
                }),
              })
                .then((r) => r.json())
                .catch((err) =>
                  console.warn("Data Live restore ingest error:", err),
                );
            }),
          )
            .then(() => {
              // Modify SQL to use original table names (remove _live suffix)
              let modifiedSqlCode = tableToRestore.derive!.code;
              const virtualSources = (tableToRestore.derive!.source ?? [])
                .map((id) => tables.find((t) => t.id === id))
                .filter((t): t is (typeof tables)[0] => !!t?.virtual);

              virtualSources.forEach((srcTable) => {
                const qcParams = resolveQcParamsForTable(srcTable);
                const stdParam = (qcParams["std_param_name"] ?? "")
                  .toString()
                  .trim();
                if (stdParam) {
                  const paramName = toSafeQcTableName(stdParam);
                  const liveTableName = `${paramName}_live`;
                  // Replace _live back to original parameter name
                  const pattern = new RegExp(`\\b${liveTableName}\\b`, "gi");
                  modifiedSqlCode = modifiedSqlCode.replace(pattern, paramName);
                  console.log(
                    `📝 SQL restore: "${liveTableName}" → "${paramName}"`,
                  );
                }
              });

              return fetch(getUrls().EXECUTE_SQL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  code: modifiedSqlCode,
                  name_as: tableToRestore.id,
                }),
              });
            })
            .then((r) => r.json())
            .then((d) => {
              if (d.status === "success" && d.rows?.length > 0) {
                dispatch(
                  dfActions.replaceTable({ ...tableToRestore!, rows: d.rows }),
                );
                const resetRange: [number, number] = [1, 1000];
                setCurrentSampleRange(resetRange);
                fetchDisplayRowsRef.current(resetRange, d.rows.length);
              }
            })
            .catch((err) => console.error("Data Live restore error:", err));
        }
      } else if (tableToRestore?.virtual) {
        // Direct virtual table: restore with base table (no is_live suffix)
        const qcParams = resolveQcParamsForTable(tableToRestore);
        const built = buildQcDataQuery(qcParams, { is_live: false });
        if (built) {
          fetch(getUrls().DATA_LOADER_INGEST_DATA_FROM_QUERY, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              data_loader_type: "QC_Data",
              data_loader_params: qcParams,
              query: built.query,
              name_as: built.name_as,
            }),
          })
            .then((r) => r.json())
            .then((data) => {
              if (data.status === "success") {
                const restoredCount: number = data.row_count ?? 100000;
                dispatch(
                  dfActions.updateTableVirtualRowCount({
                    tableId: tableToRestore.id,
                    rowCount: restoredCount,
                  }),
                );
                const resetRange: [number, number] = [1, 1000];
                setCurrentSampleRange(resetRange);
                fetchDisplayRowsRef.current(resetRange, restoredCount);
              }
            })
            .catch((err) => console.error("Data Live restore error:", err));
        }
      }
    }
  }, [focusedChart.qcLive, focusedChartId, dataLoaderConnectParams, tables]);

  // Data Live: countdown timer and auto-refresh
  useEffect(() => {
    if (!focusedChart.qcLive) {
      // Data Live disabled for this chart
      if (liveChartIdRef.current === focusedChartId) {
        liveChartIdRef.current = undefined;
      }
      return;
    }

    // Data Live enabled - mark this chart as active
    liveChartIdRef.current = focusedChartId;

    setQcCountdown(qcRefreshInterval);
    // Signal that an immediate refresh should fire once doQcRefreshRef is updated below
    triggerImmediateRef.current = true;

    // Capture the current chart ID at the time timer starts
    // This prevents old timers from executing callbacks meant for new charts
    const timerChartId = focusedChartId;

    const timer = setInterval(() => {
      setQcCountdown((prev) => {
        if (prev <= 1) {
          // Only execute refresh if still on the same chart
          // This prevents Chart A's timer from executing Chart B's callback
          if (
            focusedChartId === timerChartId &&
            liveChartIdRef.current === timerChartId
          ) {
            doQcRefreshRef.current();
          }
          return qcRefreshInterval;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      clearInterval(timer);
      // Clean up the ref when timer clears
      if (liveChartIdRef.current === focusedChartId) {
        liveChartIdRef.current = undefined;
      }
    };
  }, [focusedChartId, focusedChart.qcLive, qcRefreshInterval]);

  const handleQcRefreshNow = useCallback(async () => {
    // Verify this chart still has Data Live active
    if (liveChartIdRef.current !== focusedChartId) {
      console.warn("🔴 Chart changed, skipping refresh");
      return;
    }

    // Capture the chart ID at the time of refresh to prevent cross-chart data updates
    const refreshChartId = focusedChartId;

    // CRITICAL FIX: Always look up table FRESH by tableRef ID instead of using captured `table` variable
    // This avoids closure stale issues when switching between 2+ charts with different tables.
    // The captured `table` variable might belong to the PREVIOUS chart even though new dependencies caused callback recreation.
    const getCurrentTable = () => {
      // Use focusedChart.tableRef to find the CURRENT table for this chart
      if (!focusedChart.tableRef) return undefined;
      return tables.find((t) => t.id === focusedChart.tableRef);
    };

    const currentTable = getCurrentTable();
    // Safety check: only refresh if table is available
    if (!currentTable) {
      console.warn("🔴 Table not available for refresh:", {
        chartId: focusedChartId,
        tableRef: focusedChart.tableRef,
      });
      return;
    }

    const today = new Date();
    const fromDate = new Date(today);
    fromDate.setDate(today.getDate() - qcDaysRange);
    const fmt = (d: Date) => d.toISOString().split("T")[0]; // YYYY-MM-DD
    const fromCompact = fmt(fromDate).replace(/-/g, "");
    const toCompact = fmt(today).replace(/-/g, "");

    console.log("🟢 Data Live Refresh START:", {
      chartId: focusedChartId,
      tableName: currentTable.id,
      tableDisplayId: currentTable.displayId,
      hasLoaderParams: !!currentTable.virtual?.loaderParams,
      stdParamFromTable: currentTable.virtual?.loaderParams?.["std_param_name"],
      qcDaysRange,
      dateRange: `${fmt(fromDate)} to ${fmt(today)}`,
      isDerived: !!currentTable?.derive?.code,
      isVirtual: !!currentTable?.virtual,
      tableRefLookup: `Found by focusedChart.tableRef: ${focusedChart.tableRef}`,
    });

    if (currentTable?.derive?.code && focusedChart.qcLive) {
      // Agent-derived table: re-ingest source virtual tables then re-execute the SQL
      const virtualSources = (currentTable.derive.source ?? [])
        .map((id) => tables.find((t) => t.id === id))
        .filter((t): t is (typeof tables)[0] => !!t?.virtual);

      try {
        // 1. Re-ingest all virtual source tables with rolling date window
        //    Use virtual.tableId as name_as to match the actual DuckDB table name
        await Promise.all(
          virtualSources.map((srcTable) => {
            // Use per-table loaderParams if available, fall back to global QC_Data params
            const qcParams = resolveQcParamsForTable(srcTable);
            const built = buildQcDataQuery(qcParams, {
              from_date: fmt(fromDate),
              to_date: fmt(today),
              is_live: true,
            });
            if (!built) return Promise.resolve();
            console.log(
              "🔵 Re-ingesting virtual source:",
              srcTable.id,
              "with date range",
              fmt(fromDate),
              "to",
              fmt(today),
              "| Query name_as:",
              built.name_as,
            );
            // Use table.id and chart ID as suffix to avoid conflicts when multiple charts use same parameter or same table
            const requestBody = {
              data_loader_type: "QC_Data",
              data_loader_params: qcParams,
              query: built.query,
              name_as: built.name_as,
            };
            console.log(
              "🔵 Sending to backend | name_as:",
              built.name_as,
              "| std_param:",
              qcParams["std_param_name"],
            );
            return fetch(getUrls().DATA_LOADER_INGEST_DATA_FROM_QUERY, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(requestBody),
            })
              .then((r) => r.json())
              .then((d) => {
                console.log(
                  "🔵 Re-ingest response:",
                  srcTable.id,
                  "| name_as:",
                  built.name_as,
                  "| status:",
                  d.status,
                  "| row_count:",
                  d.row_count,
                );
                if (d.status === "success") {
                  console.log(
                    "✅ Re-ingest success:",
                    srcTable.id,
                    "rowCount:",
                    d.row_count,
                  );
                  dispatch(
                    dfActions.updateTableVirtualRowCount({
                      tableId: srcTable.id,
                      rowCount: d.row_count ?? 100000,
                    }),
                  );
                }
              })
              .catch((err) =>
                console.warn("Data Live source re-ingest error:", err),
              );
          }),
        );

        // 2. Re-execute the derived SQL and get the fresh rows back
        // IMPORTANT: Must replace source table names with their _live versions
        // so SQL reads from the newly re-ingested live data, not the original stale data
        let modifiedSqlCode = currentTable.derive.code;

        // Replace source table references with _live versions
        virtualSources.forEach((srcTable) => {
          const qcParams = resolveQcParamsForTable(srcTable);
          const stdParam = (qcParams["std_param_name"] ?? "").toString().trim();
          if (stdParam) {
            const paramName = toSafeQcTableName(stdParam);
            const liveTableName = `${paramName}_live`;
            const escapeRegExp = (text: string) =>
              text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            // Replace source table name with _live version in SQL
            // Replace both std parameter name and source table id, since agent SQL
            // may reference either one (e.g. FROM EP_CHAMFER_ANGLE_OUT).
            const stdPattern = new RegExp(
              `\\b${escapeRegExp(stdParam)}\\b`,
              "gi",
            );
            const tableIdPattern = new RegExp(
              `\\b${escapeRegExp(srcTable.id)}\\b`,
              "gi",
            );
            modifiedSqlCode = modifiedSqlCode
              .replace(stdPattern, liveTableName)
              .replace(tableIdPattern, liveTableName);
            console.log(
              `📝 SQL replace: "${stdParam}"/"${srcTable.id}" → "${liveTableName}"`,
            );
          }
        });

        // For agent-derived Data Live, materialize a dedicated derived live table.
        // Also constrain by QCDATE window to guarantee fresh data by selected range.
        const filteredDerivedSqlCode = /\bQCDATE\b/i.test(modifiedSqlCode)
          ? `SELECT * FROM (${modifiedSqlCode}) AS __df_live_base WHERE QCDATE >= '${fromCompact}' AND QCDATE <= '${toCompact}'`
          : modifiedSqlCode;
        const derivedDuckDbName = `${currentTable.id}_live`;
        const sqlResp = await fetch(getUrls().EXECUTE_SQL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: filteredDerivedSqlCode,
            name_as: derivedDuckDbName,
          }),
        });
        let sqlData: any = {};
        try {
          sqlData = await sqlResp.json();
        } catch {
          sqlData = { status: "error", message: `HTTP ${sqlResp.status}` };
        }
        if (sqlData.status !== "success") {
          console.warn(
            "Data Live SQL re-execute failed:",
            sqlData.message ?? sqlData.error,
          );
        } else {
          // 3. Only update if still on the same chart (prevent cross-chart contamination)
          if (focusedChartId === refreshChartId) {
            // For agent-derived tables, sampling must target the derived table itself.
            liveTableNameRef.current = derivedDuckDbName;
            // Update Redux with the fresh rows so chart encodings stay correct
            if (sqlData.rows && sqlData.rows.length > 0) {
              dispatch(
                dfActions.replaceTable({
                  ...currentTable,
                  rows: sqlData.rows,
                }),
              );
            }
            // 4. Refresh visTableRows from DuckDB (which now has the fresh TABLE data)
            setCurrentSampleRange(undefined);
            console.log(
              "🟡 Calling fetchDisplayRows for derived table with",
              sqlData.rows?.length ?? 100000,
              "rows",
            );
            fetchDisplayRowsRef.current(
              [0, sqlData.rows?.length ?? 100000],
              sqlData.rows?.length ?? 100000,
              true, // isLive=true, fetch from _live table
            );
            setQcCountdown(qcRefreshInterval);
          }
          return;
        }
      } catch (err) {
        console.error("Data Live derived table refresh error:", err);
      }
    } else if (currentTable?.virtual && focusedChart.qcLive) {
      // Direct virtual Data table: re-ingest with a rolling date window
      // Use per-table loaderParams if available, fall back to global QC_Data params
      const qcParams = resolveQcParamsForTable(currentTable);

      // VALIDATION: Ensure we're using the correct table's parameters
      const expectedTableId = currentTable.id;
      const expectedStdParam = qcParams["std_param_name"];
      console.log("🟡 Direct virtual table refresh validation:", {
        currentTableId: expectedTableId,
        tableRefFromChart: focusedChart.tableRef,
        stdParam: expectedStdParam,
        hasValidParams: !!expectedStdParam,
        paramsSourceTable: qcParams["table_name"] || "N/A",
      });

      const built = buildQcDataQuery(qcParams, {
        from_date: fmt(fromDate),
        to_date: fmt(today),
        is_live: true,
      });
      if (built) {
        // Pin the exact _live table name returned by query builder for this chart.
        liveTableNameRef.current = built.name_as;
        console.log(
          "🟢 Direct virtual table re-ingest:",
          currentTable.id,
          "| name_as:",
          built.name_as,
          "| std_param:",
          qcParams["std_param_name"],
          "| dateRange:",
          `${fmt(fromDate)} to ${fmt(today)}`,
        );
        try {
          const resp = await fetch(
            getUrls().DATA_LOADER_INGEST_DATA_FROM_QUERY,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                data_loader_type: "QC_Data",
                data_loader_params: qcParams,
                query: built.query,
                name_as: built.name_as,
              }),
            },
          );
          let data: any = {};
          try {
            data = await resp.json();
          } catch {
            data = { status: "error", message: `HTTP ${resp.status}` };
          }
          console.log(
            "🟢 Direct virtual response:",
            currentTable.id,
            "| name_as:",
            built.name_as,
            "| status:",
            data.status,
            "| row_count:",
            data.row_count,
          );
          if (data.status !== "success") {
            console.warn(
              "Data Live re-ingest failed:",
              data.message ?? data.error,
            );
          } else {
            // Only update if still on the same chart (prevent cross-chart contamination)
            if (focusedChartId === refreshChartId) {
              const newRowCount: number = data.row_count ?? 100000;
              console.log(
                "🟡 Direct virtual table refresh:",
                currentTable.id,
                "newRowCount:",
                newRowCount,
              );
              dispatch(
                dfActions.updateTableVirtualRowCount({
                  tableId: currentTable.id,
                  rowCount: newRowCount,
                }),
              );
              setCurrentSampleRange(undefined);
              console.log(
                "🟡 Calling fetchDisplayRows for virtual table with range [0,",
                newRowCount,
                "]",
              );
              fetchDisplayRowsRef.current([0, newRowCount], newRowCount, true); // isLive=true
              setQcCountdown(qcRefreshInterval);
            }
            return;
          }
        } catch (err) {
          console.error("Data Live re-ingest error:", err);
        }
      }
    }

    // Final fallback: only if still on same chart
    if (focusedChartId === refreshChartId) {
      fetchDisplayRowsRef.current();
      setQcCountdown(qcRefreshInterval);
    }
  }, [
    focusedChartId,
    focusedChart.qcLive,
    dataLoaderConnectParams,
    qcRefreshInterval,
    qcDaysRange,
    table,
    tables,
  ]);

  // Keep doQcRefreshRef in sync so the countdown timer always sees the latest version
  // Also fires the immediate refresh when Data Live is first activated
  useEffect(() => {
    doQcRefreshRef.current = handleQcRefreshNow;
    // Mark this chart as having active Data Live
    if (focusedChart.qcLive) {
      liveChartIdRef.current = focusedChartId;
    }
    if (triggerImmediateRef.current) {
      triggerImmediateRef.current = false;
      handleQcRefreshNow();
    }
  }, [focusedChartId, handleQcRefreshNow]);

  // Combined useEffect to scroll to exploration components when any of them open
  useEffect(() => {
    if (
      (conceptExplanationsOpen || codeViewOpen || codeExplViewOpen) &&
      explanationComponentsRef.current
    ) {
      setTimeout(() => {
        explanationComponentsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 200); // Small delay to ensure the component is rendered
    }
  }, [conceptExplanationsOpen, codeViewOpen, codeExplViewOpen]);

  // Keep tableRef and tablesRef in sync for use inside Data Live callbacks (defined above)
  tableRef.current = table;
  tablesRef.current = tables;

  // Data Live button is only shown for tables loaded via the QC_Data data loader.
  // A table qualifies if:
  //   1. QC_Data connector is configured (has at least a host param), AND
  //   2. The table itself is virtual (loaded from a data loader), OR
  //      it is agent-derived and at least one of its source tables is virtual.
  const isQcTable = useMemo(() => {
    const qcParams = dataLoaderConnectParams["QC_Data"] ?? {};
    const qcConfigured = Object.keys(qcParams).length > 0;
    if (!qcConfigured) return false;
    if (table.virtual) return true;
    if (table.derive?.source?.length) {
      return table.derive.source.some(
        (srcId) => tables.find((t) => t.id === srcId)?.virtual != null,
      );
    }
    return false;
  }, [table, tables, dataLoaderConnectParams]);

  let visFieldIds = Object.keys(focusedChart.encodingMap)
    .filter(
      (key) =>
        focusedChart.encodingMap[key as keyof EncodingMap].fieldID != undefined,
    )
    .map((key) => focusedChart.encodingMap[key as keyof EncodingMap].fieldID);
  let visFields = conceptShelfItems.filter((f) => visFieldIds.includes(f.id));
  let dataFieldsAllAvailable = visFields.every((f) =>
    table.names.includes(f.name),
  );

  // Create a stable identifier for data requirements (fields + aggregations)
  const dataRequirements = useMemo(() => {
    let { aggregateFields, groupByFields } = extractFieldsFromEncodingMap(
      focusedChart.encodingMap,
      conceptShelfItems,
    );
    let sortedFields = [
      ...aggregateFields.map((f) => `${f[0]}_${f[1]}`),
      ...groupByFields,
    ].sort();

    return JSON.stringify({
      chartId: focusedChart.id,
      tableId: table.id,
      sortedFields,
    });
  }, [focusedChart.encodingMap, conceptShelfItems, focusedChart.id, table.id]);

  let setSystemMessage = (
    content: string,
    severity: "error" | "warning" | "info" | "success",
  ) => {
    dispatch(
      dfActions.addMessages({
        timestamp: Date.now(),
        component: "Chart Builder",
        type: severity,
        value: content,
      }),
    );
  };

  let createVisTableRowsLocal = (rows: any[]) => {
    if (visFields.length == 0) {
      return rows;
    }

    let filteredRows = rows.map((row) =>
      Object.fromEntries(
        visFields
          .filter((f) => table.names.includes(f.name))
          .map((f) => [f.name, row[f.name]]),
      ),
    );
    let visTable = prepVisTable(
      filteredRows,
      conceptShelfItems,
      focusedChart.encodingMap,
      focusedChart.chartType,
    );

    if (visTable.length > 5000) {
      let rowSample = _.sampleSize(visTable, 1000);
      visTable = rowSample;
    }

    visTable = structuredClone(visTable);

    return visTable;
  };

  const processedData = createVisTableRowsLocal(table.rows);

  const [visTableRows, setVisTableRows] = useState<any[]>(processedData);
  const [visTableTotalRowCount, setVisTableTotalRowCount] = useState<number>(
    table.virtual?.rowCount || table.rows.length,
  );
  const defaultRange = useMemo<[number, number]>(() => {
    // Use visTableTotalRowCount (updated from server) instead of Redux rowCount
    // Explicitly check for null/undefined to prioritize server value even if it's 0
    const totalRows =
      visTableTotalRowCount != null && visTableTotalRowCount > 0
        ? visTableTotalRowCount
        : table.virtual?.rowCount || table.rows.length;
    return [1, Math.min(1000, totalRows)];
  }, [visTableTotalRowCount, table.virtual?.rowCount, table.rows.length]);

  const [currentSampleRange, setCurrentSampleRange] = useState<
    [number, number] | undefined
  >(undefined);

  let { aggregateFields, groupByFields } = extractFieldsFromEncodingMap(
    focusedChart.encodingMap,
    conceptShelfItems,
  );
  let sortedVisDataFields = [
    ...aggregateFields.map((f) => `${f[0]}_${f[1]}`),
    ...groupByFields,
  ].sort();

  // Track which chart+table+requiredFields the current data belongs to (prevents showing stale data during transitions)
  const [dataVersion, setDataVersion] = useState<string>(
    `${focusedChart.id}-${table.id}-${sortedVisDataFields.join("_")}`,
  );
  const currentRequestRef = useRef<string>("");

  // Check if current data is stale (belongs to different chart/table)
  // Include focusedChartId in the comparison to ensure immediate invalidation on chart switch
  const expectedDataVersion = `${focusedChart.id}-${
    table.id
  }-${sortedVisDataFields.join("_")}`;
  const isDataStale = dataVersion !== expectedDataVersion || dataVersion === "";

  // Use empty data if stale to avoid showing incorrect data during transitions
  const activeVisTableRows = isDataStale ? [] : visTableRows;
  const activeVisTableTotalRowCount = isDataStale ? 0 : visTableTotalRowCount;
  // Track previous table to detect when table actually changes
  const prevTableIdRef = useRef<string>(table.id);

  // Reset visTableTotalRowCount when chart changes OR table changes
  // This prevents carrying over rowcount from previous chart when two charts share same table
  // CRITICAL: Must use focusedChartId to detect chart switches even when table.id is same
  useEffect(() => {
    setVisTableTotalRowCount(table.virtual?.rowCount || table.rows.length);
    // Also reset sample range for the new chart - always start with default
    setCurrentSampleRange(undefined);
  }, [table.id, focusedChartId]);

  // Reset dataVersion ONLY when TABLE actually changes, not every chart selection
  // This prevents race condition where fetch sets dataVersion then chart-switch resets it
  useEffect(() => {
    if (prevTableIdRef.current !== table.id) {
      setDataVersion(""); // Force stale until new fetch completes
      prevTableIdRef.current = table.id;
    }
  }, [table.id, focusedChartId]);

  // SYNCHRONOUSLY reset sample range when chart changes to ensure closure values
  // in fetchDisplayRows are fresh and don't use stale range from previous chart
  useLayoutEffect(() => {
    setCurrentSampleRange(undefined);
  }, [focusedChart.id]);

  async function fetchDisplayRows(
    range?: [number, number],
    totalRowsOverride?: number,
    isLive?: boolean,
    totalRowCount?: number,
  ) {
    // Use fresh table reference to avoid stale closure values when switching charts
    // tableRef.current is kept in sync and always points to the correct chart's table
    const currentTableRef = tableRef.current ?? table;

    // Use server-side totalRowCount (from visTableTotalRowCount) to prevent clamping to stale Redux value
    // Explicitly check for undefined/null (not just falsy) to allow 0 as valid value
    const totalRows =
      totalRowCount != null
        ? totalRowCount
        : totalRowsOverride ??
          (currentTableRef.virtual?.rowCount || currentTableRef.rows.length);
    const sliderMax = totalRows;
    const sliderMin = 1;

    const clampRange = (value: [number, number]): [number, number] => {
      const lower = Math.min(Math.max(value[0], sliderMin), sliderMax);
      const upper = Math.min(Math.max(value[1], sliderMin), sliderMax);
      return [Math.min(lower, upper), Math.max(lower, upper)];
    };

    let normalizedRange: [number, number];
    if (range) {
      // User explicitly selected a range via SampleSizeEditor or Resample button
      normalizedRange = clampRange(range);
    } else {
      // No explicit range passed - use default [1, 1000]
      // IMPORTANT: Don't read currentSampleRange from closure - it's stale after chart switch!
      // When called from fetch effects, this ensures we always get the default for a new chart
      normalizedRange = [1, Math.min(1000, sliderMax)];
    }

    const [rangeMin, rangeMax] = normalizedRange;
    const rangeSize = Math.max(rangeMax - rangeMin + 1, 1);
    const sampleSize = rangeSize;

    // NOTE: Don't set currentSampleRange yet - wait for server response so we use actual total_row_count
    // This is set inside the response handler after data.total_row_count is known
    if (currentTableRef.virtual) {
      // Generate unique request ID to track this specific request
      const requestId = `${focusedChart.id}-${
        currentTableRef.id
      }-${Date.now()}`;
      currentRequestRef.current = requestId;
      console.log("🟠 NEW FETCH REQUEST:", {
        requestId,
        chartId: focusedChart.id,
        tableId: currentTableRef.id,
        isLive: isLive ?? focusedChart.qcLive,
      });

      // Track originalTable request separately
      const originalTableRequestId = `${
        currentTableRef.id
      }-${sampleSize}-${Date.now()}`;
      originalTableRequestRef.current = originalTableRequestId;

      let { aggregateFields, groupByFields } = extractFieldsFromEncodingMap(
        focusedChart.encodingMap,
        conceptShelfItems,
      );

      // For Resample: fetch with limit columns to update originalTable immediately
      const limitFields = ["TARGET", "LL", "UL", "ARLL", "ARUL"];
      const selectFieldsForOriginal = ["INDEX", ...limitFields];

      // Combine visualization fields + limit fields for complete data
      const allSelectFields = [
        ...groupByFields,
        ...limitFields,
        "INDEX", // Make sure INDEX is included
      ];
      const uniqueSelectFields = Array.from(new Set(allSelectFields));

      // When Data Live is enabled, fetch from _live table instead of original
      // IMPORTANT: Use currentTableRef (already defined at start of function) to get the CURRENT chart's table
      // This prevents stale table references when switching charts
      let tableNameToFetch = currentTableRef.id;
      const actualIsLive = isLive ?? focusedChart.qcLive;

      if (actualIsLive) {
        // Agent-derived tables (e.g., view_xxx) must be sampled from the derived
        // live table after SQL re-execution, not from source _live tables.
        if (currentTableRef.derive?.code) {
          tableNameToFetch = liveTableNameRef.current ?? currentTableRef.id;
        } else if (liveTableNameRef.current) {
          tableNameToFetch = liveTableNameRef.current;
        } else if (currentTableRef.virtual) {
          // Direct virtual table
          const qcParams = resolveQcParamsForTable(currentTableRef);
          const stdParam = (qcParams["std_param_name"] ?? "").toString().trim();

          if (stdParam) {
            const paramName = toSafeQcTableName(stdParam);
            tableNameToFetch = `${paramName}_live`;
          } else {
            // Fallback: if no stdParam, use table.id_live
            tableNameToFetch = `${currentTableRef.id}_live`;
          }
        } else if (currentTableRef.derive) {
          // Derived table - check if source tables are virtual
          const allTables = tables;
          const virtualSources = (currentTableRef.derive.source ?? [])
            .map((id) => allTables.find((t) => t.id === id))
            .filter((t): t is (typeof tables)[0] => !!t?.virtual);

          if (virtualSources.length > 0) {
            // Derived from virtual tables - SQL will output to table.id after executing
            // But fetchDisplayRows will use table (Redux), so for derived table
            // we use local rows from Redux after SQL execution
          }
        }
      }

      console.log("🟡 fetchDisplayRows:", {
        actualIsLive,
        currentTableRefId: currentTableRef.id,
        tableNameToFetch,
        range,
        sampleSize,
      });

      fetch(getUrls().SAMPLE_TABLE, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          table: tableNameToFetch,
          size: sampleSize,
          method: "head", //"random",
          select_fields: uniqueSelectFields, // Include limit columns here too!
          aggregate_fields_and_functions: aggregateFields,
          range_start: rangeMin,
          range_size: rangeSize,
        }),
      })
        .then((response) => {
          console.log("🟣 fetch.SAMPLE_TABLE response:", {
            tableNameToFetch,
            status: response.status,
            requestId,
            currentRequestId: currentRequestRef.current,
          });
          return response.json();
        })
        .then((data) => {
          console.log("🟣 fetch.SAMPLE_TABLE data:", {
            status: data.status,
            totalRowCount: data.total_row_count,
            rowsLength: data.rows?.length,
            requestId,
            currentRequestId: currentRequestRef.current,
            match: currentRequestRef.current === requestId,
          });
          // Only update if this is still the current request (not stale)
          if (currentRequestRef.current === requestId) {
            const versionId = `${focusedChart.id}-${
              table.id
            }-${sortedVisDataFields.join("_")}`;
            if (data.status == "success") {
              console.log("✅ Data Live response SUCCESS, updating UI...");
              // ✅ Extract originalTable from raw data BEFORE filtering for visualization
              const originalTableData = data.rows.map((row: any) =>
                Object.fromEntries(
                  selectFieldsForOriginal
                    .map((field) => [field, row[field]])
                    .filter(([_, value]) => value !== undefined),
                ),
              );

              // Preprocess data before saving (filters to only vis fields)
              const filteredRows = data.rows.map((row: any) =>
                Object.fromEntries(
                  visFields
                    .filter((f) => table.names.includes(f.name))
                    .map((f) => [f.name, row[f.name]]),
                ),
              );
              const preprocessedData = prepVisTable(
                filteredRows,
                conceptShelfItems,
                focusedChart.encodingMap,
                focusedChart.chartType,
              );

              // Set all state updates together
              setVisTableRows(preprocessedData);
              setVisTableTotalRowCount(data.total_row_count);
              setOriginalTable(originalTableData);

              setDataVersion(versionId);

              // NOW update currentSampleRange based on ACTUAL server data.total_row_count
              // NOT the stale totalRowCount parameter from beginning of function
              let actualRange: [number, number];
              if (range) {
                // User provided explicit range - use it
                actualRange = clampRange(range);
              } else {
                // No explicit range - use default [1, min(1000, actual_server_rowcount)]
                actualRange = [1, Math.min(1000, data.total_row_count)];
              }
              setCurrentSampleRange(actualRange);

              // ALWAYS update Redux table rowcount when fetching to keep it in sync
              // This ensures DataView/SelectableDataGrid shows correct rowcount
              // whether Data Live is on or off
              if (currentTableRef.virtual?.rowCount !== data.total_row_count) {
                dispatch(
                  dfActions.updateTableVirtualRowCount({
                    tableId: currentTableRef.id,
                    rowCount: data.total_row_count,
                  }),
                );
              }

              // Invalidate cached preview images in ReportView and update DataThread
              dispatch(
                dfActions.updateChartDataVersion({ chartId: focusedChart.id }),
              );
              dispatch(
                dfActions.updateChartSampleData({
                  chartId: focusedChart.id,
                  sampleData: preprocessedData,
                }),
              );
            } else {
              console.error("❌ Data Live response ERROR:", data.message);
              setVisTableRows([]);
              setVisTableTotalRowCount(0);
              setDataVersion(versionId);
              setSystemMessage(data.message, "error");
            }
          } else {
            console.warn("⚠️ STALE response ignored:", {
              expectedRequestId: currentRequestRef.current,
              receivedRequestId: requestId,
            });
            // This response is stale, ignore it
          }
        })
        .catch((error) => {
          // Only show error if this is still the current request
          console.error(
            "❌ fetch.SAMPLE_TABLE ERROR:",
            error,
            "for requestId:",
            requestId,
          );
          if (currentRequestRef.current === requestId) {
            console.error("Error sampling table:", error);
          }
        });
    } else {
      // Randomly sample sampleSize rows from currentTableRef.rows (local table, not virtual)
      // Note: rangeMin is 1-based, so subtract 1 to get 0-based array index
      const startIdx = Math.min(
        Math.max(rangeMin - 1, 0),
        currentTableRef.rows.length,
      );
      const endIdx = Math.min(
        startIdx + sampleSize,
        currentTableRef.rows.length,
      );
      const rowSample = currentTableRef.rows.slice(startIdx, endIdx);
      const clonedSample = structuredClone(rowSample);

      // Preprocess data before saving
      const filteredRows = clonedSample.map((row: any) =>
        Object.fromEntries(
          visFields
            .filter((f) => currentTableRef.names.includes(f.name))
            .map((f) => [f.name, row[f.name]]),
        ),
      );
      const preprocessedData = prepVisTable(
        filteredRows,
        conceptShelfItems,
        focusedChart.encodingMap,
        focusedChart.chartType,
      );
      setVisTableRows(preprocessedData);
      setDataVersion(
        `${focusedChart.id}-${currentTableRef.id}-${sortedVisDataFields.join(
          "_",
        )}`,
      );

      // ✅ Also set originalTable for local tables with limit columns
      // Extract the sampled rows with limit columns
      const limitFields = ["INDEX", "TARGET", "LL", "UL", "ARLL", "ARUL"];
      const originalTableData = rowSample.map((row: any) =>
        Object.fromEntries(
          limitFields
            .map((field) => [field, row[field]])
            .filter(([_, value]) => value !== undefined),
        ),
      );

      console.log(
        "✅ Setting originalTable for local table:",
        originalTableData.length,
        "rows",
      );
      setOriginalTable(originalTableData);

      // Invalidate cached preview images in ReportView and update DataThread
      dispatch(dfActions.updateChartDataVersion({ chartId: focusedChart.id }));
      dispatch(
        dfActions.updateChartSampleData({
          chartId: focusedChart.id,
          sampleData: preprocessedData,
        }),
      );
    }
  }

  useEffect(() => {
    // ALWAYS reset sample range when switching charts, even if fetch conditions fail
    // This ensures the sample range selector always shows 1-1000 for a new chart
    setCurrentSampleRange(undefined);

    if (table.virtual && visFields.length > 0 && dataFieldsAllAvailable) {
      // Pass explicit range [1, 1000] to always reset on chart switch
      // Pass qcLive state so correct table is fetched (_live or original)
      fetchDisplayRows([1, 1000], 1000, focusedChart.qcLive, undefined);
    }
  }, [
    table.id,
    visFields.length,
    dataFieldsAllAvailable,
    focusedChart.qcLive,
    focusedChart.id,
  ]);

  useEffect(() => {
    const versionId = `${focusedChart.id}-${
      table.id
    }-${sortedVisDataFields.join("_")}`;

    // ALWAYS reset sample range when switching charts
    // This ensures consistent reset even if initial fetch fails
    setCurrentSampleRange(undefined);

    if (visFields.length > 0 && dataFieldsAllAvailable) {
      // table changed, we need to update the rows to display
      if (table.virtual) {
        // virtual table, we need to sample the table (use explicit [1, 1000] on table switch)
        // Pass qcLive state so correct table is fetched (_live or original)
        fetchDisplayRows([1, 1000], 1000, focusedChart.qcLive, undefined);
      } else {
        // non-virtual table, update with processed data
        const newProcessedData = createVisTableRowsLocal(table.rows);
        setVisTableRows(newProcessedData);
        setVisTableTotalRowCount(table.rows.length);
        setDataVersion(versionId);
        // Invalidate cached preview images in ReportView and update DataThread
        dispatch(
          dfActions.updateChartDataVersion({ chartId: focusedChart.id }),
        );
        dispatch(
          dfActions.updateChartSampleData({
            chartId: focusedChart.id,
            sampleData: newProcessedData,
          }),
        );
      }
    } else {
      // If no fields available, show raw table rows
      setVisTableRows(table.rows);
      setVisTableTotalRowCount(table.virtual?.rowCount || table.rows.length);
      // Only stamp dataVersion when the encoding genuinely has NO field IDs.
      // If the encoding has fieldIDs but they're transiently unresolvable (e.g.,
      // conceptShelfItems still loading), skip the stamp so we don't overwrite a
      // valid dataVersion already set by a preceding fetch, which would cause a
      // stale-data flash cycle when the fields resolve on the next render.
      if (visFieldIds.length === 0) {
        setDataVersion(versionId);
        // Invalidate cached preview images in ReportView and update DataThread
        dispatch(
          dfActions.updateChartDataVersion({ chartId: focusedChart.id }),
        );
        dispatch(
          dfActions.updateChartSampleData({
            chartId: focusedChart.id,
            sampleData: table.rows,
          }),
        );
      }
    }
  }, [dataRequirements, focusedChart.qcLive, table.id, focusedChart.id]);

  let encodingShelfEmpty = useMemo(() => {
    return Object.keys(focusedChart.encodingMap).every(
      (key) =>
        focusedChart.encodingMap[key as keyof EncodingMap].fieldID ==
          undefined &&
        focusedChart.encodingMap[key as keyof EncodingMap].aggregate ==
          undefined,
    );
  }, [focusedChart.encodingMap]);

  // Calculate chart availability in the parent
  const chartUnavailable = useMemo(() => {
    if (
      focusedChart.chartType === "Auto" ||
      focusedChart.chartType === "Table"
    ) {
      return false;
    }

    // Check if fields exist in table and table has rows
    return !(dataFieldsAllAvailable && table.rows.length > 0);
  }, [focusedChart.chartType, dataFieldsAllAvailable, table.rows.length]);

  // Render fullscreen chart when dialog opens
  useEffect(() => {
    if (
      isFullscreen &&
      focusedChart.chartType !== "Auto" &&
      focusedChart.chartType !== "Table" &&
      !chartUnavailable &&
      activeVisTableRows.length > 0
    ) {
      const elementId = `fullscreen-chart-${focusedChart.id}`;

      // Use requestAnimationFrame twice to ensure DOM is fully painted
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const element = document.getElementById(elementId);

          if (!element) {
            console.warn(`Element with id ${elementId} not found`);
            return;
          }

          // Use 80% of viewport width and 68% of viewport height so the chart
          // always fits within the dialog without overflowing.
          const fsWidth = Math.round(window.innerWidth * 0.8);
          const fsHeight = Math.round(window.innerHeight * 0.68);
          (async () => {
            const originalTable = await getOriginalTableFromVirtualData(
              table,
              activeVisTableRows,
            );
            console.log(
              "Rendering fullscreen chart with table:",
              originalTable,
            );
            const assembledChart = assembleVegaChart(
              focusedChart.chartType,
              focusedChart.encodingMap,
              conceptShelfItems,
              activeVisTableRows,
              table.metadata,
              24,
              true,
              fsWidth,
              fsHeight,
              true,
              focusedChart.qcLimitsMode || false,
              undefined,
              undefined,
              originalTable,
            );

            // Clear container before rendering
            element.innerHTML = "";

            // Render using vega-embed
            embed(
              "#" + elementId,
              { ...assembledChart },
              {
                actions: {
                  export: true,
                  source: true,
                  editor: true,
                },
                renderer: "svg",
                downloadFileName: `chart-${focusedChart.id}`,
              },
            ).catch((error) => {
              console.warn("Fullscreen chart rendering error:", error);
            });
          })();
        });
      });
    }
  }, [
    isFullscreen,
    focusedChart.id,
    focusedChart.chartType,
    focusedChart.encodingMap,
    focusedChart.qcLimitsMode,
    conceptShelfItems,
    activeVisTableRows,
    table.metadata,
    chartUnavailable,
  ]);

  let resultTable = tables.find((t) => t.id == trigger?.resultTableId);

  let codeExpl = table.derive?.explanation?.code || "";

  let saveButton = (
    <Tooltip key="save-copy-tooltip" title="save a copy">
      <span>
        <IconButton
          color="primary"
          key="unsave-btn"
          size="small"
          sx={{ textTransform: "none" }}
          onClick={() => {
            if (!chartUnavailable) {
              dispatch(dfActions.saveUnsaveChart(focusedChart.id));
            }
          }}
        >
          {focusedChart.saved ? (
            <StarIcon sx={{ color: "gold" }} />
          ) : (
            <StarBorderIcon />
          )}
        </IconButton>
      </span>
    </Tooltip>
  );

  let duplicateButton = (
    <Tooltip key="duplicate-btn-tooltip" title="duplicate the chart">
      <span>
        <IconButton
          color="primary"
          key="duplicate-btn"
          size="small"
          sx={{ textTransform: "none" }}
          disabled={trigger != undefined}
          onClick={() => {
            dispatch(dfActions.duplicateChart(focusedChart.id));
          }}
        >
          <ContentCopyIcon />
        </IconButton>
      </span>
    </Tooltip>
  );

  let deleteButton = (
    <Tooltip title="delete" key="delete-btn-tooltip">
      <span>
        <IconButton
          color="warning"
          size="small"
          sx={{ textTransform: "none" }}
          disabled={trigger != undefined}
          onClick={() => {
            handleDeleteChart();
          }}
        >
          <DeleteIcon />
        </IconButton>
      </span>
    </Tooltip>
  );

  let transformCode = "";
  if (table.derive?.code) {
    transformCode = `${table.derive.code}`;
  }

  // Handle explanation mode changes
  const handleExplanationModeChange = (
    event: React.MouseEvent<HTMLElement>,
    newMode: "none" | "code" | "explanation" | "concepts",
  ) => {
    // If clicking the same mode that's already active, turn it off
    if (newMode === explanationMode) {
      setExplanationMode("none");
      setCodeViewOpen(false);
      setCodeExplViewOpen(false);
      setConceptExplanationsOpen(false);
    } else if (newMode !== null) {
      // Otherwise, switch to the new mode
      setExplanationMode(newMode);
      setCodeViewOpen(newMode === "code");
      setCodeExplViewOpen(newMode === "explanation");
      setConceptExplanationsOpen(newMode === "concepts");
    }
  };

  // Check if concepts are available
  const availableConcepts = extractConceptExplanations(table);
  const hasConcepts = availableConcepts.length > 0;

  let derivedTableItems =
    resultTable?.derive || table.derive
      ? [
          <Divider
            key="derived-divider-start"
            orientation="vertical"
            variant="middle"
            flexItem
            sx={{ mx: 1 }}
          />,
          <Box
            key="explanation-toggle-group"
            sx={{
              display: "flex",
              alignItems: "center",
              mx: 0.5,
              backgroundColor: "rgba(0, 0, 0, 0.02)",
              borderRadius: 1,
              padding: "2px",
              border: "1px solid rgba(0, 0, 0, 0.06)",
            }}
          >
            <ButtonGroup
              key="explanation-button-group"
              size="small"
              sx={{
                "& .MuiButton-root": {
                  textTransform: "none",
                  fontSize: "0.7rem",
                  fontWeight: 500,
                  border: "none",
                  borderRadius: "3px",
                  padding: "2px 6px",
                  minWidth: "auto",
                  color: "text.secondary",
                  "&:hover": {
                    backgroundColor: "rgba(25, 118, 210, 0.08)",
                  },
                },
              }}
            >
              <Button
                key="chat-dialog-btn"
                onClick={() => {
                  setChatDialogOpen(!chatDialogOpen);
                }}
                sx={{
                  backgroundColor: conceptExplanationsOpen
                    ? "rgba(25, 118, 210, 0.2)"
                    : "transparent",
                  color: conceptExplanationsOpen
                    ? "primary.main"
                    : "text.secondary",
                  fontWeight: conceptExplanationsOpen ? 600 : 500,
                  "&:hover": {
                    backgroundColor: conceptExplanationsOpen
                      ? "rgba(25, 118, 210, 0.25)"
                      : "rgba(25, 118, 210, 0.08)",
                  },
                }}
              >
                <QuestionAnswerIcon sx={{ fontSize: "14px", mr: 0.5 }} />
                chat
              </Button>
              <Button
                key="code-btn"
                onClick={() => {
                  if (codeViewOpen) {
                    setExplanationMode("none");
                    setCodeViewOpen(false);
                  } else {
                    setExplanationMode("code");
                    setCodeViewOpen(true);
                    setCodeExplViewOpen(false);
                    setConceptExplanationsOpen(false);
                  }
                }}
                sx={{
                  backgroundColor: codeViewOpen
                    ? "rgba(25, 118, 210, 0.2)"
                    : "transparent",
                  color: codeViewOpen ? "primary.main" : "text.secondary",
                  fontWeight: codeViewOpen ? 600 : 500,
                  "&:hover": {
                    backgroundColor: codeViewOpen
                      ? "rgba(25, 118, 210, 0.25)"
                      : "rgba(25, 118, 210, 0.08)",
                  },
                }}
              >
                <TerminalIcon sx={{ fontSize: "14px", mr: 0.5 }} />
                code
              </Button>
              {codeExpl != "" && (
                <Button
                  key="explanation-btn"
                  onClick={() => {
                    if (codeExplViewOpen) {
                      setExplanationMode("none");
                      setCodeExplViewOpen(false);
                    } else {
                      setExplanationMode("explanation");
                      setCodeExplViewOpen(true);
                      setCodeViewOpen(false);
                      setConceptExplanationsOpen(false);
                    }
                  }}
                  sx={{
                    backgroundColor: codeExplViewOpen
                      ? "rgba(25, 118, 210, 0.2)"
                      : "transparent",
                    color: codeExplViewOpen ? "primary.main" : "text.secondary",
                    fontWeight: codeExplViewOpen ? 600 : 500,
                    "&:hover": {
                      backgroundColor: codeExplViewOpen
                        ? "rgba(25, 118, 210, 0.25)"
                        : "rgba(25, 118, 210, 0.08)",
                    },
                  }}
                >
                  <TextSnippetIcon sx={{ fontSize: "14px", mr: 0.5 }} />
                  explain
                </Button>
              )}
              {hasConcepts && (
                <Button
                  key="concepts-btn"
                  onClick={() => {
                    if (conceptExplanationsOpen) {
                      setExplanationMode("none");
                      setConceptExplanationsOpen(false);
                    } else {
                      setExplanationMode("concepts");
                      setConceptExplanationsOpen(true);
                      setCodeViewOpen(false);
                      setCodeExplViewOpen(false);
                    }
                  }}
                  sx={{
                    backgroundColor: conceptExplanationsOpen
                      ? "rgba(25, 118, 210, 0.2)"
                      : "transparent",
                    color: conceptExplanationsOpen
                      ? "primary.main"
                      : "text.secondary",
                    fontWeight: conceptExplanationsOpen ? 600 : 500,
                    "&:hover": {
                      backgroundColor: conceptExplanationsOpen
                        ? "rgba(25, 118, 210, 0.25)"
                        : "rgba(25, 118, 210, 0.08)",
                    },
                  }}
                >
                  <InfoIcon sx={{ fontSize: "14px", mr: 0.5 }} />
                  concepts
                </Button>
              )}
            </ButtonGroup>
          </Box>,
          <ChatDialog
            key="chat-dialog-button"
            open={chatDialogOpen}
            handleCloseDialog={() => {
              setChatDialogOpen(false);
            }}
            code={transformCode}
            dialog={
              resultTable?.derive?.dialog || (table.derive?.dialog as any[])
            }
          />,
        ]
      : [];

  let chartActionButtons = [
    <Box
      key="data-source"
      fontSize="small"
      sx={{ margin: "auto", display: "flex", flexDirection: "row" }}
    >
      <Typography
        component="span"
        sx={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          whiteSpace: "nowrap",
        }}
        fontSize="inherit"
      >
        data:{" "}
        {table.virtual ? (
          <Tooltip
            key="virtual-table-tooltip"
            title="this table resides in the backend database, sample rows are used for visualization"
          >
            <CloudQueueIcon
              sx={{ fontSize: "12px", color: "text.secondary", mx: 0.5 }}
            />
          </Tooltip>
        ) : (
          ""
        )}{" "}
        {table.displayId || table.id}
      </Typography>
    </Box>,
    ...derivedTableItems,
    <Divider
      key="chart-actions-divider"
      orientation="vertical"
      variant="middle"
      flexItem
      sx={{ mx: 1 }}
    />,
    saveButton,
    duplicateButton,
    deleteButton,
  ];

  let chartMessage = "";
  if (focusedChart.chartType == "Table") {
    chartMessage = "Tell me what you want to visualize!";
  } else if (focusedChart.chartType == "Auto") {
    chartMessage = "Say something to get chart recommendations!";
  } else if (encodingShelfEmpty) {
    chartMessage =
      "Put data fields to chart builder or describe what you want!";
  } else if (chartUnavailable) {
    chartMessage = "Formulate data to create the visualization!";
  } else if (chartSynthesisInProgress.includes(focusedChart.id)) {
    chartMessage = "Synthesis in progress...";
  } else if (table.derive) {
    chartMessage = "AI generated results can be inaccurate, inspect it!";
  }

  let chartActionItems = isDataStale ? (
    []
  ) : (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, my: 1 }}>
      {(table.virtual || table.rows.length > 1000) &&
      !(chartUnavailable || encodingShelfEmpty) ? (
        <Box
          sx={{
            display: "flex",
            flexDirection: "row",
            margin: "auto",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 0.5,
            }}
          >
            <Typography
              component="span"
              fontSize="small"
              color="text.secondary"
              sx={{ textAlign: "center" }}
            >
              Range Visualizing
            </Typography>
            <SampleSizeEditor
              initialRange={currentSampleRange ?? defaultRange}
              totalSize={activeVisTableTotalRowCount}
              onSampleSizeChange={(newRange) => {
                fetchDisplayRows(
                  newRange,
                  undefined,
                  focusedChart.qcLive,
                  visTableTotalRowCount,
                );
              }}
            />
          </Box>
        </Box>
      ) : (
        ""
      )}
      <Typography
        component="span"
        fontSize="small"
        color="text.secondary"
        sx={{ textAlign: "center" }}
      >
        {chartMessage}
      </Typography>
    </Box>
  );

  let codeExplComp = (
    <MuiMarkdown
      overrides={{
        ...getOverrides(), // This will keep the other default overrides.
        code: {
          props: {
            style: {
              padding: "2px 4px",
              color: "darkblue",
            },
          },
        },
        p: {
          props: {
            style: {
              fontFamily: "Arial, Roboto, Helvetica Neue, sans-serif",
              fontWeight: 400,
              fontSize: 12,
              lineHeight: 2,
              margin: 0,
            },
          } as React.HTMLProps<HTMLParagraphElement>,
        },
        ol: {
          props: {
            style: {
              margin: 0,
            },
          } as React.HTMLProps<HTMLParagraphElement>,
        },
        li: {
          props: {
            style: {
              fontFamily: "Arial, Roboto, Helvetica Neue, sans-serif",
              fontWeight: 400,
              fontSize: 12,
              lineHeight: 2,
            },
          } as React.HTMLProps<HTMLParagraphElement>,
        },
      }}
    >
      {codeExpl}
    </MuiMarkdown>
  );

  let focusedComponent = [];

  let transformationIndicatorText = table.derive?.source
    ? `${table.derive.source
        .map((s) => tables.find((t) => t.id === s)?.displayId || s)
        .join(", ")} → ${table.displayId || table.id}`
    : "";
  // Initialize with the local table rows so the first render has a value.
  const [originalTable, setOriginalTable] = useState<any[] | undefined>(
    table?.rows ?? undefined,
  );
  // Track latest request to avoid using stale results
  const originalTableRequestRef = useRef<string>("");

  let focusedElement = (
    <Fade
      key={`fade-${focusedChart.id}-${dataVersion}-${
        focusedChart.chartType
      }-${JSON.stringify(focusedChart.encodingMap)}`}
      in={!isDataStale}
      timeout={600}
    >
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          justifyContent: "center",
          justifyItems: "center",
        }}
        className="chart-box"
      >
        <Box
          sx={{ m: "auto", minHeight: 240, maxWidth: "90%", overflow: "auto" }}
        >
          <VegaChartRenderer
            key={focusedChart.id}
            chart={focusedChart}
            conceptShelfItems={conceptShelfItems}
            visTableRows={activeVisTableRows}
            tableMetadata={table.metadata}
            chartWidth={chartWidth}
            chartHeight={chartHeight}
            scaleFactor={localScaleFactor}
            chartUnavailable={chartUnavailable}
            originalTable={originalTable}
          />
        </Box>
        {chartActionItems}
      </Box>
    </Fade>
  );

  focusedComponent = [
    <Box
      key="chart-focused-element"
      sx={{
        width: "100%",
        minHeight: "calc(100% - 40px)",
        margin: "auto",
        mt: 4,
        mb: 1,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {focusedElement}
      <Box ref={explanationComponentsRef} sx={{ width: "100%", mx: "auto" }}>
        <Collapse in={conceptExplanationsOpen}>
          <Box
            sx={{
              minWidth: 440,
              maxWidth: 800,
              padding: "0px 8px",
              position: "relative",
              margin: "8px auto",
            }}
          >
            <ConceptExplCards
              concepts={extractConceptExplanations(table)}
              title="Derived Concepts"
              maxCards={8}
            />
          </Box>
        </Collapse>
        <Collapse in={codeViewOpen}>
          <Box
            sx={{
              minWidth: 440,
              maxWidth: 960,
              padding: "0px 8px",
              position: "relative",
              margin: "8px auto",
            }}
          >
            <ButtonGroup sx={{ position: "absolute", right: 8, top: 1 }}>
              <IconButton
                onClick={() => {
                  setCodeViewOpen(false);
                  setExplanationMode("none");
                }}
                color="primary"
                aria-label="delete"
              >
                <CloseIcon />
              </IconButton>
            </ButtonGroup>
            {/* <Typography fontSize="small" sx={{color: 'gray'}}>{table.derive?.source} → {table.id}</Typography> */}
            <CodeExplanationCard
              title="Data transformation code"
              icon={<CodeIcon sx={{ fontSize: 16, color: "primary.main" }} />}
              transformationIndicatorText={transformationIndicatorText}
            >
              <Box
                sx={{
                  maxHeight: "400px",
                  overflow: "auto",
                  width: "100%",
                  p: 0.5,
                }}
              >
                <CodeBox
                  code={transformCode.trimStart()}
                  language={table.virtual ? "sql" : "python"}
                />
              </Box>
            </CodeExplanationCard>
          </Box>
        </Collapse>
        <Collapse in={codeExplViewOpen}>
          <Box
            sx={{
              minWidth: 440,
              maxWidth: 800,
              padding: "0px 8px",
              position: "relative",
              margin: "8px auto",
            }}
          >
            <ButtonGroup sx={{ position: "absolute", right: 8, top: 0 }}>
              <IconButton
                onClick={() => {
                  setCodeExplViewOpen(false);
                  setExplanationMode("none");
                }}
                color="primary"
                aria-label="delete"
              >
                <CloseIcon />
              </IconButton>
            </ButtonGroup>
            <CodeExplanationCard
              title="Data transformation explanation"
              icon={
                <TerminalIcon sx={{ fontSize: 16, color: "primary.main" }} />
              }
              transformationIndicatorText={transformationIndicatorText}
            >
              <Box
                sx={{
                  width: "fit-content",
                  display: "flex",
                  flex: 1,
                }}
              >
                {codeExplComp}
              </Box>
            </CodeExplanationCard>
          </Box>
        </Collapse>
      </Box>
      <Box
        key="chart-action-buttons"
        sx={{
          display: "flex",
          flexShrink: 0,
          flexDirection: "row",
          mx: "auto",
          py: 1,
        }}
      >
        {chartActionButtons}
      </Box>
    </Box>,
  ];

  let content = [
    <Box
      key="focused-box"
      className="vega-focused"
      sx={{
        display: "flex",
        overflow: "auto",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {focusedComponent}
    </Box>,
    <EncodingShelfThread key="encoding-shelf" chartId={focusedChart.id} />,
  ];

  let [scaleMin, scaleMax] = [0.2, 2.4];

  // Memoize chart resizer to avoid re-creating Material-UI components on every render
  let chartResizer = useMemo(
    () => (
      <Stack
        spacing={1}
        direction="row"
        sx={{
          margin: 1,
          width: "auto",
          position: "absolute",
          zIndex: 10,
          backgroundColor: "rgba(255, 255, 255, 0.9)",
          borderRadius: "4px",
          flexWrap: "nowrap",
        }}
        alignItems="center"
      >
        <Tooltip key="zoom-out-tooltip" title="zoom out">
          <span>
            <IconButton
              color="primary"
              size="small"
              disabled={localScaleFactor <= scaleMin}
              onClick={() => {
                setLocalScaleFactor((prev) => Math.max(scaleMin, prev - 0.1));
              }}
            >
              <ZoomOutIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Slider
          aria-label="chart-resize"
          size="small"
          defaultValue={1}
          step={0.1}
          min={scaleMin}
          max={scaleMax}
          value={localScaleFactor}
          onChange={(event: Event, newValue: number | number[]) => {
            setLocalScaleFactor(newValue as number);
          }}
          sx={{ width: 80, flexShrink: 0 }}
        />
        <Tooltip key="zoom-in-tooltip" title="zoom in">
          <span>
            <IconButton
              color="primary"
              size="small"
              disabled={localScaleFactor >= scaleMax}
              onClick={() => {
                setLocalScaleFactor((prev) => Math.min(scaleMax, prev + 0.1));
              }}
            >
              <ZoomInIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Divider
          orientation="vertical"
          variant="middle"
          flexItem
          sx={{ mx: 0.5 }}
        />
        <Tooltip key="fullscreen-tooltip" title="full screen">
          <span>
            <IconButton
              color="primary"
              size="small"
              onClick={toggleBrowserFullscreen}
            >
              {isFullscreen ? (
                <FullscreenExitIcon fontSize="small" />
              ) : (
                <FullscreenIcon fontSize="small" />
              )}
            </IconButton>
          </span>
        </Tooltip>
        {isQcTable && (
          <>
            <Divider
              orientation="vertical"
              variant="middle"
              flexItem
              sx={{ mx: 0.5 }}
            />
            <Tooltip
              key="data-live-tooltip"
              title="Toggle Data Live auto-refresh"
            >
              <span>
                <Button
                  size="small"
                  variant={focusedChart.qcLive ? "contained" : "outlined"}
                  color="warning"
                  sx={{
                    textTransform: "none",
                    fontSize: "13px",
                    fontWeight: 600,
                    minWidth: "auto",
                    px: 1,
                    py: 0.25,
                    lineHeight: 1.5,
                  }}
                  onClick={() =>
                    dispatch(
                      dfActions.updateChartQcLive({
                        chartId: focusedChart.id,
                        qcLive: !focusedChart.qcLive,
                      }),
                    )
                  }
                >
                  ⚡Data Live
                </Button>
              </span>
            </Tooltip>
            {focusedChart.qcLive && (
              <>
                <Divider
                  orientation="vertical"
                  variant="middle"
                  flexItem
                  sx={{ mx: 0.25 }}
                />
                <Typography
                  fontSize="11px"
                  color="text.secondary"
                  sx={{ whiteSpace: "nowrap" }}
                >
                  last
                </Typography>
                <TextField
                  select
                  size="small"
                  value={qcDaysRange}
                  onChange={(e) => setQcDaysRange(Number(e.target.value))}
                  sx={{
                    minWidth: 56,
                    "& .MuiInputBase-input": {
                      fontSize: "11px",
                      py: "2px",
                      px: "4px",
                    },
                    "& .MuiOutlinedInput-root": { height: 24 },
                  }}
                >
                  {[
                    { label: "1d", value: 1 },
                    { label: "3d", value: 3 },
                    { label: "7d", value: 7 },
                    { label: "15d", value: 15 },
                    { label: "30d", value: 30 },
                  ].map(({ label, value }) => (
                    <MenuItem
                      key={value}
                      value={value}
                      sx={{ fontSize: "12px" }}
                    >
                      {label}
                    </MenuItem>
                  ))}
                </TextField>
                <Divider
                  orientation="vertical"
                  variant="middle"
                  flexItem
                  sx={{ mx: 0.25 }}
                />
                <Typography
                  fontSize="11px"
                  color="text.secondary"
                  sx={{ whiteSpace: "nowrap" }}
                >
                  every
                </Typography>
                <TextField
                  select
                  size="small"
                  value={qcRefreshInterval}
                  onChange={(e) => setQcRefreshInterval(Number(e.target.value))}
                  sx={{
                    minWidth: 64,
                    "& .MuiInputBase-input": {
                      fontSize: "11px",
                      py: "2px",
                      px: "4px",
                    },
                    "& .MuiOutlinedInput-root": { height: 24 },
                  }}
                >
                  {[
                    { label: "15m", value: 900 },
                    { label: "30m", value: 1800 },
                    { label: "1h", value: 3600 },
                    { label: "6h", value: 21600 },
                    { label: "12h", value: 43200 },
                  ].map(({ label, value }) => (
                    <MenuItem
                      key={value}
                      value={value}
                      sx={{ fontSize: "12px" }}
                    >
                      {label}
                    </MenuItem>
                  ))}
                </TextField>
                <Divider
                  orientation="vertical"
                  variant="middle"
                  flexItem
                  sx={{ mx: 0.25 }}
                />
                <Button
                  size="small"
                  variant="outlined"
                  color="warning"
                  startIcon={
                    <AutorenewIcon sx={{ fontSize: "13px !important" }} />
                  }
                  sx={{
                    textTransform: "none",
                    fontSize: "11px",
                    py: "1px",
                    px: "6px",
                    minWidth: "auto",
                    lineHeight: 1.6,
                  }}
                  onClick={handleQcRefreshNow}
                >
                  Refresh now
                </Button>
                <Divider
                  orientation="vertical"
                  variant="middle"
                  flexItem
                  sx={{ mx: 0.25 }}
                />
                <Typography
                  fontSize="11px"
                  color="warning.main"
                  sx={{
                    minWidth: 28,
                    textAlign: "center",
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {(() => {
                    const m = Math.floor(qcCountdown / 60);
                    const s = qcCountdown % 60;
                    return m > 0
                      ? `${m}:${String(s).padStart(2, "0")}`
                      : `${s}s`;
                  })()}
                </Typography>
              </>
            )}
          </>
        )}
      </Stack>
    ),
    [
      localScaleFactor,
      isFullscreen,
      isQcTable,
      focusedChart.qcLive,
      focusedChart.id,
      qcRefreshInterval,
      qcDaysRange,
      qcCountdown,
      handleQcRefreshNow,
    ],
  );

  return (
    <Box
      ref={componentRef}
      sx={{ overflow: "hidden", display: "flex", flex: 1 }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && isFullscreen) {
          exitBrowserFullscreen();
        }
      }}
    >
      {synthesisRunning ? (
        <Box
          sx={{
            position: "absolute",
            height: "calc(100%)",
            width: "calc(100%)",
            zIndex: 1001,
            backgroundColor: "rgba(243, 243, 243, 0.8)",
            display: "flex",
            alignItems: "center",
          }}
        >
          <LinearProgress
            sx={{ width: "100%", height: "100%", opacity: 0.05 }}
          />
        </Box>
      ) : (
        ""
      )}
      {chartUnavailable ? "" : chartResizer}
      {content}

      {/* Fullscreen Dialog for Chart */}
      <Dialog
        fullScreen
        open={isFullscreen}
        onClose={exitBrowserFullscreen}
        PaperProps={{
          sx: {
            backgroundColor: "#fafafa",
          },
        }}
      >
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            width: "100%",
            overflow: "hidden",
            p: 2,
            boxSizing: "border-box",
          }}
        >
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 2,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography variant="h6">
                {focusedChart.chartType || "Chart"} - Fullscreen View
              </Typography>
              {focusedChart.qcLive && (
                <Tooltip title="Data Live is active">
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <Box
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        backgroundColor: "error.main",
                        "@keyframes pulse": {
                          "0%": { transform: "scale(1)", opacity: 1 },
                          "50%": { transform: "scale(1.4)", opacity: 0.6 },
                          "100%": { transform: "scale(1)", opacity: 1 },
                        },
                        animation: "pulse 1.4s ease-in-out infinite",
                      }}
                    />
                    <Typography
                      variant="caption"
                      sx={{
                        color: "error.main",
                        fontWeight: 700,
                        letterSpacing: "0.05em",
                      }}
                    >
                      LIVE
                    </Typography>
                  </Box>
                </Tooltip>
              )}
            </Box>
            <Tooltip title="Close fullscreen (or press ESC)">
              <IconButton onClick={exitBrowserFullscreen} color="primary">
                <FullscreenExitIcon />
              </IconButton>
            </Tooltip>
          </Box>
          <Divider sx={{ mb: 2 }} />

          {/* Chart rendering in fullscreen */}
          <Box
            sx={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              overflow: "auto",
              minHeight: 0,
            }}
          >
            {focusedChart.chartType === "Auto" ||
            focusedChart.chartType === "Table" ||
            chartUnavailable ? (
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "center",
                  color: "text.secondary",
                }}
              >
                <InsightsIcon sx={{ fontSize: 60, mb: 1, opacity: 0.5 }} />
                <Typography>Chart not available</Typography>
              </Box>
            ) : (
              <Box
                sx={{
                  display: "inline-flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                }}
              >
                <Box
                  id={`fullscreen-chart-${focusedChart.id}`}
                  sx={{ display: "flex" }}
                ></Box>
              </Box>
            )}
          </Box>

          <Divider sx={{ mt: 2, mb: 1 }} />
          <Typography variant="caption" color="text.secondary">
            Press ESC or click the close button to exit fullscreen
          </Typography>
        </Box>
      </Dialog>
    </Box>
  );
};

export const VisualizationViewFC: FC<VisPanelProps> =
  function VisualizationView({}) {
    let allCharts = useSelector(dfSelectors.getAllCharts);
    let focusedChartId = useSelector(
      (state: DataFormulatorState) => state.focusedChartId,
    );
    let focusedTableId = useSelector(
      (state: DataFormulatorState) => state.focusedTableId,
    );
    let chartSynthesisInProgress = useSelector(
      (state: DataFormulatorState) => state.chartSynthesisInProgress,
    );

    const dispatch = useDispatch();

    let focusedChart = allCharts.find((c) => c.id == focusedChartId) as Chart;
    let synthesisRunning = focusedChartId
      ? chartSynthesisInProgress.includes(focusedChartId)
      : false;

    // when there is no result and synthesis is running, just show the waiting panel
    if (!focusedChart || focusedChart?.chartType == "?") {
      let chartSelectionBox = (
        <Box
          sx={{
            display: "flex",
            flexDirection: "row",
            width: "666px",
            flexWrap: "wrap",
          }}
        >
          {Object.entries(CHART_TEMPLATES)
            .flatMap(([cls, templates]) =>
              templates.map((t, index) => ({ ...t, group: cls, index })),
            )
            .filter((t) => t.chart != "Auto")
            .map((t, globalIndex) => {
              return (
                <Button
                  disabled={synthesisRunning}
                  key={`${t.group}-${t.index}-${t.chart}-btn`}
                  sx={{
                    margin: "2px",
                    padding: "2px",
                    display: "flex",
                    flexDirection: "column",
                    textTransform: "none",
                    justifyContent: "flex-start",
                  }}
                  onClick={() => {
                    let focusedChart = allCharts.find(
                      (c) => c.id == focusedChartId,
                    );
                    if (focusedChart?.chartType == "?") {
                      dispatch(
                        dfActions.updateChartType({
                          chartType: t.chart,
                          chartId: focusedChartId as string,
                        }),
                      );
                    } else {
                      dispatch(
                        dfActions.createNewChart({
                          chartType: t.chart,
                          tableId: focusedTableId as string,
                        }),
                      );
                    }
                  }}
                >
                  <Box
                    sx={{
                      opacity: synthesisRunning ? 0.5 : 1,
                      width: 48,
                      height: 48,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {typeof t?.icon == "string" ? (
                      <img
                        height="48px"
                        width="48px"
                        src={t?.icon}
                        alt=""
                        role="presentation"
                      />
                    ) : (
                      t.icon
                    )}
                  </Box>
                  <Typography
                    sx={{
                      marginLeft: "2px",
                      whiteSpace: "initial",
                      fontSize: "10px",
                      width: "64px",
                    }}
                  >
                    {t?.chart}
                  </Typography>
                </Button>
              );
            })}
        </Box>
      );
      return (
        <Box sx={{ margin: "auto" }}>
          {focusedTableId ? (
            <ChartRecBox
              sx={{ margin: "auto" }}
              tableId={focusedTableId as string}
              placeHolderChartId={focusedChartId as string}
            />
          ) : null}
          <Divider sx={{ my: 3 }} textAlign="left">
            <Typography sx={{ fontSize: 12, color: "darkgray" }}>
              or, select a chart type
            </Typography>
          </Divider>
          {chartSelectionBox}
        </Box>
      );
    }

    let visPanel = (
      <Box
        sx={{
          width: "100%",
          overflow: "hidden",
          display: "flex",
          flexDirection: "row",
        }}
      >
        <Box className="visualization-carousel" sx={{ display: "contents" }}>
          <ChartEditorFC />
        </Box>
      </Box>
    );

    return visPanel;
  };
async function getOriginalTableFromVirtualData(
  table: any,
  activeVisRows: any[],
): Promise<any[] | undefined> {
  if (!table || !table.rows || table.rows.length === 0)
    return table?.rows || [];

  if (!activeVisRows || activeVisRows.length === 0) return table.rows;

  // Tìm khóa index trong activeVisRows (ưu tiên tên 'INDEX' nếu có)
  const sampleKeys = Object.keys(activeVisRows[0]);
  const indexKey =
    sampleKeys.find((k) => k.toUpperCase() === "INDEX") || sampleKeys[0];

  const indexSet = new Set(activeVisRows.map((r) => r[indexKey]));

  try {
    const resp = await fetch(getUrls().SAMPLE_TABLE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        table: table.id,
        size: 999999,
        method: "head",
        select_fields: ["INDEX", "TARGET", "LL", "UL", "ARLL", "ARUL"],
        aggregate_fields_and_functions: [],
        range_start: 1,
        range_size: 999999,
      }),
    });
    const datas = await resp.json();
    const rows = datas?.rows || datas?.data || datas?.result || [];
    const matched = (rows as any[]).filter((r: any) =>
      indexSet.has(r[indexKey]),
    );
    console.log(
      "✅ getOriginalTableFromVirtualData matched:",
      matched.length,
      "rows",
    );
    // Return the real matched rows from server (may be empty array, not fallback)
    return matched;
  } catch (e) {
    console.error("❌ getOriginalTableFromVirtualData error:", e);
    // Return undefined on error so effect can decide fallback
    return undefined;
  }
}
