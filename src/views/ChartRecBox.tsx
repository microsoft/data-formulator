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
import { logTelemetryEvent } from "../utils/telemetryLogger";

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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  alpha,
  useTheme,
  Theme,
  Button,
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
  // Display Name â†’ Internal Type (as expected by LLM system prompt)
  Table: "table",
  Auto: "auto",
  "Scatter Plot": "point",
  "Linear Regression": "linear_regression",
  "Loess Regression": "loess",
  "Ranged Dot Plot": "ranged_dot_plot",
  Boxplot: "boxplot",
  "Bar Chart": "bar",
  "Pyramid Chart": "bar",
  "Grouped Bar Chart": "group_bar",
  "Stacked Bar Chart": "group_bar",
  Histogram: "histogram",
  "Threshold Bar Chart": "threshold",
  "Line Chart": "line",
  "Dotted Line Chart": "line",
  "Rolling Average": "rolling_average",
  "Heat Map": "heatmap",
  "Pie Chart": "pie",
  "Radial Plot": "radial_plot",
  "Bubble Plot": "bubble",
  "Area Chart": "area",
  Waterfall: "waterfall",
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

const ONBOARDING_STORAGE_KEY = "df_chart_onboarding_seen_v1";
const QC_SAMPLE_PROMPTS = [
  "Draw a QC trend line ",
  "Draw a QC histogram",
  "Draw a QC trend bar",
];
const GENERIC_SAMPLE_PROMPTS = [
  "Draw a bar chart comparing revenue by month",
  "Draw a line chart showing revenue over time",
  "Draw a scatter plot showing the relationship between price and quantity",
];
const QC_CONTROL_LIMIT_COLS = new Set(["TARGET", "LL", "UL", "ARLL", "ARUL"]);

const buildPieRecoverySuggestions = (rows: any[]): ChartSuggestion[] => {
  if (!rows || rows.length === 0) return [];
  const sample = rows.slice(0, 300);
  const cols = Object.keys(sample[0] || {});
  const categorical: string[] = [];
  const quantitative: string[] = [];

  cols.forEach((col) => {
    const upper = col.toUpperCase();
    if (QC_CONTROL_LIMIT_COLS.has(upper) || upper === "INDEX") {
      return;
    }
    const values = sample
      .map((r) => r?.[col])
      .filter((v) => v !== null && v !== undefined && v !== "");
    if (values.length === 0) return;

    const isNumeric = values.every(
      (v) => typeof v === "number" || (!Number.isNaN(Number(v)) && v !== ""),
    );
    if (isNumeric) quantitative.push(col);

    const uniq = new Set(values.map((v) => String(v))).size;
    if (uniq >= 2 && uniq <= 12) categorical.push(col);
  });

  if (categorical.length === 0 || quantitative.length === 0) return [];

  const suggestions: ChartSuggestion[] = [];
  for (const c of categorical.slice(0, 3)) {
    for (const q of quantitative.slice(0, 2)) {
      if (c === q) continue;
      suggestions.push({
        chart_type: "Pie Chart",
        encoding: { theta: q, color: c },
        rationale_vi: `Group by ${c}, use ${q} as pie value.`,
        sample_prompt_vi: `Draw a Pie Chart for ${q} share by ${c}`,
      });
      if (suggestions.length >= 4) return suggestions;
    }
  }
  return suggestions;
};

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

const inferPreferredChartTypeFromInstruction = (
  instruction: string,
): string | undefined => {
  const text = (instruction || "").toLowerCase();
  if (!text.trim()) return undefined;

  const displayNames = Object.keys(CHART_NAME_TO_INTERNAL_TYPE).sort(
    (a, b) => b.length - a.length,
  );
  const matchedDisplay = displayNames.find((name) =>
    text.includes(name.toLowerCase()),
  );
  if (matchedDisplay) return matchedDisplay;

  const internalToDisplay = Object.entries(CHART_NAME_TO_INTERNAL_TYPE).reduce(
    (acc, [display, internal]) => {
      acc[internal.toLowerCase()] = display;
      return acc;
    },
    {} as Record<string, string>,
  );
  const matchedInternal = Object.keys(internalToDisplay).find((name) =>
    text.includes(name),
  );
  return matchedInternal ? internalToDisplay[matchedInternal] : undefined;
};

// Generate available chart types from CHART_TEMPLATES in the system
const getAvailableChartTypes = (): { value: string; label: string }[] => {
  const chartTypes: { value: string; label: string }[] = [];
  Object.entries(CHART_TEMPLATES).forEach(([cls, templates]) => {
    templates.forEach((t) => {
      if (t.chart && t.chart !== "Auto") {
        chartTypes.push({
          value: t.chart, // ðŸ”§ Use actual chart name, not hyphenated version
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
    predictedEncoding?: Record<string, string>;
  };
  theme: Theme;
  onClick: (
    chartType?: string,
    encodings?: Record<string, string>,
  ) => void;
  sx?: SxProps;
  disabled?: boolean;
  /** Override the dropdown chart type list (e.g. for QC chips) */
  customChartTypes?: { value: string; label: string }[];
}> = function ({ mini, idea, theme, onClick, sx, disabled, customChartTypes }) {
  const systemChartTypes = getAvailableChartTypes();
  const availableChartTypes = customChartTypes ?? systemChartTypes;

  const getPreferredChartType = (): string => {
    if (idea.predictedChartType) {
      const matched = availableChartTypes.find(
        (ct) =>
          ct.label.toLowerCase() === idea.predictedChartType!.toLowerCase(),
      );
      if (matched) return matched.value;
    }
    return availableChartTypes.length > 0 ? availableChartTypes[0].value : "";
  };

  const getDifficultyColor = (difficulty: "easy" | "medium" | "hard") => {
    switch (difficulty) {
      case "easy":
        return theme.palette.info.main;
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
    )?.value === getPreferredChartType();

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
      {/* Goal text â€” click to execute */}
      <Box
        onClick={
          disabled
            ? undefined
            : () => {
                onClick(getPreferredChartType(), idea.predictedEncoding || {});
              }
        }
        sx={{ width: "100%", cursor: disabled ? "default" : "pointer" }}
      >
        <Typography
          component="div"
          sx={{
            fontSize: "11px",
            color: theme.palette.text.primary,
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

  const focusNextChartRef = useRef<boolean>(true);

  // Color map for different modes - easy to customize!
  const modeColor = theme.palette.secondary.main;

  const [prompt, setPrompt] = useState<string>("");
  const [isFormulating, setIsFormulating] = useState<boolean>(false);
  const [assistantOpen, setAssistantOpen] = useState<boolean>(false);
  const [assistantMode, setAssistantMode] =
    useState<ChartAssistantMode>("SUGGESTION");
  const [assistantTitle, setAssistantTitle] = useState<string>(
    "Chart suggestions",
  );
  const [assistantMessage, setAssistantMessage] = useState<string>("");
  const [assistantInstruction, setAssistantInstruction] = useState<string>("");
  const [assistantSuggestions, setAssistantSuggestions] = useState<
    ChartSuggestion[]
  >([]);
  const [assistantSamplePrompts, setAssistantSamplePrompts] = useState<
    string[]
  >([]);
  const [assistantHasAction, setAssistantHasAction] = useState<boolean>(false);
  const [onboardingOpen, setOnboardingOpen] = useState<boolean>(false);
  const [ideas, setIdeas] = useState<
    {
      text: string;
      goal: string;
      difficulty: "easy" | "medium" | "hard";
      predictedChartType?: string;
      isQcIdea?: boolean;
      predictedEncoding?: Record<string, string>;
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
  const isCurrentQc = isQcData(currentTable?.names || []);
  const domainSamplePrompts = isCurrentQc
    ? QC_SAMPLE_PROMPTS
    : GENERIC_SAMPLE_PROMPTS;

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
    return domainSamplePrompts[0];
  };

  // Get chart ideas from Smart Chat (same backend logic as normal prompt flow).
  const getIdeasFromAgent = async () => {
    if (!currentTable || isLoadingIdeas) {
      return;
    }

    setIsLoadingIdeas(true);
    setThinkingBuffer("");
    setIdeas([]);

    try {
      let sourceTables = selectedTableIds.map(
        (id) => tables.find((t) => t.id === id) as DictTable,
      );

      const tableNames = currentTable?.names ?? [];
      const defaultIdeaPrompt = isQcData(tableNames)
        ? "Suggest the best charts for this QC data."
        : "Suggest charts I can draw with this data.";

      const messageBody = JSON.stringify({
        token: String(Date.now()),
        model: activeModel,
        extra_prompt: defaultIdeaPrompt,
        input_tables: sourceTables.map((t) => ({
          name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ""),
          rows: t.rows,
          attached_metadata: t.attachedMetadata,
        })),
        language: currentTable.virtual ? "sql" : "python",
      });

      const engine = getUrls().SMART_CHAT;
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

      const data = await response.json();
      const suggestions: ChartSuggestion[] = data.suggestions || [];
      const mappedIdeas = suggestions.slice(0, 6).map((s) => {
        const baseText =
          s.sample_prompt_vi ||
          s.rationale_vi ||
          `Draw ${s.chart_type}`;
        return {
          text: baseText,
          goal: baseText,
          difficulty: "easy" as const,
          predictedChartType: s.chart_type,
          isQcIdea: QC_CHART_TYPES.some((q) => q.value === s.chart_type),
          predictedEncoding: s.encoding || {},
        };
      });

      setIdeas(mappedIdeas);
    } catch (error) {
      console.error("Error getting ideas from agent:", error);
      dispatch(
        dfActions.addMessages({
          timestamp: Date.now(),
          type: "error",
          component: "chart builder",
          value: "Failed to get ideas. Please try again.",
          detail: error instanceof Error ? error.message : "Unknown error",
        }),
      );
    } finally {
      setIsLoadingIdeas(false);
      setThinkingBuffer("");
    }
  };

  useEffect(() => {
    setIdeas([]);
  }, [tableId]);

  useEffect(() => {
    if (!currentTable) {
      return;
    }
    const seen = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!seen) {
      setOnboardingOpen(true);
    }
  }, [currentTable?.id]);

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
      deriveDataFromNL(prompt.trim());
    }
  };

  const deriveDataFromNL = (
    instruction: string,
    promptSource: string = "user",
    preferredChartType?: string,
    preferredChartEncodings?: Record<string, string>,
  ) => {
    const effectivePreferredChartType =
      preferredChartType || inferPreferredChartTypeFromInstruction(instruction);

    // DEBUG: Log chart type selection
    console.log(
      `[deriveDataFromNL] preferredChartType='${effectivePreferredChartType}'`,
    );

    // Convert display name to internal chart type name
    const internalChartType = effectivePreferredChartType
      ? getInternalChartType(effectivePreferredChartType)
      : "";
    console.log(
      `[deriveDataFromNL] mapped chart type: display='${effectivePreferredChartType}' -> internal='${internalChartType}'`,
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
    const canonicalColumnMap = new Map<string, string>();
    actionTables.forEach((t) => {
      const names =
        t.names && t.names.length > 0
          ? t.names
          : Object.keys((t.rows && t.rows[0]) || {});
      names.forEach((name) => {
        canonicalColumnMap.set(String(name).toLowerCase(), String(name));
      });
    });
    const normalizedPreferredEncodings = Object.fromEntries(
      Object.entries(preferredChartEncodings || {})
        .map(([channel, value]) => {
          if (typeof value !== "string" || value.trim().length === 0) {
            return null;
          }
          const canonical = canonicalColumnMap.get(value.trim().toLowerCase());
          return canonical ? [channel, canonical] : null;
        })
        .filter((entry): entry is [string, string] => entry !== null),
    );
    let messageBody = JSON.stringify({
      token: token,
      mode: "formulate",
      input_tables: actionTables.map((t) => ({
        name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/, ""),
        rows: t.rows,
        attached_metadata: t.attachedMetadata,
      })),

      chart_type: internalChartType || "",
      chart_encodings: normalizedPreferredEncodings,

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
          chart_type: internalChartType || "",
          chart_encodings: normalizedPreferredEncodings,

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

          chart_type: internalChartType || "",
          chart_encodings: normalizedPreferredEncodings,

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

    // DEBUG: Log what's being sent to backend
    const parsedBody = JSON.parse(messageBody);
    console.log(
      `[deriveDataFromNL] sending to backend: display='${effectivePreferredChartType}' -> internal='${parsedBody.user_preferred_chart_type}'`,
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
          if (
            data.action === "suggestion" ||
            data.action === "suggest" ||
            data.action === "confirm" ||
            data.action === "qc_suggest"
          ) {
            const mode =
              data.action === "qc_suggest"
                ? "QC_SUGGEST"
                : data.action === "suggest" || data.action === "suggestion"
                ? "SUGGESTION"
                : "CONFIRM";
            setAssistantMode(mode);
            setAssistantTitle(
              data.action === "qc_suggest"
                ? "QC Charts"
                : data.action === "suggest" || data.action === "suggestion"
                ? "Chart suggestions you can draw now"
                : "Confirm chart configuration",
            );
            setAssistantMessage(
              data.message_vi || "Choose a suitable chart:",
            );
            setAssistantSuggestions(data.suggestions || []);
            setAssistantSamplePrompts([]);
            setAssistantInstruction(instruction);
            setAssistantHasAction(false);
            setAssistantOpen(true);
            logTelemetryEvent("prompt_classified", {
              category: data.category || "UNKNOWN",
              confidence: data.confidence,
              source: "smart_chat",
            });
            dispatch(dfActions.deleteAgentWorkInProgress(actionId));
            return;
          }

          if (data.action === "info") {
            setAssistantMode("INFO");
            setAssistantTitle("Content not applicable");
            setAssistantMessage(
              data.message_vi ||
                data.message ||
                "Try a prompt related to charts.",
            );
            setAssistantSuggestions(data.suggestions || []);
            setAssistantSamplePrompts(data.sample_prompts || []);
            setAssistantInstruction(instruction);
            setAssistantHasAction(false);
            setAssistantOpen(true);
            logTelemetryEvent("prompt_classified", {
              category: data.category || "OFF_TOPIC",
              confidence: data.confidence,
              source: "smart_chat",
            });
            dispatch(dfActions.deleteAgentWorkInProgress(actionId));
            return;
          }
          if (!data.results || data.results.length === 0) {
            dispatch(
              dfActions.addMessages({
                timestamp: Date.now(),
                type: "error",
                component: "chart builder",
                value: "No suitable result returned from the system.",
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
                const lowerInstruction = (instruction || "").toLowerCase();
                const isPieRequest =
                  lowerInstruction.includes("pie") ||
                  lowerInstruction.includes("donut") ||
                  String(rejected.reject.message_vi || "")
                    .toLowerCase()
                    .includes("pie");
                const pieRecoverySuggestions = isPieRequest
                  ? buildPieRecoverySuggestions(currentTable?.rows || [])
                  : [];
                setAssistantMode("REJECT");
                setAssistantTitle("Chart not compatible");
                const suggestedActions: string[] =
                  rejected.reject.suggested_actions || [];
                setAssistantMessage(
                  `${rejected.reject.message_vi || "This request is not compatible with the current data."}${
                    suggestedActions.length > 0
                      ? `\n\nQuick suggestions:\n- ${suggestedActions.join("\n- ")}`
                      : ""
                  }`,
                );
                setAssistantSuggestions(
                  pieRecoverySuggestions.length > 0
                    ? pieRecoverySuggestions
                    : (rejected.reject.suggested_chart_types || []).map(
                        (ct: string) =>
                          ({
                            chart_type: ct,
                            encoding: {},
                            rationale_vi:
                              "Alternative suggestion compatible with current data.",
                            sample_prompt_vi: `Draw ${ct}: ${instruction}`,
                          } as ChartSuggestion),
                      ),
                );
                setAssistantSamplePrompts([]);
                setAssistantInstruction(
                  rejected.reject.original_instruction || instruction,
                );
                setAssistantHasAction(false);
                setAssistantOpen(true);
                logTelemetryEvent("prompt_classified", {
                  category: data.category || "CONCRETE",
                  source: "rejected_incompatible",
                });
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
              const refinedGoal = candidate["refined_goal"] || {};
              if (
                internalChartType &&
                (!refinedGoal["chart_type"] ||
                  String(refinedGoal["chart_type"]).trim().length === 0)
              ) {
                refinedGoal["chart_type"] = internalChartType;
              }
              const displayInstruction = refinedGoal["display_instruction"];

              // ðŸ”´ CHECK FOR COMPATIBILITY ERRORS FROM BACKEND VALIDATION
              if (refinedGoal["_chart_compatibility_error"]) {
                dispatch(
                  dfActions.addMessages({
                    timestamp: Date.now(),
                    type: "error",
                    component: "chart builder",
                    value: `Selected chart type is not compatible with the generated data:`,
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
              boxShadow: `0 0 10px 0 ${alpha(
                modeColor,
                0.3,
              )}, 0 0 10px 0 ${alpha(modeColor, 0.3)}`,
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
                          deriveDataFromNL(prompt.trim());
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
            label={"What do you want to explore?"}
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
                    onClick={() => getIdeasFromAgent()}
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
        {(ideas.length > 0 || thinkingBuffer) && (
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
                  onClick={(chartType, encodings) => {
                    focusNextChartRef.current = true;
                    setPrompt(idea.text);
                    deriveDataFromNL(
                      idea.text,
                      "idea",
                      chartType,
                      encodings || {},
                    );
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
      </Card>
      <ChartAssistantModal
        open={assistantOpen}
        mode={assistantMode}
        title={assistantTitle}
        message={assistantMessage}
        suggestions={assistantSuggestions}
        samplePrompts={assistantSamplePrompts}
        initialCustomPrompt={assistantInstruction || prompt}
        onClose={() => {
          if (!assistantHasAction) {
            logTelemetryEvent("modal_closed_no_action", {
              mode: assistantMode,
            });
          }
          setAssistantOpen(false);
        }}
        onDrawNow={(suggestion) => {
          setAssistantHasAction(true);
          setAssistantOpen(false);
          focusNextChartRef.current = true;
          const suggestionText =
            suggestion.rationale_vi ||
            suggestion.sample_prompt_vi ||
            assistantInstruction ||
            prompt;
          const hasChartTypeInText = (suggestionText || "")
            .toLowerCase()
            .includes((suggestion.chart_type || "").toLowerCase());
          const nextInstruction = hasChartTypeInText
            ? suggestionText
            : `Draw ${suggestion.chart_type}: ${suggestionText}`;
          const positionInGrid = assistantSuggestions.findIndex(
            (s) => s.chart_type === suggestion.chart_type,
          );
          logTelemetryEvent("suggestion_clicked", {
            chart_type: suggestion.chart_type,
            position_in_grid: positionInGrid,
            source_mode: assistantMode,
            button: "draw_now",
          });
          setPrompt(nextInstruction);
          deriveDataFromNL(
            nextInstruction,
            "user",
            suggestion.chart_type,
            suggestion.encoding || {},
          );
        }}
        onUsePrompt={(suggestion) => {
          setAssistantHasAction(true);
          const suggestionText =
            suggestion.sample_prompt_vi || suggestion.rationale_vi || "";
          const hasChartTypeInText = (suggestionText || "")
            .toLowerCase()
            .includes((suggestion.chart_type || "").toLowerCase());
          const nextInstruction = suggestionText
            ? hasChartTypeInText
              ? suggestionText
              : `Draw ${suggestion.chart_type}: ${suggestionText}`
            : `Draw ${suggestion.chart_type}`;
          const positionInGrid = assistantSuggestions.findIndex(
            (s) => s.chart_type === suggestion.chart_type,
          );
          logTelemetryEvent("suggestion_clicked", {
            chart_type: suggestion.chart_type,
            position_in_grid: positionInGrid,
            source_mode: assistantMode,
            button: "use_prompt",
          });
          setAssistantInstruction(nextInstruction);
        }}
        onSubmitCustomPrompt={(customPrompt) => {
          setAssistantHasAction(true);
          setAssistantOpen(false);
          focusNextChartRef.current = true;

          const normalizedPrompt = customPrompt.trim();
          const matchedSuggestion = assistantSuggestions.find((s) =>
            normalizedPrompt.toLowerCase().includes(s.chart_type.toLowerCase()),
          );
          const preferredChartType = matchedSuggestion?.chart_type;

          logTelemetryEvent("suggestion_custom_prompt_submitted", {
            source_mode: assistantMode,
            preferred_chart_type: preferredChartType || "",
          });

          setPrompt(normalizedPrompt);
          deriveDataFromNL(
            normalizedPrompt,
            "user",
            preferredChartType,
            matchedSuggestion?.encoding || {},
          );
        }}
      />
      <Dialog
        open={onboardingOpen}
        onClose={() => {
          localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
          setOnboardingOpen(false);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Quick Start with Chart Assistant</DialogTitle>
        <DialogContent dividers>
          <Typography sx={{ fontSize: 14, mb: 1 }}>
            Enter a specific prompt to draw quickly, or type a short prompt
            to get suitable chart suggestions.
          </Typography>
          {domainSamplePrompts.map((sample, idx) => (
            <Button
              key={`${sample}-${idx}`}
              variant="outlined"
              size="small"
              sx={{ mr: 1, mb: 1, textTransform: "none" }}
              onClick={() => {
                setPrompt(sample);
                setOnboardingOpen(false);
                localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
              }}
            >
              {sample}
            </Button>
          ))}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
              setOnboardingOpen(false);
            }}
          >
            Got it
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
