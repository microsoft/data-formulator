// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC, useEffect, useState, useRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import {
  DataFormulatorState,
  dfActions,
  dfSelectors,
  fetchCodeExpl,
  fetchFieldSemanticType,
  generateFreshChart,
} from "../app/dfSlice";

import { AppDispatch } from "../app/store";
import { logUserPrompt } from "../utils/promptLogger";

import {
  Box,
  Typography,
  MenuItem,
  IconButton,
  Tooltip,
  TextField,
  Stack,
  Card,
  Chip,
  Autocomplete,
  Menu,
  SxProps,
  LinearProgress,
  CircularProgress,
  Divider,
  List,
  ListItem,
  alpha,
  useTheme,
  Theme,
  Button,
  Select,
  FormControl,
} from "@mui/material";

import React from "react";

import { Chart, FieldItem } from "../components/ComponentType";

import _ from "lodash";

import "../scss/EncodingShelf.scss";
import { createDictTable, DictTable } from "../components/ComponentType";

import { getUrls, getTriggers, resolveRecommendedChart } from "../app/utils";
import { CHART_TEMPLATES } from "../components/ChartTemplates";

import AddIcon from "@mui/icons-material/Add";
import PrecisionManufacturing from "@mui/icons-material/PrecisionManufacturing";
import { Type } from "../data/types";
import CloseIcon from "@mui/icons-material/Close";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import TipsAndUpdatesIcon from "@mui/icons-material/TipsAndUpdates";
import { renderTextWithEmphasis } from "./EncodingShelfCard";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import MovingIcon from "@mui/icons-material/Moving";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import EditIcon from "@mui/icons-material/Edit";
import { ThinkingBufferEffect } from "../components/FunComponents";
import {
  ChartAssistantModal,
  ChartAssistantMode,
} from "../components/ChartAssistantModal";
import { ChartSuggestion } from "../components/ChartThumbnail";

// when this is set to true, the new chart will be focused automatically
const AUTO_FOCUS_NEW_CHART = false;

// Mapping from display names to internal chart type names (what LLM expects)
const CHART_NAME_TO_INTERNAL_TYPE: Record<string, string> = {
  // Display Name → Internal Type (as expected by LLM system prompt)
  Table: "table",
  Auto: "auto",
  "Scatter Plot": "scatter",
  "Linear Regression": "linear_regression",
  "Loess Regression": "loess",
  "Ranged Dot Plot": "scatter",
  Boxplot: "boxplot",
  "Bar Chart": "bar",
  "Pyramid Chart": "bar",
  "Grouped Bar Chart": "group_bar",
  "Stacked Bar Chart": "bar",
  Histogram: "histogram",
  "Threshold Bar Chart": "bar",
  "Line Chart": "line",
  "Dotted Line Chart": "line",
  "Rolling Average": "line",
  "Heat Map": "heatmap",
  "Pie Chart": "pie",
  "Radial Plot": "radar",
  "Bubble Plot": "bubble",
  "Area Chart": "area",
  // QC (Quality Control) chart types
  "QC Trend Line": "qc_trend_line",
  "QC Trend Bar": "qc_trend_bar",
  "QC Histogram": "qc_histogram",
};

// QC chart type options shown in the dropdown for QC idea chips
const QC_CHART_TYPES: { value: string; label: string }[] = [
  { value: "QC Trend Line", label: "QC Trend Line" },
  { value: "QC Trend Bar", label: "QC Trend Bar" },
  { value: "QC Histogram", label: "QC Histogram" },
];

// Detect if a table's column names indicate Quality Control / SPC data.
// Detect if a table is a QC table by checking for required QC columns.
// A table is QC if it contains ALL of: INDEX, VALUE, QCSTDPARAMNAME, TARGET,
// LL, UL, ARLL, ARUL, QCDATE, QCSHIFT (case-insensitive).
const QC_REQUIRED_COLUMNS = [
  "INDEX",
  "VALUE",
  "QCSTDPARAMNAME",
  "TARGET",
  "LL",
  "UL",
  "ARLL",
  "ARUL",
  "QCDATE",
  "QCSHIFT",
];

const isQcData = (names: string[]): boolean => {
  return QC_REQUIRED_COLUMNS.every((col) =>
    names.some((n) => n.toUpperCase() === col),
  );
};

// Convert display name to internal chart type name
const getInternalChartType = (displayName: string): string => {
  return CHART_NAME_TO_INTERNAL_TYPE[displayName] || displayName;
};

// Generate available chart types from CHART_TEMPLATES in the system
const getAvailableChartTypes = (): { value: string; label: string }[] => {
  const chartTypes: { value: string; label: string }[] = [];
  Object.entries(CHART_TEMPLATES).forEach(([cls, templates]) => {
    templates.forEach((t) => {
      if (t.chart && t.chart !== "Auto") {
        chartTypes.push({
          value: t.chart, // 🔧 Use actual chart name, not hyphenated version
          label: t.chart,
        });
      }
    });
  });
  // Remove duplicates
  return Array.from(new Map(chartTypes.map((ct) => [ct.label, ct])).values());
};

export interface ChartRecBoxProps {
  tableId: string;
  placeHolderChartId?: string;
  sx?: SxProps;
}

// Table selector component for ChartRecBox
const NLTableSelector: FC<{
  selectedTableIds: string[];
  tables: DictTable[];
  updateSelectedTableIds: (tableIds: string[]) => void;
  requiredTableIds?: string[];
}> = ({
  selectedTableIds,
  tables,
  updateSelectedTableIds,
  requiredTableIds = [],
}) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleTableSelect = (table: DictTable) => {
    if (!selectedTableIds.includes(table.id)) {
      updateSelectedTableIds([...selectedTableIds, table.id]);
    }
    handleClose();
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexWrap: "wrap",
        gap: "2px",
        padding: "4px",
        marginBottom: 0.5,
      }}
    >
      {selectedTableIds.map((tableId) => {
        const isRequired = requiredTableIds.includes(tableId);
        return (
          <Chip
            key={tableId}
            label={tables.find((t) => t.id == tableId)?.displayId}
            size="small"
            sx={{
              height: 16,
              fontSize: "10px",
              borderRadius: "2px",
              bgcolor: isRequired
                ? "rgba(25, 118, 210, 0.2)"
                : "rgba(25, 118, 210, 0.1)",
              color: "rgba(0, 0, 0, 0.7)",
              "& .MuiChip-label": {
                pl: "4px",
                pr: "6px",
              },
            }}
            deleteIcon={
              isRequired ? undefined : (
                <CloseIcon
                  sx={{ fontSize: "8px", width: "12px", height: "12px" }}
                />
              )
            }
            onDelete={
              isRequired
                ? undefined
                : () =>
                    updateSelectedTableIds(
                      selectedTableIds.filter((id) => id !== tableId),
                    )
            }
          />
        );
      })}
      <Tooltip title="select tables for data formulation">
        <IconButton
          size="small"
          onClick={handleClick}
          sx={{
            width: 16,
            height: 16,
            fontSize: "10px",
            padding: 0,
          }}
        >
          <AddIcon fontSize="inherit" />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchorEl} open={open} onClose={handleClose}>
        {tables
          .filter((t) => t.derive === undefined || t.anchored)
          .map((table) => {
            const isSelected = selectedTableIds.includes(table.id);
            const isRequired = requiredTableIds.includes(table.id);
            return (
              <MenuItem
                disabled={isSelected}
                key={table.id}
                onClick={() => handleTableSelect(table)}
                sx={{
                  fontSize: "12px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                {table.displayId}
                {isRequired && (
                  <Typography
                    sx={{ fontSize: "10px", color: "text.secondary" }}
                  >
                    (required)
                  </Typography>
                )}
              </MenuItem>
            );
          })}
      </Menu>
    </Box>
  );
};

export const IdeaChip: FC<{
  mini?: boolean;
  idea: {
    text?: string;
    questions?: string[];
    goal: string;
    difficulty: "easy" | "medium" | "hard";
    type?: "branch" | "deep_dive";
    predictedChartType?: string;
    isQcIdea?: boolean;
  };
  theme: Theme;
  onClick: (chartType?: string) => void;
  sx?: SxProps;
  disabled?: boolean;
  /** Override the dropdown chart type list (e.g. for QC chips) */
  customChartTypes?: { value: string; label: string }[];
}> = function ({ mini, idea, theme, onClick, sx, disabled, customChartTypes }) {
  const systemChartTypes = getAvailableChartTypes();
  const availableChartTypes = customChartTypes ?? systemChartTypes;

  // Initialize dropdown to AI-predicted chart type if it exists in available list
  const getInitialChartType = (): string => {
    if (idea.predictedChartType) {
      const matched = availableChartTypes.find(
        (ct) =>
          ct.label.toLowerCase() === idea.predictedChartType!.toLowerCase(),
      );
      if (matched) return matched.value;
    }
    return availableChartTypes.length > 0 ? availableChartTypes[0].value : "";
  };

  const [selectedChartType, setSelectedChartType] =
    useState<string>(getInitialChartType);
  const [compatibilityWarning, setCompatibilityWarning] = useState<
    string | null
  >(null);

  // Chart types that are generally incompatible with certain goal keywords
  const checkCompatibility = (
    chartType: string,
    goal: string,
  ): string | null => {
    const lowerGoal = goal.toLowerCase();
    const lowerChart = chartType.toLowerCase();

    const incompatibleRules: Array<{
      chartPattern: string;
      goalKeywords: string[];
      reason: string;
    }> = [
      {
        chartPattern: "pie",
        goalKeywords: ["trend", "over time", "time series", "compare many"],
        reason: "Pie chart is not suitable for trends or time-series data",
      },
      {
        chartPattern: "line",
        goalKeywords: ["distribution", "frequency", "proportion", "percentage"],
        reason: "Line chart is not suitable for distributions or proportions",
      },
      {
        chartPattern: "scatter",
        goalKeywords: ["proportion", "percentage", "composition"],
        reason: "Scatter plot is not suitable for showing proportions",
      },
      {
        chartPattern: "histogram",
        goalKeywords: ["trend", "over time", "compare", "ranking"],
        reason: "Histogram is not suitable for trends or comparisons",
      },
      {
        chartPattern: "radar",
        goalKeywords: ["trend", "over time", "distribution"],
        reason:
          "Radar/radial chart is not suitable for time-series or distributions",
      },
    ];

    for (const rule of incompatibleRules) {
      if (lowerChart.includes(rule.chartPattern)) {
        const hasIncompatibleKeyword = rule.goalKeywords.some((kw) =>
          lowerGoal.includes(kw),
        );
        if (hasIncompatibleKeyword) {
          return rule.reason;
        }
      }
    }
    return null;
  };

  // Recheck compatibility whenever chart type changes
  const handleChartTypeChange = (newChartType: string) => {
    setSelectedChartType(newChartType);
    const warning = checkCompatibility(newChartType, idea.goal);
    setCompatibilityWarning(warning);
  };
  const getDifficultyColor = (difficulty: "easy" | "medium" | "hard") => {
    switch (difficulty) {
      case "easy":
        return theme.palette.success.main;
      case "medium":
        return theme.palette.primary.main;
      case "hard":
        return theme.palette.warning.main;
      default:
        return theme.palette.text.secondary;
    }
  };

  let styleColor = getDifficultyColor(idea.difficulty || "medium");

  let ideaText = idea.goal;

  let ideaTextComponent = renderTextWithEmphasis(ideaText, {
    borderRadius: "0px",
    borderBottom: `1px solid`,
    borderColor: alpha(styleColor, 0.4),
    fontSize: "11px",
    lineHeight: 1.4,
    backgroundColor: alpha(styleColor, 0.05),
  });

  const isAiSuggested =
    idea.predictedChartType &&
    availableChartTypes.some(
      (ct) => ct.label.toLowerCase() === idea.predictedChartType!.toLowerCase(),
    ) &&
    availableChartTypes.find(
      (ct) => ct.label.toLowerCase() === idea.predictedChartType!.toLowerCase(),
    )?.value === selectedChartType;

  return (
    <Box
      sx={{
        display: "inline-flex",
        padding: "6px",
        fontSize: "11px",
        minHeight: "auto",
        height: "auto",
        borderRadius: 2,
        border: `1px solid ${alpha(styleColor, 0.2)}`,
        boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
        transition: "all 0.2s ease-in-out",
        backgroundColor: alpha(theme.palette.background.paper, 0.9),
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 0.5,
        "&:hover": disabled
          ? "none"
          : {
              boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
              borderColor: alpha(styleColor, 0.7),
              transform: "translateY(-1px)",
            },
        ...sx,
      }}
    >
      {/* Goal text — click to execute */}
      <Box
        onClick={
          disabled
            ? undefined
            : () => {
                if (compatibilityWarning) {
                  // Do not draw — just show warning, already displayed below
                  return;
                }
                onClick(selectedChartType);
              }
        }
        sx={{ width: "100%", cursor: disabled ? "default" : "pointer" }}
      >
        <Typography
          component="div"
          sx={{
            fontSize: "11px",
            color: getDifficultyColor(idea.difficulty || "medium"),
          }}
        >
          {ideaTextComponent}
        </Typography>
      </Box>

      {/* AI-predicted chart type badge */}
      {idea.predictedChartType && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            mt: 0.25,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Typography
            sx={{
              fontSize: "9px",
              color: alpha(styleColor, 0.6),
              fontStyle: "italic",
            }}
          >
            AI suggests:
          </Typography>
          <Chip
            label={idea.predictedChartType}
            size="small"
            sx={{
              height: "16px",
              fontSize: "9px",
              backgroundColor: isAiSuggested
                ? alpha(styleColor, 0.15)
                : alpha(theme.palette.grey[400], 0.15),
              color: isAiSuggested ? styleColor : theme.palette.text.secondary,
              border: `1px solid ${
                isAiSuggested ? alpha(styleColor, 0.4) : "transparent"
              }`,
              "& .MuiChip-label": { px: 0.75 },
            }}
          />
        </Box>
      )}

      {/* Chart Type Selection Dropdown */}
      <FormControl
        size="small"
        sx={{ minWidth: "100%" }}
        onClick={(e) => e.stopPropagation()}
      >
        <Select
          value={selectedChartType}
          onChange={(e) => handleChartTypeChange(e.target.value)}
          sx={{
            fontSize: "10px",
            height: "24px",
            padding: "0px 4px",
            color: compatibilityWarning ? theme.palette.error.main : styleColor,
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: compatibilityWarning
                ? alpha(theme.palette.error.main, 0.5)
                : alpha(styleColor, 0.3),
            },
            "&:hover .MuiOutlinedInput-notchedOutline": {
              borderColor: compatibilityWarning
                ? theme.palette.error.main
                : alpha(styleColor, 0.5),
            },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
              borderColor: compatibilityWarning
                ? theme.palette.error.main
                : styleColor,
            },
          }}
        >
          {availableChartTypes.map((chartType) => (
            <MenuItem key={chartType.value} value={chartType.value}>
              {chartType.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Compatibility warning */}
      {compatibilityWarning && (
        <Typography
          sx={{
            fontSize: "9px",
            color: theme.palette.error.main,
            mt: 0.25,
            lineHeight: 1.3,
          }}
        >
          ⚠️ {compatibilityWarning}. Clicking will not generate a chart.
        </Typography>
      )}
    </Box>
  );
};

export const AgentIdeaChip: FC<{
  mini?: boolean;
  idea: {
    breadth_questions: string[];
    depth_questions: string[];
    goal: string;
    difficulty: "easy" | "medium" | "hard";
    focus: "breadth" | "depth";
  };
  theme: Theme;
  onClick: () => void;
  sx?: SxProps;
  disabled?: boolean;
}> = function ({ mini, idea, theme, onClick, sx, disabled }) {
  const getDifficultyColor = (difficulty: "easy" | "medium" | "hard") => {
    switch (difficulty) {
      case "easy":
        return theme.palette.success.main;
      case "medium":
        return theme.palette.primary.main;
      case "hard":
        return theme.palette.warning.main;
      default:
        return theme.palette.text.secondary;
    }
  };

  let styleColor = getDifficultyColor(idea.difficulty || "medium");

  let ideaText = idea.goal;

  let ideaTextComponent = renderTextWithEmphasis(ideaText, {
    borderRadius: "0px",
    borderBottom: `1px solid`,
    borderColor: alpha(styleColor, 0.4),
    fontSize: "11px",
    lineHeight: 1.4,
    backgroundColor: alpha(styleColor, 0.05),
  });

  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 6px",
        fontSize: "11px",
        minHeight: "24px",
        height: "auto",
        borderRadius: 2,
        border: `1px solid ${alpha(styleColor, 0.2)}`,
        boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
        transition: "all 0.2s ease-in-out",
        backgroundColor: alpha(theme.palette.background.paper, 0.9),
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        "&:hover": disabled
          ? "none"
          : {
              boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
              borderColor: alpha(styleColor, 0.7),
              transform: "translateY(-1px)",
            },
        ...sx,
      }}
      onClick={disabled ? undefined : onClick}
    >
      {idea.focus === "breadth" && (
        <CallSplitIcon
          sx={{
            color: getDifficultyColor(idea.difficulty),
            fontSize: 18,
            mr: 0.5,
            transform: "rotate(90deg)",
          }}
        />
      )}
      {idea.focus === "depth" && (
        <MovingIcon
          sx={{
            color: getDifficultyColor(idea.difficulty),
            fontSize: 18,
            mr: 0.5,
            transform: "rotate(90deg)",
          }}
        />
      )}
      <Typography
        component="div"
        sx={{
          fontSize: "11px",
          color: getDifficultyColor(idea.difficulty || "medium"),
        }}
      >
        {ideaTextComponent}
      </Typography>
    </Box>
  );
};

export const ChartRecBox: FC<ChartRecBoxProps> = function ({
  tableId,
  placeHolderChartId,
  sx,
}) {
  const dispatch = useDispatch<AppDispatch>();
  const theme = useTheme();

  // reference to states
  const tables = useSelector((state: DataFormulatorState) => state.tables);
  const config = useSelector((state: DataFormulatorState) => state.config);
  const agentRules = { coding: "", exploration: "" };
  const conceptShelfItems = useSelector(
    (state: DataFormulatorState) => state.conceptShelfItems,
  );
  const activeModel = useSelector(dfSelectors.getActiveModel);
  const dataLoaderConnectParams = useSelector(
    (state: DataFormulatorState) => state.dataLoaderConnectParams,
  );

  const [mode] = useState<"interactive">("interactive");

  const focusNextChartRef = useRef<boolean>(true);

  // Color map for different modes - easy to customize!
  const modeColor = theme.palette.secondary.main;

  const [prompt, setPrompt] = useState<string>("");
  const [isFormulating, setIsFormulating] = useState<boolean>(false);
  const [assistantOpen, setAssistantOpen] = useState<boolean>(false);
  const [assistantMode, setAssistantMode] =
    useState<ChartAssistantMode>("SUGGESTION");
  const [assistantTitle, setAssistantTitle] = useState<string>("Gợi ý biểu đồ");
  const [assistantMessage, setAssistantMessage] = useState<string>("");
  const [assistantInstruction, setAssistantInstruction] = useState<string>("");
  const [assistantSuggestions, setAssistantSuggestions] = useState<
    ChartSuggestion[]
  >([]);
  const [assistantSamplePrompts, setAssistantSamplePrompts] = useState<
    string[]
  >([]);
  const [ideas, setIdeas] = useState<
    {
      text: string;
      goal: string;
      difficulty: "easy" | "medium" | "hard";
      predictedChartType?: string;
      isQcIdea?: boolean;
    }[]
  >([]);

  const [agentIdeas, setAgentIdeas] = useState<
    {
      breadth_questions: string[];
      depth_questions: string[];
      goal: string;
      difficulty: "easy" | "medium" | "hard";
      focus: "breadth" | "depth";
    }[]
  >([]);
  const [thinkingBuffer, setThinkingBuffer] = useState<string>("");

  let thinkingBufferEffect = (
    <ThinkingBufferEffect
      text={thinkingBuffer.slice(-60)}
      sx={{ width: "46%" }}
    />
  );

  // Add state for loading ideas
  const [isLoadingIdeas, setIsLoadingIdeas] = useState<boolean>(false);

  // Use the provided tableId and find additional available tables for multi-table operations
  const currentTable = tables.find((t) => t.id === tableId);

  const availableTables = tables.filter(
    (t) => t.derive === undefined || t.anchored,
  );
  const [additionalTableIds, setAdditionalTableIds] = useState<string[]>([]);

  // Combine the main tableId with additional selected tables
  const selectedTableIds = currentTable?.derive
    ? [...currentTable.derive.source, ...additionalTableIds]
    : [tableId, ...additionalTableIds];

  const handleTableSelectionChange = (newTableIds: string[]) => {
    // Filter out the main tableId since it's always included
    const additionalIds = newTableIds.filter((id) => id !== tableId);
    setAdditionalTableIds(additionalIds);
  };

  // Function to get a question from the list with cycling
  const getQuestion = (): string => {
    return mode === "agent"
      ? "let's explore something interesting about the data"
      : "show something interesting about the data";
  };

  // Function to predict chart type from goal description
  // Returns a chart label that matches available chart types in CHART_TEMPLATES
  const predictChartType = (goal: string): string => {
    const lowerGoal = goal.toLowerCase();

    if (
      lowerGoal.includes("trend") ||
      lowerGoal.includes("over time") ||
      lowerGoal.includes("time series")
    ) {
      return "Line Chart";
    } else if (
      lowerGoal.includes("distribution") ||
      lowerGoal.includes("frequency")
    ) {
      return "Histogram";
    } else if (
      lowerGoal.includes("composition") ||
      lowerGoal.includes("proportion") ||
      lowerGoal.includes("percentage")
    ) {
      return "Pie Chart";
    } else if (
      lowerGoal.includes("relationship") ||
      lowerGoal.includes("correlation") ||
      lowerGoal.includes("vs")
    ) {
      return "Scatter Plot";
    } else if (
      lowerGoal.includes("compare") ||
      lowerGoal.includes("across") ||
      lowerGoal.includes("between") ||
      lowerGoal.includes("rank")
    ) {
      return "Bar Chart";
    } else if (lowerGoal.includes("heat") || lowerGoal.includes("matrix")) {
      return "Heat Map";
    } else if (lowerGoal.includes("area") || lowerGoal.includes("cumulative")) {
      return "Area Chart";
    } else {
      return "Bar Chart";
    }
  };

  // Function to get ideas from the interactive explore agent
  const getIdeasFromAgent = async (
    mode: "interactive" | "agent",
    startQuestion?: string,
    autoRunFirstIdea: boolean = false,
    rawUserInput?: string,
  ) => {
    if (!currentTable || isLoadingIdeas) {
      return;
    }

    setIsLoadingIdeas(true);
    setThinkingBuffer("");
    if (mode === "agent") {
      setAgentIdeas([]);
    } else {
      setIdeas([]);
    }

    try {
      // Determine the root table and derived tables context
      let explorationThread: any[] = [];
      let sourceTables = selectedTableIds.map(
        (id) => tables.find((t) => t.id === id) as DictTable,
      );

      // If current table is derived, find the root table and build exploration thread
      if (currentTable.derive && !currentTable.anchored) {
        // Find the root table (anchored or not derived)
        let triggers = getTriggers(currentTable, tables);

        // Build exploration thread with all derived tables in the chain
        explorationThread = triggers.map((trigger) => ({
          name: trigger.resultTableId,
          rows: tables.find((t2) => t2.id === trigger.resultTableId)?.rows,
          description: `Derive from ${trigger.sourceTableIds} with instruction: ${trigger.instruction}`,
        }));
      }

      const messageBody = JSON.stringify({
        token: String(Date.now()),
        model: activeModel,
        start_question: startQuestion,
        mode: mode,
        input_tables: sourceTables.map((t) => ({
          name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ""),
          rows: t.rows,
          attached_metadata: t.attachedMetadata,
        })),
        language: currentTable.virtual ? "sql" : "python",
        exploration_thread: explorationThread,
        agent_exploration_rules: agentRules.exploration,
        raw_user_input: rawUserInput,
        prompt_source: rawUserInput ? "user" : "system",
      });

      const engine = getUrls().GET_RECOMMENDATION_QUESTIONS;
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        config.formulateTimeoutSeconds * 1000,
      );

      const response = await fetch(engine, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: messageBody,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Use streaming reader instead of response.json()
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body reader available");
      }

      const decoder = new TextDecoder();

      let lines: string[] = [];
      let buffer = "";

      let runNextIdea = autoRunFirstIdea;
      let updateState = (lines: string[]) => {
        let dataBlocks = lines
          .map((line) => {
            try {
              return JSON.parse(line.trim());
            } catch (e) {
              return null;
            }
          })
          .filter((block) => block != null);

        if (mode === "agent") {
          // Check if prompt was blocked by guard
          const blockedBlock = dataBlocks.find(
            (b: any) => b.type === "guard_blocked",
          );
          if (blockedBlock) {
            runNextIdea = false;
            dispatch(
              dfActions.addMessages({
                timestamp: Date.now(),
                component: "chart builder",
                type: "warning",
                value:
                  blockedBlock.user_message ||
                  "Please enter a data visualization request.",
              }),
            );
            return;
          }

          let questions = dataBlocks.map((block) => ({
            breadth_questions: block.breadth_questions,
            depth_questions: block.depth_questions,
            goal: block.goal,
            difficulty: block.difficulty,
            focus: block.focus,
          }));
          const newIdeas = questions.map((question: any) => ({
            breadth_questions: question.breadth_questions,
            depth_questions: question.depth_questions,
            goal: question.goal,
            difficulty: question.difficulty,
            focus: question.focus,
          }));
          if (runNextIdea) {
            runNextIdea = false;
            for (let i = 1; i < newIdeas[0].breadth_questions.length; i++) {
              setTimeout(() => {
                deriveDataFromNL(newIdeas[0].breadth_questions[i]);
              }, i + 1 * 1000);
            }
            setTimeout(() => {
              exploreDataFromNL(newIdeas[0].depth_questions);
            }, newIdeas[0].breadth_questions.length + 1 * 1000);
          }
          setAgentIdeas(newIdeas);
        } else {
          let questions: {
            text: string;
            goal: string;
            difficulty: "easy" | "medium" | "hard";
            tag?: string;
            predictedChartType?: string;
            isQcIdea?: boolean;
          }[] = dataBlocks.map((block) => ({
            text: block.text,
            goal: block.goal,
            difficulty: block.difficulty,
            tag: block.tag,
            predictedChartType: predictChartType(
              block.goal || block.text || "",
            ),
          }));

          // Prepend a QC chip as the first idea if QC data is detected
          const tableNames = currentTable?.names ?? [];
          if (isQcData(tableNames)) {
            questions = [
              {
                text: "Draw a QC chart for the quality control data",
                goal: "Draw a QC chart",
                difficulty: "easy" as const,
                tag: "qc",
                predictedChartType: "QC Trend Line",
                isQcIdea: true,
              },
              ...questions,
            ];
          }

          setIdeas(questions);
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          let newLines = buffer
            .split("data: ")
            .filter((line) => line.trim() !== "");
          buffer = newLines.pop() || "";
          if (newLines.length > 0) {
            lines.push(...newLines);
            updateState(lines);
          }
          setThinkingBuffer(buffer.replace(/^data: /, ""));
        }
      } finally {
        reader.releaseLock();
      }

      lines.push(buffer);
      updateState(lines);

      // Process the final result
      if (lines.length == 0) {
        throw new Error("No valid results returned from agent");
      }
    } catch (error) {
      console.error("Error getting ideas from agent:", error);
      dispatch(
        dfActions.addMessages({
          timestamp: Date.now(),
          type: "error",
          component: "chart builder",
          value:
            "Failed to get ideas from the exploration agent. Please try again.",
          detail: error instanceof Error ? error.message : "Unknown error",
        }),
      );
    } finally {
      setIsLoadingIdeas(false);
      setThinkingBuffer("");
    }
  };

  useEffect(() => {
    if (mode === "agent") {
      setAgentIdeas([]);
    } else {
      setIdeas([]);
    }
  }, [tableId]);

  // Handle tab key press for auto-completion
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      if (prompt.trim() === "") {
        setPrompt(getQuestion());
      }
    } else if (event.key === "Enter" && prompt.trim() !== "") {
      event.preventDefault();
      focusNextChartRef.current = true;
      if (mode === "agent") {
        exploreDataFromNLWithStartingQuestion(prompt.trim());
      } else {
        deriveDataFromNL(prompt.trim());
      }
    }
  };

  const deriveDataFromNL = (
    instruction: string,
    promptSource: string = "user",
    preferredChartType?: string,
  ) => {
    // 🔍 DEBUG: Log chart type selection
    console.log(
      `🔍 deriveDataFromNL called with preferredChartType='${preferredChartType}'`,
    );

    // 🔧 Convert display name to internal chart type name
    const internalChartType = preferredChartType
      ? getInternalChartType(preferredChartType)
      : "";
    console.log(
      `🔧 Converted to internal type: display='${preferredChartType}' → internal='${internalChartType}'`,
    );

    if (selectedTableIds.length === 0 || instruction.trim() === "") {
      return;
    }

    // Log user prompt to backend
    logUserPrompt(instruction, "ChartRecBox", "interactive");

    let originateChartId: string;

    if (placeHolderChartId) {
      //dispatch(dfActions.updateChartType({chartType: "Auto", chartId: placeHolderChartId}));
      dispatch(
        dfActions.changeChartRunningStatus({
          chartId: placeHolderChartId,
          status: true,
        }),
      );
      originateChartId = placeHolderChartId;
    }

    const actionTables = selectedTableIds.map(
      (id) => tables.find((t) => t.id === id) as DictTable,
    );

    const actionId = `deriveDataFromNL_${String(Date.now())}`;
    dispatch(
      dfActions.updateAgentWorkInProgress({
        actionId: actionId,
        tableId: tableId,
        description: instruction,
        status: "running",
        hidden: false,
      }),
    );

    // Validate table selection
    const firstTableId = selectedTableIds[0];
    if (!firstTableId) {
      dispatch(
        dfActions.addMessages({
          timestamp: Date.now(),
          type: "error",
          component: "chart builder",
          value: "No table selected for data formulation.",
        }),
      );
      return;
    }

    // Generate table ID
    const genTableId = () => {
      let tableSuffix = Number.parseInt(
        (Date.now() - Math.floor(Math.random() * 10000)).toString().slice(-6),
      );
      let tableId = `table-${tableSuffix}`;
      while (tables.find((t) => t.id === tableId) !== undefined) {
        tableSuffix = tableSuffix + 1;
        tableId = `table-${tableSuffix}`;
      }
      return tableId;
    };

    setIsFormulating(true);

    const token = String(Date.now());
    let messageBody = JSON.stringify({
      token: token,
      mode: "formulate",
      input_tables: actionTables.map((t) => ({
        name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ""),
        rows: t.rows,
        attached_metadata: t.attachedMetadata,
      })),

      chart_type: "",
      chart_encodings: {},

      extra_prompt: instruction,
      model: activeModel,
      max_repair_attempts: config.maxRepairAttempts,
      agent_coding_rules: agentRules.coding,
      language: actionTables.some((t) => t.virtual) ? "sql" : "python",
      prompt_source: promptSource,
      user_preferred_chart_type: internalChartType,
    });
    let engine = getUrls().SMART_CHAT;

    if (currentTable && currentTable.derive?.dialog && !currentTable.anchored) {
      let sourceTableIds = currentTable.derive?.source;

      let startNewDialog =
        !sourceTableIds.every((id) => selectedTableIds.includes(id)) ||
        !selectedTableIds.every((id) => sourceTableIds.includes(id));

      // Compare if source and base table IDs are different
      if (startNewDialog) {
        let additionalMessages = currentTable.derive.dialog;

        // in this case, because table ids has changed, we need to use the additional messages and reformulate
        messageBody = JSON.stringify({
          token: token,
          mode: "formulate",
          input_tables: actionTables.map((t) => {
            return {
              name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ""),
              rows: t.rows,
              attached_metadata: t.attachedMetadata,
            };
          }),
          chart_type: "",
          chart_encodings: {},

          extra_prompt: instruction,
          model: activeModel,
          additional_messages: additionalMessages,
          max_repair_attempts: config.maxRepairAttempts,
          agent_coding_rules: agentRules.coding,
          language: actionTables.some((t) => t.virtual) ? "sql" : "python",
          prompt_source: promptSource,
          user_preferred_chart_type: internalChartType,
        });
        engine = getUrls().SMART_CHAT;
      } else {
        messageBody = JSON.stringify({
          token: token,
          mode: "formulate",
          input_tables: actionTables.map((t) => {
            return {
              name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ""),
              rows: t.rows,
              attached_metadata: t.attachedMetadata,
            };
          }),

          chart_type: "",
          chart_encodings: {},

          dialog: currentTable.derive?.dialog,
          latest_data_sample: currentTable.rows.slice(0, 10),
          new_instruction: instruction,
          model: activeModel,
          max_repair_attempts: config.maxRepairAttempts,
          agent_coding_rules: agentRules.coding,
          language: actionTables.some((t) => t.virtual) ? "sql" : "python",
          prompt_source: promptSource,
          user_preferred_chart_type: internalChartType,
        });
        engine = getUrls().REFINE_DATA;
      }
    }

    // 🔍 DEBUG: Log what's being sent to backend
    const parsedBody = JSON.parse(messageBody);
    console.log(
      `📤 Sending to backend: display='${preferredChartType}' → internal='${parsedBody.user_preferred_chart_type}'`,
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      config.formulateTimeoutSeconds * 1000,
    );

    fetch(engine, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: messageBody,
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((data) => {
        setIsFormulating(false);

        dispatch(
          dfActions.changeChartRunningStatus({
            chartId: originateChartId,
            status: false,
          }),
        );

        if (data["token"] === token) {
          if (data.action === "suggestion" || data.action === "confirm") {
            setAssistantMode(data.action === "suggestion" ? "SUGGESTION" : "CONFIRM");
            setAssistantTitle(
              data.action === "suggestion" ? "Gợi ý biểu đồ có thể vẽ ngay" : "Xác nhận cấu hình biểu đồ",
            );
            setAssistantMessage(
              data.action === "suggestion"
                ? "Chọn một gợi ý để vẽ nhanh hoặc dùng prompt mẫu."
                : "Prompt của bạn còn thiếu thông tin. Chọn cấu hình phù hợp để tiếp tục.",
            );
            setAssistantSuggestions(data.suggestions || []);
            setAssistantSamplePrompts([]);
            setAssistantInstruction(instruction);
            setAssistantOpen(true);
            dispatch(dfActions.deleteAgentWorkInProgress(actionId));
            return;
          }

          if (data.action === "info") {
            setAssistantMode("INFO");
            setAssistantTitle("Nội dung chưa phù hợp");
            setAssistantMessage(data.message || "Hãy thử một prompt liên quan tới biểu đồ.");
            setAssistantSuggestions([]);
            setAssistantSamplePrompts(data.sample_prompts || []);
            setAssistantInstruction(instruction);
            setAssistantOpen(true);
            dispatch(dfActions.deleteAgentWorkInProgress(actionId));
            return;
          }

          if (!data.results || data.results.length === 0) {
            dispatch(
              dfActions.addMessages({
                timestamp: Date.now(),
                type: "error",
                component: "chart builder",
                value: "Không có kết quả phù hợp từ hệ thống.",
              }),
            );
            dispatch(dfActions.deleteAgentWorkInProgress(actionId));
            return;
          }

          if (data.results.length > 0) {
            const candidates = data["results"].filter(
              (item: any) => item["status"] === "ok",
            );

            if (candidates.length === 0) {
              const rejected = data["results"].find(
                (item: any) => item["status"] === "rejected_incompatible",
              );
              if (rejected?.reject) {
                setAssistantMode("REJECT");
                setAssistantTitle("Biểu đồ không tương thích");
                setAssistantMessage(
                  rejected.reject.message_vi ||
                    "Yêu cầu hiện tại không phù hợp với dữ liệu.",
                );
                setAssistantSuggestions(
                  (rejected.reject.suggested_chart_types || []).map(
                    (ct: string) =>
                      ({
                        chart_type: ct,
                        encoding: {},
                        rationale_vi: "Đề xuất thay thế tương thích với dữ liệu hiện tại.",
                        sample_prompt_vi: `${instruction} (vẽ bằng ${ct})`,
                      }) as ChartSuggestion,
                  ),
                );
                setAssistantSamplePrompts([]);
                setAssistantInstruction(
                  rejected.reject.original_instruction || instruction,
                );
                setAssistantOpen(true);
                dispatch(dfActions.deleteAgentWorkInProgress(actionId));
                return;
              }

              const errorMessage = data.results[0].content;
              const code = data.results[0].code;

              dispatch(
                dfActions.addMessages({
                  timestamp: Date.now(),
                  type: "error",
                  component: "chart builder",
                  value: `Data formulation failed, please try again.`,
                  code: code,
                  detail: errorMessage,
                }),
              );
            } else {
              const candidate = candidates[0];
              const code = candidate["code"];
              const rows = candidate["content"]["rows"];
              const dialog = candidate["dialog"];
              const refinedGoal = candidate["refined_goal"];
              const displayInstruction = refinedGoal["display_instruction"];

              // 🔴 CHECK FOR COMPATIBILITY ERRORS FROM BACKEND VALIDATION
              if (refinedGoal["_chart_compatibility_error"]) {
                dispatch(
                  dfActions.addMessages({
                    timestamp: Date.now(),
                    type: "error",
                    component: "chart builder",
                    value: `⚠️ Selected chart type is not compatible with the generated data:`,
                    detail: refinedGoal["_chart_compatibility_error"],
                  }),
                );
                return; // Stop processing, don't create the chart
              }

              const candidateTableId = candidate["content"]["virtual"]
                ? candidate["content"]["virtual"]["table_name"]
                : genTableId();

              // Create new table
              const candidateTable = createDictTable(
                candidateTableId,
                rows,
                undefined, // No derive info for ChartRecBox - it's NL-driven without triggers
              );

              let refChart = generateFreshChart(tableId, "Auto") as Chart;
              refChart.source = "trigger";

              // Add derive info manually since ChartRecBox doesn't use triggers
              candidateTable.derive = {
                code: code,
                source: selectedTableIds,
                dialog: dialog,
                trigger: {
                  tableId: tableId,
                  sourceTableIds: selectedTableIds,
                  instruction: instruction,
                  displayInstruction: displayInstruction,
                  chart: refChart, // No upfront chart reference
                  resultTableId: candidateTableId,
                },
              };

              if (candidate["content"]["virtual"] != null) {
                candidateTable.virtual = {
                  tableId: candidate["content"]["virtual"]["table_name"],
                  rowCount: candidate["content"]["virtual"]["row_count"],
                };
              }

              dispatch(dfActions.insertDerivedTables(candidateTable));

              // Add missing concept items
              const names = candidateTable.names;
              const missingNames = names.filter(
                (name) =>
                  !conceptShelfItems.some((field) => field.name === name),
              );

              const conceptsToAdd = missingNames.map(
                (name) =>
                  ({
                    id: `concept-${name}-${Date.now()}`,
                    name: name,
                    type: "auto" as Type,
                    description: "",
                    source: "custom",
                    tableRef: "custom",
                    temporary: true,
                  } as FieldItem),
              );

              dispatch(dfActions.addConceptItems(conceptsToAdd));
              dispatch(fetchFieldSemanticType(candidateTable));
              dispatch(fetchCodeExpl(candidateTable));

              // Create proper chart based on refined goal
              const currentConcepts = [
                ...conceptShelfItems.filter((c) => names.includes(c.name)),
                ...conceptsToAdd,
              ];

              let newChart = resolveRecommendedChart(
                refinedGoal,
                currentConcepts,
                candidateTable,
              );

              // Directly add the chart
              dispatch(dfActions.addChart(newChart));
              if (focusNextChartRef.current || AUTO_FOCUS_NEW_CHART) {
                focusNextChartRef.current = false;
                dispatch(dfActions.setFocusedChart(newChart.id));
                dispatch(dfActions.setFocusedTable(candidateTable.id));
              }

              dispatch(
                dfActions.addMessages({
                  timestamp: Date.now(),
                  component: "chart builder",
                  type: "success",
                  value: `Data formulation: "${displayInstruction}"`,
                }),
              );

              dispatch(dfActions.deleteAgentWorkInProgress(actionId));

              // Clear the prompt after successful formulation
              setPrompt("");
            }
          }
        } else {
          dispatch(
            dfActions.addMessages({
              timestamp: Date.now(),
              component: "chart builder",
              type: "error",
              value:
                "No result is returned from the data formulation agent. Please try again.",
            }),
          );

          setIsFormulating(false);
          dispatch(dfActions.deleteAgentWorkInProgress(actionId));
        }
      })
      .catch((error) => {
        setIsFormulating(false);
        dispatch(
          dfActions.changeChartRunningStatus({
            chartId: originateChartId,
            status: false,
          }),
        );

        if (error.name === "AbortError") {
          dispatch(
            dfActions.addMessages({
              timestamp: Date.now(),
              component: "chart builder",
              type: "error",
              value: `Data formulation timed out after ${config.formulateTimeoutSeconds} seconds. Consider breaking down the task, using a different model or prompt, or increasing the timeout limit.`,
              detail: "Request exceeded timeout limit",
            }),
          );
          dispatch(dfActions.deleteAgentWorkInProgress(actionId));
        } else {
          dispatch(
            dfActions.addMessages({
              timestamp: Date.now(),
              component: "chart builder",
              type: "error",
              value: `Data formulation failed, please try again.`,
              detail: error.message,
            }),
          );
          dispatch(dfActions.deleteAgentWorkInProgress(actionId));
        }
      });
  };

  const exploreDataFromNLWithStartingQuestion = (startingQuestion: string) => {
    // Log user prompt to backend
    logUserPrompt(startingQuestion, "ChartRecBox", "agent");

    getIdeasFromAgent(
      "agent",
      `starting question: ${startingQuestion}\n\n generate only one question group that contains a deepdive question with 3 steps based on the starting question`,
      true,
      startingQuestion,
    );
  };

  const exploreDataFromNL = (initialPlan: string[]) => {
    let actionId = `exploreDataFromNL_${String(Date.now())}`;

    console.log("initialPlan", initialPlan);

    if (
      selectedTableIds.length === 0 ||
      initialPlan.length === 0 ||
      initialPlan[0].trim() === ""
    ) {
      return;
    }

    setIsFormulating(true);
    dispatch(
      dfActions.updateAgentWorkInProgress({
        actionId: actionId,
        tableId: tableId,
        description: initialPlan[0],
        status: "running",
        hidden: false,
      }),
    );

    let actionTables = selectedTableIds.map(
      (id) => tables.find((t) => t.id === id) as DictTable,
    );

    const token = String(Date.now());
    let messageBody = JSON.stringify({
      token: token,
      input_tables: actionTables.map((t) => ({
        name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ""),
        rows: t.rows,
        attached_metadata: t.attachedMetadata,
      })),
      initial_plan: initialPlan,
      model: activeModel,
      max_iterations: 3,
      max_repair_attempts: config.maxRepairAttempts,
      agent_exploration_rules: agentRules.exploration,
      agent_coding_rules: agentRules.coding,
      language: actionTables.some((t) => t.virtual) ? "sql" : "python",
      prompt_source: "agent",
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      config.formulateTimeoutSeconds * 6 * 1000,
    );

    // State for accumulating streaming results
    let allResults: any[] = [];
    let createdTables: DictTable[] = [];
    let createdCharts: Chart[] = [];
    let allNewConcepts: FieldItem[] = [];
    let isCompleted = false;

    // Generate table ID helper
    const genTableId = () => {
      let tableSuffix = Number.parseInt(
        (Date.now() - Math.floor(Math.random() * 10000)).toString().slice(-6),
      );
      let tableId = `table-${tableSuffix}`;
      while (tables.find((t) => t.id === tableId) !== undefined) {
        tableSuffix = tableSuffix + 1;
        tableId = `table-${tableSuffix}`;
      }
      return tableId;
    };

    // Function to process a single streaming result
    const processStreamingResult = (result: any) => {
      if (result.type === "planning") {
        dispatch(
          dfActions.updateAgentWorkInProgress({
            actionId: actionId,
            description: result.content.message,
            status: "running",
            hidden: false,
          }),
        );
      }

      if (
        result.type === "data_transformation" &&
        result.status === "success"
      ) {
        // Extract from the new structure: content.result instead of transform_result
        const transformResult = result.content.result;

        if (!transformResult || transformResult.status !== "ok") {
          return; // Skip failed transformations
        }

        const transformedData = transformResult.content;
        const code = transformResult.code;
        const dialog = transformResult.dialog;
        const refinedGoal = transformResult.refined_goal;
        const question = result.content.question;

        if (
          !transformedData ||
          !transformedData.rows ||
          transformedData.rows.length === 0
        ) {
          return; // Skip empty results
        }

        const rows = transformedData.rows;
        const candidateTableId =
          transformedData.virtual?.table_name || genTableId();
        const displayInstruction =
          refinedGoal?.display_instruction ||
          `Exploration step ${createdTables.length + 1}: ${question}`;

        // Determine the trigger table and source tables for this iteration
        const isFirstIteration = createdTables.length === 0;
        const triggerTableId = isFirstIteration
          ? tableId
          : createdTables[createdTables.length - 1].id;

        // Create new table
        const candidateTable = createDictTable(
          candidateTableId,
          rows,
          undefined, // No derive info initially
        );

        // Add derive info manually for exploration results
        candidateTable.derive = {
          code: code || `# Exploration step ${createdTables.length + 1}`,
          source: selectedTableIds,
          dialog: dialog || [],
          trigger: {
            tableId: triggerTableId,
            sourceTableIds: selectedTableIds,
            instruction: question,
            displayInstruction: displayInstruction,
            chart: undefined, // Will be set after chart creation
            resultTableId: candidateTableId,
          },
        };

        if (transformedData.virtual) {
          candidateTable.virtual = {
            tableId: transformedData.virtual.table_name,
            rowCount: transformedData.virtual.row_count,
          };
        }

        createdTables.push(candidateTable);

        dispatch(
          dfActions.updateAgentWorkInProgress({
            actionId: actionId,
            tableId: candidateTable.id,
            description: "",
            status: "running",
            hidden: false,
          }),
        );

        // Add missing concept items for this table
        const names = candidateTable.names;
        const missingNames = names.filter(
          (name) =>
            !conceptShelfItems.some((field) => field.name === name) &&
            !allNewConcepts.some((concept) => concept.name === name),
        );

        const conceptsToAdd = missingNames.map(
          (name) =>
            ({
              id: `concept-${name}-${Date.now()}-${Math.random()}`,
              name: name,
              type: "auto" as Type,
              description: "",
              source: "custom",
              tableRef: "custom",
              temporary: true,
            } as FieldItem),
        );

        allNewConcepts.push(...conceptsToAdd);

        // Create trigger chart for derive info
        let triggerChart = generateFreshChart(
          actionTables[0].id,
          "Auto",
        ) as Chart;
        triggerChart.source = "trigger";

        // Update the derive trigger to reference the trigger chart
        if (candidateTable.derive) {
          candidateTable.derive.trigger.chart = triggerChart;
        }

        // Resolve chart fields for regular chart if we have them
        if (refinedGoal) {
          const currentConcepts = [
            ...conceptShelfItems.filter((c) => names.includes(c.name)),
            ...allNewConcepts,
            ...conceptsToAdd,
          ];
          let newChart = resolveRecommendedChart(
            refinedGoal,
            currentConcepts,
            candidateTable,
          );
          createdCharts.push(newChart);

          dispatch(dfActions.addChart(newChart));
          if (focusNextChartRef.current || AUTO_FOCUS_NEW_CHART) {
            focusNextChartRef.current = false; // Immediate, synchronous update
            dispatch(dfActions.setFocusedChart(newChart.id));
            dispatch(dfActions.setFocusedTable(candidateTable.id));
          }
        }

        // Immediately add the new concepts, table, and chart to the state
        if (conceptsToAdd.length > 0) {
          dispatch(dfActions.addConceptItems(conceptsToAdd));
        }

        dispatch(dfActions.insertDerivedTables(candidateTable));
        dispatch(fetchFieldSemanticType(candidateTable));
        dispatch(fetchCodeExpl(candidateTable));

        // Show progress message
        dispatch(
          dfActions.addMessages({
            timestamp: Date.now(),
            component: "chart builder",
            type: "info",
            value: `Exploration step ${createdTables.length} completed: ${displayInstruction}`,
          }),
        );
      }
    };

    // Function to handle completion
    const handleCompletion = () => {
      if (isCompleted) return;
      isCompleted = true;

      console.log("in completion state");

      setIsFormulating(false);
      clearTimeout(timeoutId);

      const completionResult = allResults.find(
        (result: any) => result.type === "completion",
      );

      console.log("completionResult", completionResult);
      if (completionResult) {
        // Get completion message from completion result if available
        let summary = completionResult.content.message || "";
        let status: "running" | "completed" | "warning" | "failed" =
          completionResult.status === "success" ? "completed" : "warning";

        dispatch(
          dfActions.updateAgentWorkInProgress({
            actionId: actionId,
            description: summary,
            status: status,
            hidden: false,
          }),
        );

        let completionMessage = `Data exploration completed.`;

        dispatch(
          dfActions.addMessages({
            timestamp: Date.now(),
            component: "chart builder",
            type: "success",
            value: completionMessage,
          }),
        );

        // Clear the prompt after successful exploration
        setPrompt("");
      } else {
        dispatch(
          dfActions.updateAgentWorkInProgress({
            actionId: actionId,
            description: "The agent got lost in the data.",
            status: "warning",
            hidden: false,
          }),
        );

        dispatch(
          dfActions.addMessages({
            timestamp: Date.now(),
            component: "chart builder",
            type: "error",
            value: "The agent got lost in the data. Please try again.",
          }),
        );
      }
    };

    // // Log the final prompt being sent to LLM
    // console.log(
    //   "================================================================================"
    // );
    // console.log("[FINAL PROMPT SENT TO LLM - exploreDataFromNL]");
    // console.log(
    //   "================================================================================"
    // );
    // console.log("Engine:", getUrls().EXPLORE_DATA_STREAMING);
    // console.log("Message Body:", JSON.parse(messageBody));
    // console.log(
    //   "================================================================================\n"
    // );

    fetch(getUrls().EXPLORE_DATA_STREAMING, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: messageBody,
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body reader available");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              handleCompletion();
              break;
            }

            buffer += decoder.decode(value, { stream: true });

            // Split by newlines to get individual JSON objects
            const lines = buffer.split("\n");
            buffer = lines.pop() || ""; // Keep the last incomplete line in buffer

            // should be only one message per line
            for (let line of lines) {
              if (line.trim() !== "") {
                try {
                  const data = JSON.parse(line);
                  if (data.token === token) {
                    if (data.status === "ok" && data.result) {
                      allResults.push(data.result);

                      processStreamingResult(data.result);

                      // Check if this is a completion result
                      if (data.result.type === "completion") {
                        handleCompletion();
                        return;
                      }
                    } else if (data.status === "error") {
                      setIsFormulating(false);
                      clearTimeout(timeoutId);

                      // Clean up the inprogress thinking when streaming fails
                      dispatch(
                        dfActions.updateAgentWorkInProgress({
                          actionId: actionId,
                          description:
                            data.error_message ||
                            "Error during data exploration",
                          status: "failed",
                          hidden: false,
                        }),
                      );

                      dispatch(
                        dfActions.addMessages({
                          timestamp: Date.now(),
                          component: "chart builder",
                          type: "error",
                          value:
                            data.error_message ||
                            "Error during data exploration. Please try again.",
                        }),
                      );
                      return;
                    }
                  }
                } catch (parseError) {
                  console.warn(
                    "Failed to parse streaming response:",
                    parseError,
                  );
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      })
      .catch((error) => {
        setIsFormulating(false);
        clearTimeout(timeoutId);

        // Clean up the inprogress thinking when network errors occur
        const errorMessage =
          error.name === "AbortError"
            ? "Data exploration timed out"
            : `Data exploration failed: ${error.message}`;
        dispatch(
          dfActions.updateAgentWorkInProgress({
            actionId: actionId,
            description: errorMessage,
            status: "failed",
            hidden: false,
          }),
        );

        if (error.name === "AbortError") {
          dispatch(
            dfActions.addMessages({
              timestamp: Date.now(),
              component: "chart builder",
              type: "error",
              value: "Data exploration timed out. Please try again.",
              detail: error.message,
            }),
          );
        } else {
          dispatch(
            dfActions.addMessages({
              timestamp: Date.now(),
              component: "chart builder",
              type: "error",
              value: `Data exploration failed: ${error.message}`,
              detail: error.message,
            }),
          );
        }
      });
  };

  const showTableSelector = availableTables.length > 1 && currentTable;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", ...sx }}>
      <Card
        variant="outlined"
        sx={{
          padding: 2,
          maxWidth: "600px",
          display: "flex",
          flexDirection: "column",
          gap: 1,
          position: "relative",
          borderColor: alpha(modeColor, 0.5),
          animation: "glowInteractive 2s ease-in-out infinite alternate",
          "@keyframes glowInteractive": {
            "0%": {
              boxShadow: `0 0 5px 0 ${alpha(modeColor, 0.1)}`,
            },
            "100%": {
              boxShadow: `0 0 10px 0 ${alpha(modeColor, 0.3)}, 0 0 10px 0 ${alpha(modeColor, 0.3)}`,
            },
          },
        }}
      >
        {isFormulating && (
          <LinearProgress
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              zIndex: 1000,
              height: "4px",
              backgroundColor: alpha(modeColor, 0.2),
              "& .MuiLinearProgress-bar": {
                backgroundColor: modeColor,
              },
            }}
          />
        )}
        {showTableSelector && (
          <Box>
            <NLTableSelector
              selectedTableIds={selectedTableIds}
              tables={availableTables}
              updateSelectedTableIds={handleTableSelectionChange}
              requiredTableIds={[tableId]}
            />
          </Box>
        )}

        <Box
          sx={{
            display: "flex",
            flexDirection: "row",
            gap: 1,
            alignItems: "flex-end",
          }}
        >
          <TextField
            sx={{
              flex: 1,
              "& .MuiInputLabel-root": { fontSize: "14px" },
              "& .MuiInputLabel-root.Mui-focused": {
                color: modeColor,
              },
              "& .MuiInput-input": { fontSize: "14px" },
              "& .MuiInput-underline:before": {
                borderBottomColor: alpha(modeColor, 0.42),
              },
              "& .MuiInput-underline:hover:not(.Mui-disabled):before": {
                borderBottomColor: modeColor,
              },
              "& .MuiInput-underline:after": {
                borderBottomColor: modeColor,
              },
            }}
            disabled={isFormulating || isLoadingIdeas}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handleKeyDown}
            slotProps={{
              inputLabel: { shrink: true },
              input: {
                endAdornment: (
                  <Tooltip title="Generate chart from description">
                    <span>
                      <IconButton
                        size="medium"
                        disabled={
                          isFormulating ||
                          isLoadingIdeas ||
                          !currentTable ||
                          prompt.trim() === ""
                        }
                        sx={{
                          color: modeColor,
                          "&:hover": {
                            backgroundColor: alpha(modeColor, 0.08),
                          },
                        }}
                        onClick={() => {
                          focusNextChartRef.current = true;
                          if (mode === "agent") {
                            exploreDataFromNLWithStartingQuestion(
                              prompt.trim(),
                            );
                          } else {
                            deriveDataFromNL(prompt.trim());
                          }
                        }}
                      >
                        {isFormulating ? (
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <CircularProgress
                              size={24}
                              sx={{ color: modeColor }}
                            />
                          </Box>
                        ) : mode === "agent" ? (
                          <MovingIcon
                            sx={{ transform: "rotate(90deg)", fontSize: 24 }}
                          />
                        ) : (
                          <PrecisionManufacturing sx={{ fontSize: 24 }} />
                        )}
                      </IconButton>
                    </span>
                  </Tooltip>
                ),
              },
            }}
            value={prompt}
            label={
              mode === "agent"
                ? "Where should the agent go?"
                : "What do you want to explore?"
            }
            placeholder={`${getQuestion()}`}
            fullWidth
            multiline
            variant="standard"
            maxRows={4}
            minRows={1}
          />
          {<Divider orientation="vertical" flexItem />}
          {
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                gap: 0.5,
                my: 1,
              }}
            >
              <Typography
                sx={{
                  fontSize: 10,
                  color: "text.secondary",
                  marginBottom: 0.5,
                }}
              >
                ideas?
              </Typography>
              <Tooltip title="Get some ideas!">
                <span>
                  <IconButton
                    size="medium"
                    disabled={isFormulating || isLoadingIdeas || !currentTable}
                    sx={{
                      color: modeColor,
                      "&:hover": {
                        backgroundColor: alpha(modeColor, 0.08),
                      },
                    }}
                    onClick={() => getIdeasFromAgent(mode)}
                  >
                    {isLoadingIdeas ? (
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <CircularProgress size={24} sx={{ color: modeColor }} />
                      </Box>
                    ) : (
                      <TipsAndUpdatesIcon
                        sx={{
                          fontSize: 24,
                          animation:
                            ideas.length == 0
                              ? "colorWipe 5s ease-in-out infinite"
                              : "none",
                          "@keyframes colorWipe": {
                            "0%, 90%": {
                              scale: 1,
                            },
                            "95%": {
                              scale: 1.2,
                            },
                            "100%": {
                              scale: 1,
                            },
                          },
                        }}
                      />
                    )}
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          }
        </Box>
        {/* Ideas Chips Section */}
        {mode === "interactive" && (ideas.length > 0 || thinkingBuffer) && (
          <Box>
            {ideas.length > 0 && (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  marginBottom: 1,
                }}
              >
                <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                  ideas
                </Typography>
              </Box>
            )}
            <Box
              sx={{
                display: "flex",
                flexWrap: "wrap",
                gap: 0.5,
              }}
            >
              {ideas.map((idea, index) => (
                <IdeaChip
                  mini
                  key={index}
                  idea={idea}
                  theme={theme}
                  onClick={(chartType) => {
                    focusNextChartRef.current = true;
                    setPrompt(idea.text);
                    deriveDataFromNL(idea.text, "idea", chartType);
                  }}
                  disabled={isFormulating}
                  customChartTypes={idea.isQcIdea ? QC_CHART_TYPES : undefined}
                  sx={{
                    width: "46%",
                  }}
                />
              ))}
              {isLoadingIdeas && thinkingBuffer && thinkingBufferEffect}
            </Box>
          </Box>
        )}
        {mode === "agent" && (agentIdeas.length > 0 || thinkingBuffer) && (
          <Box>
            {agentIdeas.length > 0 && (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  marginBottom: 1,
                }}
              >
                <Typography
                  sx={{
                    fontSize: 12,
                    color: "text.secondary",
                    ".MuiSvgIcon-root": {
                      cursor: "help",
                      transform: "rotate(90deg)",
                      verticalAlign: "middle",
                      fontSize: 12,
                    },
                  }}
                >
                  directions{" "}
                  <Tooltip title="deep dive">
                    <MovingIcon />
                  </Tooltip>{" "}
                  <Tooltip title="branch">
                    <CallSplitIcon />
                  </Tooltip>
                </Typography>
              </Box>
            )}
            <Box
              sx={{
                display: "flex",
                flexWrap: "wrap",
                gap: 0.5,
                marginBottom: 1,
              }}
            >
              {agentIdeas.map((idea, index) => (
                <AgentIdeaChip
                  mini
                  key={index}
                  idea={idea}
                  theme={theme}
                  onClick={() => {
                    focusNextChartRef.current = true;
                    exploreDataFromNL(idea.depth_questions);
                    idea.breadth_questions.forEach((question, index) => {
                      setTimeout(() => {
                        setPrompt(question);
                        deriveDataFromNL(question, "idea");
                      }, (index + 1) * 1000); // 1000ms delay between each call
                    });
                  }}
                  disabled={isFormulating}
                  sx={{
                    width: "46%",
                  }}
                />
              ))}
              {isLoadingIdeas && thinkingBuffer && thinkingBufferEffect}
            </Box>
          </Box>
        )}
      </Card>
      <ChartAssistantModal
        open={assistantOpen}
        mode={assistantMode}
        title={assistantTitle}
        message={assistantMessage}
        suggestions={assistantSuggestions}
        samplePrompts={assistantSamplePrompts}
        onClose={() => setAssistantOpen(false)}
        onDrawNow={(suggestion) => {
          setAssistantOpen(false);
          focusNextChartRef.current = true;
          const nextInstruction =
            suggestion.sample_prompt_vi || assistantInstruction || prompt;
          setPrompt(nextInstruction);
          deriveDataFromNL(nextInstruction, "user", suggestion.chart_type);
        }}
        onUsePrompt={(suggestion) => {
          const nextInstruction =
            suggestion.sample_prompt_vi ||
            `${assistantInstruction || prompt} (vẽ bằng ${suggestion.chart_type})`;
          setPrompt(nextInstruction);
          setAssistantOpen(false);
        }}
      />
    </Box>
  );
};
