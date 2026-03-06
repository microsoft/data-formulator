// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, {
  FC,
  useCallback,
  useEffect,
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
import { buildQcDataQuery } from "./DBTableManager";
import CodeIcon from "@mui/icons-material/Code";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";

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
  const maxSliderSize = Math.min(totalSize, 100000);
  const minSliderSize = 0;

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
        <Box sx={{ p: 2, width: 300 }}>
          <Typography fontSize="small" gutterBottom>
            Adjust sample range: {sampleRange[0]} - {sampleRange[1]} rows
          </Typography>
          <Box
            sx={{ display: "flex", flexDirection: "row", alignItems: "center" }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
              {minSliderSize}
            </Typography>
            <Slider
              size="small"
              min={minSliderSize}
              max={maxSliderSize}
              sx={{ mr: 1 }}
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
            <Button
              sx={{ textTransform: "none", ml: 2, fontSize: "12px" }}
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
  }) => {
    const elementId = `focused-chart-element-${chart.id}`;

    useEffect(() => {
      if (
        chart.chartType === "Auto" ||
        chart.chartType === "Table" ||
        chartUnavailable
      ) {
        return;
      }

      const assembledChart = assembleVegaChart(
        chart.chartType,
        chart.encodingMap,
        conceptShelfItems,
        visTableRows,
        tableMetadata,
        24,
        true,
        chartWidth,
        chartHeight,
        true,
        chart.qcLimitsMode || false,
      );

      embed(
        "#" + elementId,
        { ...assembledChart },
        { actions: true, renderer: "svg" },
      )
        .then(function (result) {
          if (result.view.container()?.getElementsByTagName("svg")) {
            let comp = result.view.container()?.getElementsByTagName("svg")[0];
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
        })
        .catch((error) => {
          //console.error('Chart rendering error:', error);
        });
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

    return <Box id={elementId} sx={{ mx: 2 }}></Box>;
  },
);
VegaChartRenderer.displayName = "VegaChartRenderer";

export const ChartEditorFC: FC<{}> = function ChartEditorFC({}) {
  const config = useSelector((state: DataFormulatorState) => state.config);
  const componentRef = useRef<HTMLHeadingElement>(null);

  // Add ref for the container box that holds all exploration components
  const explanationComponentsRef = useRef<HTMLDivElement>(null);

  let tables = useSelector((state: DataFormulatorState) => state.tables);

  let charts = useSelector(dfSelectors.getAllCharts);
  let focusedChartId = useSelector(
    (state: DataFormulatorState) => state.focusedChartId,
  );
  let chartSynthesisInProgress = useSelector(
    (state: DataFormulatorState) => state.chartSynthesisInProgress,
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
  }, [focusedChartId]);

  // Data Live: keep a stable ref to fetchDisplayRows to avoid stale closure in setInterval
  const fetchDisplayRowsRef = useRef<
    (range?: [number, number], totalRowsOverride?: number) => void
  >(() => {});
  const tableRef = useRef<DictTable | null>(null);
  // Keep a stable ref to the full tables list to avoid stale closures in Data Live callbacks
  const tablesRef = useRef<typeof tables>(tables);
  useEffect(() => {
    fetchDisplayRowsRef.current = fetchDisplayRows;
  });

  // QC Live: ref so countdown timer always calls the latest handleQcRefreshNow
  const doQcRefreshRef = useRef<() => Promise<void>>(async () => {});
  // Flag to trigger an immediate refresh once the ref is synced to the new handleQcRefreshNow
  const triggerImmediateRef = useRef<boolean>(false);
  // Track previous qcLimitsMode to detect when it's turned off → restore original data
  const prevQcLiveRef = useRef<boolean>(false);

  // QC Live: when turned OFF, re-ingest with original params to restore previous data
  useEffect(() => {
    const wasOn = prevQcLiveRef.current;
    prevQcLiveRef.current = !!focusedChart.qcLive;
    if (wasOn && !focusedChart.qcLive) {
      // Turned off — restore original data
      const currentTable = tableRef.current;
      const qcParams = dataLoaderConnectParams["QC_Data"] ?? {};

      if (currentTable?.derive?.code) {
        // Agent-derived table: restore source virtual tables then re-run SQL
        const allTables = tablesRef.current;
        const virtualSources = (currentTable.derive.source ?? [])
          .map((id) => allTables.find((t) => t.id === id))
          .filter((t): t is (typeof tables)[0] => !!t?.virtual);
        if (virtualSources.length > 0) {
          Promise.all(
            virtualSources.map((srcTable) => {
              const built = buildQcDataQuery(qcParams);
              if (!built) return Promise.resolve();
              const nameAs = srcTable.virtual!.tableId || srcTable.id;
              return fetch(getUrls().DATA_LOADER_INGEST_DATA_FROM_QUERY, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  data_loader_type: "QC_Data",
                  data_loader_params: qcParams,
                  query: built.query,
                  name_as: nameAs,
                }),
              })
                .then((r) => r.json())
                .then((d) => {
                  if (d.status === "success") {
                    dispatch(
                      dfActions.updateTableVirtualRowCount({
                        tableId: srcTable.id,
                        rowCount: d.row_count ?? 100000,
                      }),
                    );
                  }
                })
                .catch((err) =>
                  console.warn("Data Live derived restore ingest error:", err),
                );
            }),
          )
            .then(() =>
              fetch(getUrls().EXECUTE_SQL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  code: currentTable.derive!.code,
                  name_as: currentTable.virtual?.tableId || currentTable.id,
                }),
              }),
            )
            .then((r) => r.json())
            .then((d) => {
              if (d.status === "success" && d.rows?.length > 0) {
                dispatch(
                  dfActions.replaceTable({ ...currentTable, rows: d.rows }),
                );
                setCurrentSampleRange(undefined);
                fetchDisplayRowsRef.current(
                  [0, Math.min(d.rows.length, 100000)],
                  d.rows.length,
                );
              }
            })
            .catch((err) =>
              console.error("Data Live derived restore error:", err),
            );
        }
      } else if (currentTable?.virtual) {
        // Direct virtual table: restore with original (no rolling window) params
        const built = buildQcDataQuery(qcParams); // no date override → original range
        const nameAs = currentTable.virtual.tableId || currentTable.id;
        if (built) {
          fetch(getUrls().DATA_LOADER_INGEST_DATA_FROM_QUERY, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              data_loader_type: "QC_Data",
              data_loader_params: qcParams,
              query: built.query,
              name_as: nameAs,
            }),
          })
            .then((r) => r.json())
            .then((data) => {
              if (data.status === "success") {
                const restoredCount: number = data.row_count ?? 100000;
                dispatch(
                  dfActions.updateTableVirtualRowCount({
                    tableId: currentTable.id,
                    rowCount: restoredCount,
                  }),
                );
                setCurrentSampleRange(undefined);
                fetchDisplayRowsRef.current(
                  [0, Math.min(restoredCount, 100000)],
                  restoredCount,
                );
              }
            })
            .catch((err) => console.error("Data Live restore error:", err));
        }
      }
    }
  }, [focusedChart.qcLive, dataLoaderConnectParams]);

  // Data Live: countdown timer and auto-refresh
  useEffect(() => {
    if (!focusedChart.qcLive) return;
    setQcCountdown(qcRefreshInterval);
    // Signal that an immediate refresh should fire once doQcRefreshRef is updated below
    triggerImmediateRef.current = true;
    const timer = setInterval(() => {
      setQcCountdown((prev) => {
        if (prev <= 1) {
          doQcRefreshRef.current();
          return qcRefreshInterval;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [focusedChart.qcLive, qcRefreshInterval]);

  const handleQcRefreshNow = useCallback(async () => {
    const currentTable = tableRef.current;
    const qcParams = dataLoaderConnectParams["QC_Data"] ?? {};
    const today = new Date();
    const fromDate = new Date(today);
    fromDate.setDate(today.getDate() - qcDaysRange);
    const fmt = (d: Date) => d.toISOString().split("T")[0]; // YYYY-MM-DD

    if (currentTable?.derive?.code && focusedChart.qcLive) {
      // Agent-derived table: re-ingest source virtual tables then re-execute the SQL
      const allTables = tablesRef.current;
      const virtualSources = (currentTable.derive.source ?? [])
        .map((id) => allTables.find((t) => t.id === id))
        .filter((t): t is (typeof tables)[0] => !!t?.virtual);

      try {
        // 1. Re-ingest all virtual source tables with rolling date window
        //    Use virtual.tableId as name_as to match the actual DuckDB table name
        await Promise.all(
          virtualSources.map((srcTable) => {
            const built = buildQcDataQuery(qcParams, {
              from_date: fmt(fromDate),
              to_date: fmt(today),
            });
            if (!built) return Promise.resolve();
            const nameAs = srcTable.virtual!.tableId || srcTable.id;
            return fetch(getUrls().DATA_LOADER_INGEST_DATA_FROM_QUERY, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                data_loader_type: "QC_Data",
                data_loader_params: qcParams,
                query: built.query,
                name_as: nameAs,
              }),
            })
              .then((r) => r.json())
              .then((d) => {
                if (d.status === "success") {
                  dispatch(
                    dfActions.updateTableVirtualRowCount({
                      tableId: srcTable.id,
                      rowCount: d.row_count ?? 100000,
                    }),
                  );
                } else {
                  console.warn(
                    "Data Live source re-ingest failed:",
                    d.message ?? d.error,
                  );
                }
              })
              .catch((err) =>
                console.warn("Data Live source re-ingest error:", err),
              );
          }),
        );

        // 2. Re-execute the derived SQL and get the fresh rows back
        const derivedDuckDbName =
          currentTable.virtual?.tableId || currentTable.id;
        const sqlResp = await fetch(getUrls().EXECUTE_SQL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: currentTable.derive.code,
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
          // 3. Update Redux with the fresh rows so chart encodings stay correct
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
          fetchDisplayRowsRef.current(
            [0, Math.min(sqlData.rows?.length ?? 100000, 100000)],
            sqlData.rows?.length ?? 100000,
          );
          setQcCountdown(qcRefreshInterval);
          return;
        }
      } catch (err) {
        console.error("Data Live derived table refresh error:", err);
      }
    } else if (currentTable?.virtual && focusedChart.qcLive) {
      // Direct virtual Data table: re-ingest with a rolling date window
      const built = buildQcDataQuery(qcParams, {
        from_date: fmt(fromDate),
        to_date: fmt(today),
      });
      if (built) {
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
                name_as: currentTable.virtual!.tableId || currentTable.id,
              }),
            },
          );
          let data: any = {};
          try {
            data = await resp.json();
          } catch {
            data = { status: "error", message: `HTTP ${resp.status}` };
          }
          if (data.status !== "success") {
            console.warn(
              "Data Live re-ingest failed:",
              data.message ?? data.error,
            );
          } else {
            const newRowCount: number = data.row_count ?? 100000;
            dispatch(
              dfActions.updateTableVirtualRowCount({
                tableId: currentTable.id,
                rowCount: newRowCount,
              }),
            );
            setCurrentSampleRange(undefined);
            fetchDisplayRowsRef.current(
              [0, Math.min(newRowCount, 100000)],
              newRowCount,
            );
            setQcCountdown(qcRefreshInterval);
            return;
          }
        } catch (err) {
          console.error("Data Live re-ingest error:", err);
        }
      }
    }

    fetchDisplayRowsRef.current();
    setQcCountdown(qcRefreshInterval);
  }, [
    focusedChart.qcLive,
    dataLoaderConnectParams,
    qcRefreshInterval,
    qcDaysRange,
  ]);

  // Keep doQcRefreshRef in sync so the countdown timer always sees the latest version
  // Also fires the immediate refresh when Data Live is first activated
  useEffect(() => {
    doQcRefreshRef.current = handleQcRefreshNow;
    if (triggerImmediateRef.current) {
      triggerImmediateRef.current = false;
      handleQcRefreshNow();
    }
  });

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

  let table = getDataTable(focusedChart, tables, charts, conceptShelfItems);
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
    );

    if (visTable.length > 5000) {
      let rowSample = _.sampleSize(visTable, 5000);
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
    const totalRows = table.virtual?.rowCount || table.rows.length;
    return [0, Math.min(1000, totalRows)];
  }, [table.virtual?.rowCount, table.rows.length]);

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
  const isDataStale =
    dataVersion !==
    `${focusedChart.id}-${table.id}-${sortedVisDataFields.join("_")}`;

  // Use empty data if stale to avoid showing incorrect data during transitions
  const activeVisTableRows = isDataStale ? [] : visTableRows;
  const activeVisTableTotalRowCount = isDataStale ? 0 : visTableTotalRowCount;

  async function fetchDisplayRows(
    range?: [number, number],
    totalRowsOverride?: number,
  ) {
    const totalRows =
      totalRowsOverride ?? (table.virtual?.rowCount || table.rows.length);
    const sliderMax = Math.min(totalRows, 100000);
    const sliderMin = 0;

    const clampRange = (value: [number, number]): [number, number] => {
      const lower = Math.min(Math.max(value[0], sliderMin), sliderMax);
      const upper = Math.min(Math.max(value[1], sliderMin), sliderMax);
      return [Math.min(lower, upper), Math.max(lower, upper)];
    };

    let normalizedRange: [number, number];
    if (range) {
      normalizedRange = clampRange(range);
    } else if (currentSampleRange) {
      normalizedRange = clampRange(currentSampleRange);
    } else {
      normalizedRange = [0, Math.min(1000, sliderMax)];
    }

    const [rangeMin, rangeMax] = normalizedRange;
    const rangeSize = Math.max(rangeMax - rangeMin + 1, 1);
    const sampleSize = rangeSize;

    setCurrentSampleRange(normalizedRange);
    if (table.virtual) {
      // Generate unique request ID to track this specific request
      const requestId = `${focusedChart.id}-${table.id}-${Date.now()}`;
      currentRequestRef.current = requestId;

      let { aggregateFields, groupByFields } = extractFieldsFromEncodingMap(
        focusedChart.encodingMap,
        conceptShelfItems,
      );
      fetch(getUrls().SAMPLE_TABLE, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          table: table.id,
          size: sampleSize,
          method: "head", //"random",
          select_fields: groupByFields,
          aggregate_fields_and_functions: aggregateFields,
          range_start: rangeMin,
          range_size: rangeSize,
        }),
      })
        .then((response) => response.json())
        .then((data) => {
          // Only update if this is still the current request (not stale)
          if (currentRequestRef.current === requestId) {
            const versionId = `${focusedChart.id}-${
              table.id
            }-${sortedVisDataFields.join("_")}`;
            if (data.status == "success") {
              setVisTableRows(data.rows);
              setVisTableTotalRowCount(data.total_row_count);
              setDataVersion(versionId);
            } else {
              setVisTableRows([]);
              setVisTableTotalRowCount(0);
              setDataVersion(versionId);
              setSystemMessage(data.message, "error");
            }
          }
          // Else: this response is stale, ignore it
        })
        .catch((error) => {
          // Only show error if this is still the current request
          if (currentRequestRef.current === requestId) {
            console.error("Error sampling table:", error);
          }
        });
    } else {
      // Randomly sample sampleSize rows from table.rows
      const startIdx = Math.min(Math.max(rangeMin, 0), table.rows.length);
      const endIdx = Math.min(startIdx + sampleSize, table.rows.length);
      const rowSample = table.rows.slice(startIdx, endIdx);
      setVisTableRows(structuredClone(rowSample));
      setDataVersion(
        `${focusedChart.id}-${table.id}-${sortedVisDataFields.join("_")}`,
      );
    }
  }

  useEffect(() => {
    if (table.virtual && visFields.length > 0 && dataFieldsAllAvailable) {
      fetchDisplayRows();
    }
  }, []);

  useEffect(() => {
    const versionId = `${focusedChart.id}-${
      table.id
    }-${sortedVisDataFields.join("_")}`;

    if (visFields.length > 0 && dataFieldsAllAvailable) {
      // table changed, we need to update the rows to display
      if (table.virtual) {
        // virtual table, we need to sample the table
        fetchDisplayRows();
      } else {
        // non-virtual table, update with processed data
        const newProcessedData = createVisTableRowsLocal(table.rows);
        setVisTableRows(newProcessedData);
        setVisTableTotalRowCount(table.rows.length);
        setDataVersion(versionId);
      }
    } else {
      // If no fields, just use the table rows directly
      setVisTableRows(table.rows);
      setVisTableTotalRowCount(table.virtual?.rowCount || table.rows.length);
      setDataVersion(versionId);
    }
  }, [dataRequirements]);

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
          <Typography
            component="span"
            fontSize="small"
            color="text.secondary"
            sx={{ textAlign: "center" }}
          >
            visualizing
          </Typography>
          <SampleSizeEditor
            initialRange={currentSampleRange ?? defaultRange}
            totalSize={activeVisTableTotalRowCount}
            onSampleSizeChange={(newRange) => {
              fetchDisplayRows(newRange);
            }}
          />
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
        <Tooltip key="fullscreen-tooltip" title="fullscreen">
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
