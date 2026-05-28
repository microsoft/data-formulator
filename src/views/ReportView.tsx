// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState, useRef, useEffect, memo, useMemo } from "react";
import {
  Box,
  Button,
  Typography,
  Checkbox,
  IconButton,
  Card,
  CardContent,
  CircularProgress,
  Alert,
  Link,
  Divider,
  Paper,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  useTheme,
  alpha,
  Select,
  MenuItem,
  Skeleton,
} from "@mui/material";
import Masonry from "@mui/lab/Masonry";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CreateChartifact from "@mui/icons-material/Description";
import EditIcon from "@mui/icons-material/Edit";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import HistoryIcon from "@mui/icons-material/History";
import DeleteIcon from "@mui/icons-material/Delete";
import ShareIcon from "@mui/icons-material/Share";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import FilePresentIcon from "@mui/icons-material/FilePresent";
import SlideshowIcon from "@mui/icons-material/Slideshow";
import pptxAsset from "../assets/pptx-icon.png";
import vietnamFlagIcon from "../assets/vietnam-flag.png";
import usaFlagIcon from "../assets/usa-flag.png";
import thailandFlagIcon from "../assets/thailand-flag.png";
import laosFlagIcon from "../assets/laos-flag.png";
import japanFlagIcon from "../assets/japan-flag.png";
import html2canvas from "html2canvas";
import { useDispatch, useSelector } from "react-redux";
import {
  DataFormulatorState,
  dfActions,
  dfSelectors,
  GeneratedReport,
} from "../app/dfSlice";
import { Message } from "./MessageSnackbar";
import { getUrls, getTriggers } from "../app/utils";
import { MuiMarkdown, getOverrides } from "mui-markdown";
import { getDataTable } from "./VisualizationView";
import { DictTable } from "../components/ComponentType";
import { AppDispatch } from "../app/store";
import TableRowsIcon from "@mui/icons-material/TableRows";
import { Collapse } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { convertToChartifact, openChartifactViewer } from "./ChartifactDialog";
import { generateChartPreview, yieldToIdle } from "./chartPreviewUtils";

// Accent colors for dataset grouping (cycles if more tables than colors)
const TABLE_ACCENT_COLORS = [
  "#2196f3", // blue
  "#4caf50", // green
  "#ff9800", // orange
  "#9c27b0", // purple
  "#f44336", // red
  "#00bcd4", // cyan
  "#ff5722", // deep orange
  "#607d8b", // blue grey
];

// Typography constants
const FONT_FAMILY_SYSTEM =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif, "Segoe UI Emoji", "Segoe UI Symbol"';
const FONT_FAMILY_SERIF = 'Georgia, Cambria, "Times New Roman", Times, serif';
const FONT_FAMILY_MONO =
  '"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

// Color constants
const COLOR_HEADING = "rgb(37, 37, 37)";
const COLOR_BODY = "rgb(55, 53, 47)";
const COLOR_MUTED = "rgb(73, 73, 73)";
const COLOR_BG_LIGHT = "rgba(247, 246, 243, 1)";

// Social post style constants (Twitter/X style)
const COLOR_SOCIAL_TEXT = "rgb(15, 20, 25)";
const COLOR_SOCIAL_BORDER = "rgb(207, 217, 222)";
const COLOR_SOCIAL_ACCENT = "rgb(29, 155, 240)";

// Executive summary style constants (professional/business look)
const COLOR_EXEC_TEXT = "rgb(33, 37, 41)";
const COLOR_EXEC_HEADING = "rgb(20, 24, 28)";
const COLOR_EXEC_BORDER = "rgb(108, 117, 125)";
const COLOR_EXEC_ACCENT = "rgb(0, 123, 255)";
const COLOR_EXEC_BG = "rgb(248, 249, 250)";

const HEADING_BASE = {
  fontFamily: FONT_FAMILY_SYSTEM,
  color: COLOR_HEADING,
  fontWeight: 700,
  letterSpacing: "-0.01em",
};

const BODY_TEXT_BASE = {
  fontFamily: FONT_FAMILY_SYSTEM,
  fontSize: "0.9375rem",
  lineHeight: 1.75,
  fontWeight: 400,
  letterSpacing: "0.003em",
  color: COLOR_BODY,
};

const TABLE_CELL_BASE = {
  fontFamily: FONT_FAMILY_SYSTEM,
  fontSize: "0.875rem",
  py: 1.5,
  px: 2,
};

// Notion-style markdown overrides with MUI components
const notionStyleMarkdownOverrides = {
  ...getOverrides(),
  h1: {
    component: Typography,
    props: {
      variant: "h4",
      gutterBottom: true,
      sx: {
        ...HEADING_BASE,
        fontSize: "1.75rem",
        lineHeight: 1.25,
        letterSpacing: "-0.02em",
        pb: 0.5,
        mb: 3,
        mt: 4,
      },
    },
  },
  h2: {
    component: Typography,
    props: {
      variant: "h5",
      gutterBottom: true,
      sx: {
        ...HEADING_BASE,
        fontSize: "1.5rem",
        lineHeight: 1.3,
        pb: 0.5,
        mb: 2.5,
        mt: 3.5,
      },
    },
  },
  h3: {
    component: Typography,
    props: {
      variant: "h6",
      gutterBottom: true,
      sx: {
        ...HEADING_BASE,
        fontWeight: 600,
        fontSize: "1.25rem",
        lineHeight: 1.4,
        letterSpacing: "-0.005em",
        mb: 2,
        mt: 3,
      },
    },
  },
  h4: {
    component: Typography,
    props: {
      variant: "h6",
      gutterBottom: true,
      sx: {
        ...HEADING_BASE,
        fontWeight: 600,
        fontSize: "1.125rem",
        lineHeight: 1.4,
        mb: 1.5,
        mt: 2.5,
      },
    },
  },
  h5: {
    component: Typography,
    props: {
      variant: "subtitle1",
      gutterBottom: true,
      sx: {
        ...HEADING_BASE,
        fontWeight: 600,
        fontSize: "1rem",
        lineHeight: 1.5,
        mb: 1.5,
        mt: 2,
      },
    },
  },
  h6: {
    component: Typography,
    props: {
      variant: "subtitle2",
      gutterBottom: true,
      sx: {
        ...HEADING_BASE,
        fontWeight: 600,
        fontSize: "0.9375rem",
        lineHeight: 1.5,
        mb: 1.5,
        mt: 2,
      },
    },
  },
  p: {
    component: Typography,
    props: {
      variant: "body2",
      paragraph: true,
      sx: { ...BODY_TEXT_BASE, mb: 1.75 },
    },
  },
  a: {
    component: Link,
    props: {
      underline: "hover" as const,
      color: "primary" as const,
      sx: { fontSize: "inherit", fontWeight: 500 },
    },
  },
  ul: {
    component: "ul",
    props: {
      style: {
        paddingLeft: "1.8em",
        marginTop: "0.75em",
        marginBottom: "1.5em",
        fontFamily: FONT_FAMILY_SYSTEM,
      },
    },
  },
  ol: {
    component: "ol",
    props: {
      style: {
        paddingLeft: "1.8em",
        marginTop: "0.75em",
        marginBottom: "1.5em",
        fontFamily: FONT_FAMILY_SYSTEM,
      },
    },
  },
  li: {
    component: Typography,
    props: {
      component: "li",
      variant: "body1",
      sx: { ...BODY_TEXT_BASE, mb: 0.5 },
    },
  },
  blockquote: {
    component: Box,
    props: {
      sx: {
        borderLeft: "3px solid",
        borderColor: "rgba(0, 0, 0, 0.15)",
        pl: 2.5,
        py: 1,
        my: 2.5,
        fontFamily: FONT_FAMILY_SERIF,
        fontStyle: "italic",
        color: COLOR_MUTED,
        fontSize: "1rem",
        lineHeight: 1.7,
      },
    },
  },
  pre: {
    component: Paper,
    props: {
      elevation: 0,
      sx: {
        backgroundColor: COLOR_BG_LIGHT,
        p: 2,
        borderRadius: "4px",
        overflow: "auto",
        my: 2,
        border: "1px solid",
        borderColor: "rgba(0, 0, 0, 0.08)",
        "& code": {
          backgroundColor: "transparent !important",
          padding: "0 !important",
          fontSize: "0.8125rem",
          fontFamily: FONT_FAMILY_MONO,
          lineHeight: 1.7,
          color: COLOR_BODY,
        },
      },
    },
  },
  table: {
    component: TableContainer,
    props: {
      component: Paper,
      elevation: 0,
      sx: { my: 2, border: "1px solid", borderColor: "divider" },
    },
  },
  thead: {
    component: TableHead,
    props: { sx: { backgroundColor: COLOR_BG_LIGHT } },
  },
  tbody: { component: TableBody },
  tr: { component: TableRow },
  th: {
    component: TableCell,
    props: {
      sx: {
        ...TABLE_CELL_BASE,
        fontWeight: 600,
        borderBottom: "2px solid",
        borderColor: "divider",
      },
    },
  },
  td: {
    component: TableCell,
    props: {
      sx: {
        ...TABLE_CELL_BASE,
        borderBottom: "1px solid",
        borderColor: "divider",
        lineHeight: 1.6,
      },
    },
  },
  hr: { component: Divider, props: { sx: { my: 3 } } },
} as any;

// Social post style markdown overrides (X/Twitter style)
const socialStyleMarkdownOverrides = {
  ...notionStyleMarkdownOverrides,
  h1: {
    component: Typography,
    props: {
      variant: "h6",
      gutterBottom: true,
      sx: {
        fontFamily: FONT_FAMILY_SYSTEM,
        fontWeight: 700,
        fontSize: "1.125rem",
        lineHeight: 1.25,
        color: COLOR_SOCIAL_TEXT,
        mb: 1.5,
        mt: 1.5,
      },
    },
  },
  h2: {
    component: Typography,
    props: {
      variant: "h6",
      gutterBottom: true,
      sx: {
        fontFamily: FONT_FAMILY_SYSTEM,
        fontWeight: 700,
        fontSize: "1rem",
        lineHeight: 1.25,
        color: COLOR_SOCIAL_TEXT,
        mb: 1.25,
        mt: 1.5,
      },
    },
  },
  h3: {
    component: Typography,
    props: {
      variant: "subtitle1",
      gutterBottom: true,
      sx: {
        fontFamily: FONT_FAMILY_SYSTEM,
        fontWeight: 600,
        fontSize: "0.9375rem",
        lineHeight: 1.3,
        color: COLOR_SOCIAL_TEXT,
        mb: 1,
        mt: 1.25,
      },
    },
  },
  p: {
    component: Typography,
    props: {
      variant: "body2",
      paragraph: true,
      sx: {
        fontFamily: FONT_FAMILY_SYSTEM,
        fontSize: "0.875rem",
        lineHeight: 1.4,
        fontWeight: 400,
        mb: 0.75,
        color: COLOR_SOCIAL_TEXT,
      },
    },
  },
  li: {
    component: Typography,
    props: {
      component: "li",
      variant: "body2",
      sx: {
        fontFamily: FONT_FAMILY_SYSTEM,
        fontSize: "0.875rem",
        lineHeight: 1.4,
        fontWeight: 400,
        mb: 0.25,
        color: COLOR_SOCIAL_TEXT,
      },
    },
  },
} as any;

// Executive summary style markdown overrides (compact serif styling)
const executiveSummaryMarkdownOverrides = {
  ...getOverrides(),
  h1: {
    component: Typography,
    props: {
      variant: "h5",
      gutterBottom: true,
      sx: {
        fontFamily: FONT_FAMILY_SERIF,
        fontWeight: 700,
        fontSize: "1.25rem",
        lineHeight: 1.3,
        color: COLOR_EXEC_HEADING,
        mb: 2,
        mt: 2.5,
      },
    },
  },
  h2: {
    component: Typography,
    props: {
      variant: "h6",
      gutterBottom: true,
      sx: {
        fontFamily: FONT_FAMILY_SERIF,
        fontWeight: 600,
        fontSize: "1.125rem",
        lineHeight: 1.3,
        color: COLOR_EXEC_HEADING,
        mb: 1.5,
        mt: 2,
      },
    },
  },
  h3: {
    component: Typography,
    props: {
      variant: "h6",
      gutterBottom: true,
      sx: {
        fontFamily: FONT_FAMILY_SERIF,
        fontWeight: 600,
        fontSize: "1rem",
        lineHeight: 1.4,
        color: COLOR_EXEC_HEADING,
        mb: 1.25,
        mt: 1.5,
      },
    },
  },
  h4: {
    component: Typography,
    props: {
      variant: "subtitle1",
      gutterBottom: true,
      sx: {
        fontFamily: FONT_FAMILY_SERIF,
        fontWeight: 600,
        fontSize: "0.9375rem",
        lineHeight: 1.4,
        color: COLOR_EXEC_HEADING,
        mb: 1,
        mt: 1.5,
      },
    },
  },
  p: {
    component: Typography,
    props: {
      variant: "body2",
      paragraph: true,
      sx: {
        fontFamily: FONT_FAMILY_SERIF,
        fontSize: "0.875rem",
        lineHeight: 1.5,
        fontWeight: 400,
        color: COLOR_EXEC_TEXT,
        mb: 1.25,
        textAlign: "justify",
      },
    },
  },
  a: {
    component: Link,
    props: {
      underline: "hover" as const,
      color: "primary" as const,
      sx: {
        fontSize: "inherit",
        fontWeight: 500,
        color: COLOR_EXEC_ACCENT,
        "&:hover": { color: "rgb(0, 86, 179)" },
      },
    },
  },
  ul: {
    component: "ul",
    props: {
      style: {
        paddingLeft: "1.5em",
        marginTop: "0.5em",
        marginBottom: "1em",
        fontFamily: FONT_FAMILY_SERIF,
      },
    },
  },
  ol: {
    component: "ol",
    props: {
      style: {
        paddingLeft: "1.5em",
        marginTop: "0.5em",
        marginBottom: "1em",
        fontFamily: FONT_FAMILY_SERIF,
      },
    },
  },
  li: {
    component: Typography,
    props: {
      component: "li",
      variant: "body2",
      sx: {
        fontFamily: FONT_FAMILY_SERIF,
        fontSize: "0.875rem",
        lineHeight: 1.5,
        fontWeight: 400,
        color: COLOR_EXEC_TEXT,
        mb: 0.25,
      },
    },
  },
  blockquote: {
    component: Box,
    props: {
      sx: {
        borderLeft: "2px solid",
        borderLeftColor: COLOR_EXEC_ACCENT,
        pl: 2,
        py: 1,
        my: 1.5,
        backgroundColor: COLOR_EXEC_BG,
        fontFamily: FONT_FAMILY_SERIF,
        fontStyle: "italic",
        color: COLOR_EXEC_TEXT,
        fontSize: "0.875rem",
        lineHeight: 1.6,
      },
    },
  },
  pre: {
    component: Paper,
    props: {
      elevation: 0,
      sx: {
        backgroundColor: COLOR_EXEC_BG,
        p: 1.5,
        borderRadius: "4px",
        overflow: "auto",
        my: 1.5,
        "& code": {
          backgroundColor: "transparent !important",
          padding: "0 !important",
          fontSize: "0.75rem",
          fontFamily: FONT_FAMILY_MONO,
          lineHeight: 1.5,
          color: COLOR_EXEC_TEXT,
        },
      },
    },
  },
  table: {
    component: TableContainer,
    props: {
      component: Paper,
      elevation: 0,
      sx: { my: 1.5, borderRadius: "4px" },
    },
  },
  thead: {
    component: TableHead,
    props: { sx: { backgroundColor: COLOR_EXEC_BG } },
  },
  tbody: { component: TableBody },
  tr: { component: TableRow },
  th: {
    component: TableCell,
    props: {
      sx: {
        fontFamily: FONT_FAMILY_SERIF,
        fontSize: "0.8125rem",
        py: 1,
        px: 1.5,
        fontWeight: 600,
        borderBottom: "1px solid",
        borderColor: COLOR_EXEC_BORDER,
        color: COLOR_EXEC_HEADING,
      },
    },
  },
  td: {
    component: TableCell,
    props: {
      sx: {
        fontFamily: FONT_FAMILY_SERIF,
        fontSize: "0.8125rem",
        py: 1,
        px: 1.5,
        borderBottom: "1px solid",
        borderColor: COLOR_EXEC_BORDER,
        lineHeight: 1.5,
        color: COLOR_EXEC_TEXT,
      },
    },
  },
  hr: {
    component: Divider,
    props: { sx: { my: 2, borderColor: COLOR_EXEC_BORDER } },
  },
} as any;

export const ReportView: FC = () => {
  // Get all generated reports from Redux state
  const dispatch = useDispatch<AppDispatch>();

  const charts = useSelector((state: DataFormulatorState) => state.charts);
  const tables = useSelector((state: DataFormulatorState) => state.tables);
  const modelSlot = useSelector(dfSelectors.getModelSlots);
  const models = useSelector(dfSelectors.getModels);
  const conceptShelfItems = useSelector(dfSelectors.getConceptShelfItems);
  const config = useSelector((state: DataFormulatorState) => state.config);
  const chartSampleData = useSelector(dfSelectors.getChartSampleData);
  const chartSampleReady = useSelector(dfSelectors.getChartSampleReady);
  const chartOriginalTables = useSelector(dfSelectors.getChartOriginalTables);
  const allGeneratedReports = useSelector(dfSelectors.getAllGeneratedReports);
  const focusedChartId = useSelector(
    (state: DataFormulatorState) => state.focusedChartId,
  );
  const theme = useTheme();
  const viewMode = useSelector(dfSelectors.getViewMode);

  const [selectedChartIds, setSelectedChartIds] = useState<Set<string>>(
    new Set(focusedChartId ? [focusedChartId] : []),
  );
  const [previewImages, setPreviewImages] = useState<
    Map<
      string,
      { url: string; width: number; height: number; dataVersion?: number }
    >
  >(new Map());
  const [loadingChartIds, setLoadingChartIds] = useState<Set<string>>(
    new Set(),
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string>("");
  const [style, setStyle] = useState<string>("short note");
  const [mode, setMode] = useState<"compose" | "post">(
    allGeneratedReports.length > 0 ? "post" : "compose",
  );

  // Local state for current report
  const [currentReportId, setCurrentReportId] = useState<string | undefined>(
    undefined,
  );
  const [generatedReport, setGeneratedReport] = useState<string>("");
  const [generatedStyle, setGeneratedStyle] = useState<string>("short note");
  const [cachedReportImages, setCachedReportImages] = useState<
    Record<
      string,
      { url: string; width: number; height: number; dataVersion?: number }
    >
  >({});
  const [shareButtonSuccess, setShareButtonSuccess] = useState(false);
  const [hideTableOfContents, setHideTableOfContents] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [reportLanguage, setReportLanguage] = useState<string>("en");
  // Icon handling for PowerPoint export button: prefer bundler asset, then try public paths and BASE_URL variants
  const possiblePptxIconPaths = [
    pptxAsset, // resolved by bundler (src/assets)
    "/pptx-icon.png",
    "/assets/pptx-icon.png",
    `${import.meta.env.BASE_URL || "/"}pptx-icon.png`,
    `${import.meta.env.BASE_URL || "/"}assets/pptx-icon.png`,
  ];
  const [pptxIconIdx, setPptxIconIdx] = useState(0);
  const [pptxIconError, setPptxIconError] = useState(false);

  const PptxIcon: FC = () => {
    if (pptxIconError) return <SlideshowIcon />;
    const src = possiblePptxIconPaths[pptxIconIdx];
    return (
      <Box
        component="img"
        src={src}
        alt="pptx"
        sx={{ width: 18, height: 18, objectFit: "contain" }}
        onError={() => {
          // advance to next path, otherwise fallback to icon
          if (pptxIconIdx < possiblePptxIconPaths.length - 1) {
            console.warn(
              `pptx icon not found at ${src}, trying next path: ${
                possiblePptxIconPaths[pptxIconIdx + 1]
              }`,
            );
            setPptxIconIdx((i) => i + 1);
          } else {
            console.warn(
              `pptx icon not found in any known path, falling back to SVG icon`,
            );
            setPptxIconError(true);
          }
        }}
      />
    );
  };

  const updateCachedReportImages = (
    chartId: string,
    blobUrl: string,
    width: number,
    height: number,
    dataVersion?: number,
  ) => {
    setCachedReportImages((prev) => ({
      ...prev,
      [chartId]: { url: blobUrl, width, height, dataVersion },
    }));
  };

  // Helper function to show messages using dfSlice
  const showMessage = (
    message: string,
    type: "success" | "error" | "info" | "warning" = "success",
  ) => {
    const msg: Message = {
      type,
      component: "ReportView",
      timestamp: Date.now(),
      value: message,
    };
    dispatch(dfActions.addMessages(msg));
  };

  // Sanitize color values on elements to replace CSS functions (like oklch) with computed RGB/RGBA values
  // Returns a restore function to revert inline style changes
  const sanitizeElementColors = (root: HTMLElement) => {
    const cssProps: string[] = [
      "background-color",
      "color",
      "border-color",
      "outline-color",
      "box-shadow",
      "text-shadow",
      "fill",
      "stroke",
    ];

    const elements = [
      root,
      ...Array.from(root.querySelectorAll("*")),
    ] as Element[];
    const prev = new Map<Element, Record<string, string | null>>();

    elements.forEach((el) => {
      try {
        const cs = window.getComputedStyle(el);
        if (!cs) return;
        cssProps.forEach((p) => {
          try {
            const val = cs.getPropertyValue(p);
            if (val && val.trim()) {
              const style = (el as HTMLElement | SVGElement | null)?.style as
                | CSSStyleDeclaration
                | undefined;
              if (!prev.has(el)) prev.set(el, {});
              const previousInline = style ? style.getPropertyValue(p) : "";
              prev.get(el)![p] = previousInline || null;
              let safeColor = val;
              // If value uses unsupported color functions, force a safe fallback color.
              if (
                /oklch|lch\(|lab\(/i.test(val) ||
                /^(?!rgb|hsl|#)/i.test(val.trim())
              ) {
                // XÃ³a má»i inline style cÅ© cÃ³ chá»©a oklch/lch/lab
                if (style && typeof style.removeProperty === "function") {
                  const inlineVal = style.getPropertyValue(p);
                  if (/oklch|lch\(|lab\(/i.test(inlineVal)) {
                    style.removeProperty(p);
                  }
                }
                safeColor = p.includes("background") ? "#fff" : "#111";
              }
              if (style && typeof style.setProperty === "function") {
                style.setProperty(p, safeColor);
              }
            }
          } catch (inner) {
            // ignore property-specific errors
          }
        });
      } catch (e) {
        // Ignore elements that throw when computing styles (SVG edge cases)
      }
    });

    return () => {
      prev.forEach((map, el) => {
        try {
          const style = (el as HTMLElement | SVGElement | null)?.style as
            | CSSStyleDeclaration
            | undefined;
          if (!style) return;
          Object.entries(map).forEach(([prop, v]) => {
            try {
              if (v) style.setProperty(prop, v);
              else style.removeProperty(prop);
            } catch (inner) {
              // ignore per-prop restore errors
            }
          });
        } catch (e) {
          // ignore restore errors
        }
      });
    };
  };

  // Aggressive safe color override for capture
  const applySafeColorOverride = (root: HTMLElement) => {
    const cls = `df-safe-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const styleEl = document.createElement("style");
    styleEl.setAttribute("data-df-safe", cls);

    // Strong rules to force simple colors and disable shadows
    styleEl.textContent = `.${cls}, .${cls} * { background-color: white !important; color: #111 !important; border-color: #e0e0e0 !important; box-shadow: none !important; text-shadow: none !important; outline-color: #111 !important; }
.${cls} *::before, .${cls} *::after { background-color: white !important; color: #111 !important; box-shadow: none !important; text-shadow: none !important; }`;

    document.head.appendChild(styleEl);
    root.classList.add(cls);

    return () => {
      try {
        root.classList.remove(cls);
      } catch (e) {
        /* ignore */
      }
      try {
        if (styleEl.parentElement) styleEl.parentElement.removeChild(styleEl);
      } catch (e) {
        /* ignore */
      }
    };
  };

  // Function to capture and share report as image
  const shareReportAsImage = async () => {
    if (!currentReportId) return;

    try {
      // Find the report content element
      const reportElement = document.querySelector(
        "[data-report-content]",
      ) as HTMLElement;
      if (!reportElement) {
        showMessage("Could not find report content to capture", "error");
        return;
      }

      // Apply aggressive safe-color override and then sanitize computed values
      const restoreSafe = applySafeColorOverride(reportElement);
      const restoreColors = sanitizeElementColors(reportElement);

      let canvas: HTMLCanvasElement | null = null;
      try {
        canvas = await html2canvas(reportElement, {
          backgroundColor: "#ffffff",
          scale: 2, // Higher quality
          useCORS: true,
          allowTaint: true,
          scrollX: 0,
          scrollY: 0,
          // Add extra padding to ensure borders are captured
          width: reportElement.scrollWidth + 4,
          height: reportElement.scrollHeight + 4,
          logging: false, // Disable console logs
        });
      } finally {
        // restore computed inline styles and safe overrides even if capture fails
        try {
          restoreColors();
        } catch (e) {
          /* ignore */
        }
        try {
          restoreSafe();
        } catch (e) {
          /* ignore */
        }
      }

      if (!canvas) {
        showMessage("Failed to generate image", "error");
        return;
      }

      // Convert canvas to blob
      canvas.toBlob(
        (blob: Blob | null) => {
          if (!blob) {
            showMessage("Failed to generate image", "error");
            return;
          }

          // Copy to clipboard
          if (navigator.clipboard && navigator.clipboard.write) {
            navigator.clipboard
              .write([
                new ClipboardItem({
                  "image/png": blob,
                }),
              ])
              .then(() => {
                showMessage(
                  "Report image copied to clipboard! You can now paste it anywhere to share.",
                );
                setShareButtonSuccess(true);
                setTimeout(() => setShareButtonSuccess(false), 2000);
              })
              .catch(() => {
                showMessage(
                  "Failed to copy to clipboard. Your browser may not support this feature.",
                  "error",
                );
              });
          } else {
            showMessage(
              "Clipboard API not supported in your browser. Please use a modern browser.",
              "error",
            );
          }
        },
        "image/png",
        0.95,
      );
    } catch (error) {
      console.error("Error generating report image:", error);
      showMessage(
        "Failed to generate report image. Please try again.",
        "error",
      );
    }
  };

  // Export current report to PowerPoint (client-side using pptxgenjs, with server fallback)
  const exportToPowerPoint = async () => {
    if (!currentReportId) return;
    setIsExporting(true);

    const reportElement = document.querySelector(
      "[data-report-content]",
    ) as HTMLElement;
    if (!reportElement) {
      showMessage("Could not find report content to capture", "error");
      setIsExporting(false);
      return;
    }

    // Apply aggressive safe-color override and then sanitize computed values
    const restoreSafe = applySafeColorOverride(reportElement);
    const restoreColors = sanitizeElementColors(reportElement);

    // Helper: convert a URL/blob to a data URL
    const urlToDataUrl = async (src: string): Promise<string | null> => {
      if (!src) return null;
      if (src.startsWith("data:")) return src;
      try {
        const resp = await fetch(src);
        if (!resp.ok) return null;
        const blob = await resp.blob();
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        return null;
      }
    };

    try {
      // First, try a client-side export using pptxgenjs (dynamic import so it's optional)
      try {
        // Dynamically import so the app can still build without the dependency installed
        // (user can `npm install pptxgenjs` if they want client-side export)
        const pptxModule: any = await import("pptxgenjs");
        const PptxGenJS = pptxModule.default || pptxModule;
        const pres = new PptxGenJS();

        // Derive title from the report source: prefer the first non-empty non-code line from generatedReport
        const deriveTitle = (source: string) => {
          const lines = source.split(/\r?\n/);
          let inCode = false;
          for (const raw of lines) {
            const line = raw.trim();
            if (!line) continue;
            if (line.startsWith("```")) {
              inCode = !inCode;
              continue;
            }
            if (inCode) continue;
            // strip markdown heading markers and blockquote
            const cleaned = line.replace(/^#+\s*/, "").replace(/^>\s*/, "");
            if (cleaned) return cleaned;
          }
          return "Report";
        };
        const titleText = deriveTitle(
          generatedReport || reportElement.textContent || "",
        );

        // Collect images embedded in the report (if any)
        const imgEls = Array.from(
          reportElement.querySelectorAll("img"),
        ) as HTMLImageElement[];

        const images = await Promise.all(
          imgEls.map(async (img) => {
            const data = await urlToDataUrl(img.src);
            if (!data) return null;
            return {
              data,
              width: img.naturalWidth || 800,
              height: img.naturalHeight || 400,
              alt: img.alt || "",
              src: img.src || "",
            };
          }),
        );

        // Build chart sections from raw markdown using [IMAGE(chart_id)] placeholders.
        // This keeps each chart with its local narrative when exporting to PPTX.
        const rawReportSource = generatedReport || "";
        const markdownMatch = rawReportSource.match(
          /```markdown\n([\s\S]*?)(?:\n```)?$/,
        );
        const markdownText = markdownMatch ? markdownMatch[1] : rawReportSource;

        const cleanMarkdownText = (s: string) =>
          s
            .replace(/```[\s\S]*?```/g, " ")
            .replace(/^#{1,6}\s+/gm, "")
            .replace(/^\s*>\s?/gm, "")
            .replace(/\*\*/g, "")
            .replace(/\*/g, "")
            .replace(/`/g, "")
            .replace(/\[[^\]]+\]\(([^)]+)\)/g, "$1")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

        const paginateNarrative = (
          text: string,
          charsPerLine: number,
          maxLinesPerSlide: number,
        ): string[] => {
          const normalized = text.replace(/\r/g, "").trim();
          if (!normalized) return [""];

          const paragraphs = normalized
            .split(/\n\s*\n/)
            .map((p) => p.trim())
            .filter(Boolean);

          const pages: string[] = [];
          let currentLines = 0;
          let currentChunks: string[] = [];

          const pushPage = () => {
            pages.push(currentChunks.join("\n\n").trim());
            currentChunks = [];
            currentLines = 0;
          };

          const estimateLines = (chunk: string) => {
            const lines = chunk.split("\n");
            let total = 0;
            for (const line of lines) {
              const len = line.trim().length;
              total += Math.max(1, Math.ceil(len / charsPerLine));
            }
            return total;
          };

          const splitLongParagraphBySentences = (p: string): string[] => {
            const pieces = p
              .split(/(?<=[.!?])\s+/)
              .map((s) => s.trim())
              .filter(Boolean);
            if (pieces.length <= 1) return [p];
            return pieces;
          };

          for (const paragraph of paragraphs) {
            const parts = splitLongParagraphBySentences(paragraph);
            for (const part of parts) {
              const needed = estimateLines(part);
              if (
                currentLines > 0 &&
                currentLines + needed > maxLinesPerSlide
              ) {
                pushPage();
              }

              // Handle a very long sentence/part that still doesn't fit on an empty page
              if (needed > maxLinesPerSlide) {
                const words = part.split(/\s+/).filter(Boolean);
                let buf = "";
                for (const w of words) {
                  const cand = buf ? `${buf} ${w}` : w;
                  const candLines = estimateLines(cand);
                  if (candLines > maxLinesPerSlide && buf) {
                    if (currentChunks.length > 0) pushPage();
                    currentChunks.push(buf);
                    currentLines = estimateLines(buf);
                    pushPage();
                    buf = w;
                    currentLines = 0;
                  } else {
                    buf = cand;
                  }
                }
                if (buf) {
                  const bufLines = estimateLines(buf);
                  if (
                    currentLines > 0 &&
                    currentLines + bufLines > maxLinesPerSlide
                  ) {
                    pushPage();
                  }
                  currentChunks.push(buf);
                  currentLines += bufLines;
                }
                continue;
              }

              currentChunks.push(part);
              currentLines += needed;
            }
          }

          if (currentChunks.length > 0) {
            pushPage();
          }
          return pages.length > 0 ? pages : [normalized];
        };

        const splitIntoSentences = (text: string): string[] => {
          const cleaned = text.trim();
          if (!cleaned) return [];
          const raw = cleaned
            .replace(/\n+/g, " ")
            .split(/(?<=[\.\!\?\:\;])\s+/)
            .map((s) => s.trim())
            .filter(Boolean);
          return raw.length > 0 ? raw : [cleaned];
        };

        const wrapParagraph = (text: string, maxChars: number): string[] => {
          const cleaned = text.trim();
          if (!cleaned) return [];
          const out: string[] = [];

          const sentences = splitIntoSentences(cleaned);
          for (let si = 0; si < sentences.length; si += 1) {
            const sentence = sentences[si];
            if (sentence.length <= maxChars) {
              out.push(sentence);
            } else {
              const words = sentence.split(/\s+/).filter(Boolean);
              let current = "";
              for (const w of words) {
                const candidate = current ? `${current} ${w}` : w;
                if (candidate.length > maxChars && current) {
                  out.push(current);
                  current = w;
                } else {
                  current = candidate;
                }
              }
              if (current) out.push(current);
            }

            // Between full sentences, insert one empty line:
            // rendered with join("\n"), this becomes a visual double line break.
            if (si < sentences.length - 1) {
              out.push("");
            }
          }
          return out;
        };

        const wrapLines = (lines: string[], maxChars: number): string[] => {
          const out: string[] = [];
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            out.push(...wrapParagraph(trimmed, maxChars));
          }
          return out;
        };

        const normalizeNarrative = (text: string): string =>
          text
            .replace(/\r/g, "")
            .replace(/\*\*/g, "")
            .replace(/\*/g, "")
            .replace(/^\s*[-•]\s+/gm, "")
            .replace(/^\s*#{1,6}\s*/gm, "")
            .replace(/\n{3,}/g, "\n\n")
            .replace(/[ \t]+\n/g, "\n")
            .replace(/[ \t]{2,}/g, " ")
            .trim();

        const splitByCharLimit = (
          text: string,
          limit: number,
        ): { chunk: string; rest: string } => {
          const cleaned = text.trim();
          if (!cleaned) return { chunk: "", rest: "" };
          if (cleaned.length <= limit) return { chunk: cleaned, rest: "" };

          let cut = limit;
          while (cut > Math.floor(limit * 0.6) && cleaned[cut] !== " ") {
            cut -= 1;
          }
          if (cut <= Math.floor(limit * 0.6)) cut = limit;
          return {
            chunk: cleaned.slice(0, cut).trim(),
            rest: cleaned.slice(cut).trim(),
          };
        };

        const sections: { chartId: string; text: string }[] = [];
        const markerRegex = /\[IMAGE\(([^)]+)\)\]/g;
        let match: RegExpExecArray | null;
        let lastPos = 0;
        while ((match = markerRegex.exec(markdownText)) !== null) {
          const chartId = match[1]?.trim();
          const before = cleanMarkdownText(
            markdownText.slice(lastPos, match.index),
          );
          if (chartId) {
            sections.push({ chartId, text: before });
          }
          lastPos = markerRegex.lastIndex;
        }
        const tailText = cleanMarkdownText(markdownText.slice(lastPos));
        if (sections.length > 0 && tailText) {
          sections[sections.length - 1].text = `${
            sections[sections.length - 1].text
          }\n\n${tailText}`.trim();
        }

        // Title slide (page 1) - large title, Space Grotesk
        const slideTitle = pres.addSlide();
        slideTitle.addText(titleText, {
          x: 0.5,
          y: 0.8,
          w: 9,
          h: 1.8,
          fontSize: 42,
          bold: true,
          fontFace: "Space Grotesk",
          align: pres.AlignH ? pres.AlignH.center : "center",
        });

        // Add one slide per chart image, each with its own local text context.
        if (sections.length > 0) {
          const sectionSlides = await Promise.all(
            sections.map(async (s, idx) => {
              const fromCache = cachedReportImages[s.chartId];
              const imgData = fromCache?.url
                ? await urlToDataUrl(fromCache.url)
                : null;
              const fallbackImg = images[idx] || null;
              return {
                chartId: s.chartId,
                text: s.text,
                img: imgData
                  ? {
                      data: imgData,
                      width: fromCache?.width || 800,
                      height: fromCache?.height || 400,
                    }
                  : fallbackImg
                  ? {
                      data: fallbackImg.data,
                      width: fallbackImg.width,
                      height: fallbackImg.height,
                    }
                  : null,
              };
            }),
          );

          sectionSlides.forEach((s, idx) => {
            if (!s.img) return;
            const maxW = 5.3;
            const maxH = 4.9;
            const imageScale = 1.2;
            let w = maxW * imageScale;
            let h = (s.img.height / Math.max(1, s.img.width)) * w;
            if (h > maxH) {
              h = maxH;
              w = (s.img.width / Math.max(1, s.img.height)) * h;
            }
            const narrative =
              s.text || "No chart-specific narrative found in report text.";

            const rightBox = { x: 6.75, y: 0.55, w: 3.1, h: 3.75 };
            const bottomBox = { x: 0.5, y: 4, w: 8.95, h: 2.9 };
            const rightFont = 9;
            const bottomFont = 9;
            const maxCharsPerRightBox = 450;
            const maxCharsPerBottomBox = 450;

            let remainingText = normalizeNarrative(narrative);

            while (remainingText.length > 0) {
              const slide = pres.addSlide();
              slide.addImage({ data: s.img!.data, x: 0.35, y: 0.5, w, h });

              const rightPart = splitByCharLimit(
                remainingText,
                maxCharsPerRightBox,
              );
              const bottomPart = splitByCharLimit(
                rightPart.rest,
                maxCharsPerBottomBox,
              );
              const rightLines = wrapParagraph(rightPart.chunk, 47);
              const bottomLines = wrapParagraph(bottomPart.chunk, 110);

              const drawTextbox = (
                targetSlide: any,
                box: { x: number; y: number; w: number; h: number },
                lines: string[],
                fontSize: number,
              ) => {
                const text = lines
                  .map((l) => l.trim())
                  .join("\n")
                  .replace(/\n{3,}/g, "\n\n")
                  .trim();
                if (!text) return;
                targetSlide.addText(text, {
                  x: box.x,
                  y: box.y,
                  w: box.w,
                  h: box.h,
                  fontSize,
                  bold: false,
                  color: "444444",
                  valign: "top",
                  fontFace: "Space Grotesk",
                  breakLine: true,
                  margin: 0.05,
                  paraSpaceAfterPt: 2,
                  lineSpacingMultiple: 1.05,
                  fit: "shrink",
                });
              };

              drawTextbox(slide, rightBox, rightLines, rightFont);
              drawTextbox(slide, bottomBox, bottomLines, bottomFont);
              remainingText = bottomPart.rest;
            }
          });
        } else {
          // Fallback when report has no [IMAGE(chart_id)] markers: keep image slides by order.
          images.forEach((img, idx) => {
            if (!img) return;
            const slide = pres.addSlide();
            slide.addText(img.alt || `Chart ${idx + 1}`, {
              x: 0.5,
              y: 0.25,
              fontSize: 18,
              bold: true,
              fontFace: "Space Grotesk",
            });
            const maxW = 9;
            const maxH = 5;
            let w = maxW;
            let h = (img.height / Math.max(1, img.width)) * w;
            if (h > maxH) {
              h = maxH;
              w = (img.width / Math.max(1, img.height)) * h;
            }
            slide.addImage({ data: img.data, x: 0.5, y: 0.8, w, h });
          });
        }

        // Add remaining analysis text slides (global context), chunked to fit.
        const residualText = cleanMarkdownText(
          sections.length > 0
            ? ""
            : markdownText || reportElement.innerText || "",
        );
        const paragraphs = residualText
          .split(/\n\s*\n/)
          .map((p) => p.trim())
          .filter(Boolean);

        if (paragraphs.length > 0) {
          let slide = pres.addSlide();
          slide.addText("Analysis Insights", {
            x: 0.5,
            y: 0.4,
            fontSize: 20,
            bold: true,
            fontFace: "Space Grotesk",
          });
          let yPos = 1.1;

          paragraphs.forEach((p) => {
            const isHeading = /^\s*#{1,6}\s+/.test(p);
            const cleaned = p
              .replace(/^#+\s*/, "")
              .replace(/^>\s*/, "")
              .replace(/\*\*/g, "")
              .replace(/\*/g, "")
              .trim();

            if (yPos > 5.5) {
              slide = pres.addSlide();
              slide.addText("Analysis Insights (Cont.)", {
                x: 0.5,
                y: 0.3,
                fontSize: 20,
                bold: true,
                fontFace: "Space Grotesk",
              });
              yPos = 0.9;
            }

            if (isHeading) {
              slide.addText(cleaned, {
                x: 0.5,
                y: yPos,
                w: 9,
                h: 1.2,
                fontSize: 14,
                bold: true,
                color: "#222222",
                fontFace: "Space Grotesk",
              });
              yPos += 1.2;
            } else {
              slide.addText(cleaned, {
                x: 0.5,
                y: yPos,
                w: 9,
                h: 1.2,
                fontSize: 12,
                color: "444444",
                fontFace: "Space Grotesk",
              });
              yPos += 1.2;
            }
          });
        }

        // Write file
        const safeFileName = `${titleText
          .substring(0, 50)
          .replace(/[^a-z0-9 _-]/gi, "_")}_${Date.now()}.pptx`;
        await pres.writeFile({ fileName: safeFileName });

        showMessage("PowerPoint exported (client-side)", "success");
        return;
      } catch (clientErr) {
        // If client-side export fails (e.g., dependency not installed), fall back to server approach
        console.warn(
          "Client-side PPTX export failed, falling back to server export:",
          clientErr,
        );
      }

      // Fallback: use server-side template merge (existing behavior)
      let canvas: HTMLCanvasElement | null = null;
      try {
        canvas = await html2canvas(reportElement, {
          backgroundColor: "#ffffff",
          scale: 2,
          useCORS: true,
          allowTaint: true,
          scrollX: 0,
          scrollY: 0,
          width: reportElement.scrollWidth + 4,
          height: reportElement.scrollHeight + 4,
          logging: false,
        });
      } finally {
        try {
          restoreColors();
        } catch (e) {
          /* ignore */
        }
        try {
          restoreSafe();
        } catch (e) {
          /* ignore */
        }
      }

      if (!canvas) {
        showMessage("Failed to generate image", "error");
        setIsExporting(false);
        return;
      }

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas!.toBlob(resolve, "image/png", 0.95),
      );
      if (!blob) {
        showMessage("Failed to generate image", "error");
        setIsExporting(false);
        return;
      }

      const form = new FormData();
      form.append(
        "image",
        new File([blob], "report.png", { type: "image/png" }),
      );
      form.append(
        "template",
        "HOYA MD Presentation Template v4 20241126 Internal.pptx",
      );
      // Derive title from the report source: prefer the first non-empty non-code line from generatedReport
      const deriveTitle = (source: string) => {
        const lines = source.split(/\r?\n/);
        let inCode = false;
        for (const raw of lines) {
          const line = raw.trim();
          if (!line) continue;
          if (line.startsWith("```")) {
            inCode = !inCode;
            continue;
          }
          if (inCode) continue;
          // strip markdown heading markers and blockquote
          const cleaned = line.replace(/^#+\s*/, "").replace(/^>\s*/, "");
          if (cleaned) return cleaned;
        }
        return "Report";
      };
      const titleText = deriveTitle(
        generatedReport || reportElement.textContent || "",
      );
      form.append("title", titleText.substring(0, 250));

      const resp = await fetch("/api/export/pptx", {
        method: "POST",
        body: form,
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || "Export failed");
      }

      const pptBlob = await resp.blob();
      const url = URL.createObjectURL(pptBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `report-${Date.now()}.pptx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);

      showMessage("PowerPoint exported (server-side)", "success");
    } catch (err) {
      console.error(err);
      showMessage("Failed to export PowerPoint", "error");
    } finally {
      try {
        // Ensure restores run if client path returned early
        restoreColors();
      } catch (e) {}
      try {
        restoreSafe();
      } catch (e) {}
      setIsExporting(false);
    }
  };

  // Update like this:
  const processReport = (rawReport: string): string => {
    const markdownMatch = rawReport.match(/```markdown\n([\s\S]*?)(?:\n```)?$/);
    let processed = markdownMatch ? markdownMatch[1] : rawReport;

    Object.entries(cachedReportImages).forEach(
      ([chartId, { url, width, height }]) => {
        processed = processed.replace(
          new RegExp(`\\[IMAGE\\(${chartId}\\)\\]`, "g"),
          `<img src="${url}" alt="Chart" width="${width}" height="${height}" />`,
        );
      },
    );

    return processed;
  };

  const loadReport = (reportId: string, forceRegenerate: boolean = false) => {
    const report = allGeneratedReports.find((r) => r.id === reportId);
    if (!report) return;

    setCurrentReportId(reportId);
    setGeneratedReport(report.content);
    setGeneratedStyle(report.style);

    // Fire all chart image loading in background â€” never block the UI thread.
    // Mark stale/missing charts as loading so compose view shows skeletons.
    const staleIds: string[] = [];
    for (const chartId of report.selectedChartIds) {
      const chart = charts.find((c) => c.id === chartId);
      if (!chart) continue;
      if (chart.chartType === "Table" || chart.chartType === "?") continue;
      const cached = chartPreviewImages[chart.id];
      const hasSample = Boolean(chartSampleData[chart.id]);
      const isFresh =
        cached?.url &&
        cached.dataVersion === (chart.dataVersion || 0) &&
        !hasSample &&
        !forceRegenerate;
      if (isFresh) {
        // Already fresh â€” use immediately
        updateCachedReportImages(
          chart.id,
          cached.url,
          cached.width,
          cached.height,
          cached.dataVersion,
        );
      } else {
        staleIds.push(chartId);
      }
    }

    if (staleIds.length > 0) {
      setLoadingChartIds((prev) => new Set([...prev, ...staleIds]));

      // Generate stale charts in background, batch of 2 to keep UI responsive
      (async () => {
        const BATCH = 2;
        for (let i = 0; i < staleIds.length; i += BATCH) {
          const batch = staleIds.slice(i, i + BATCH);
          await Promise.allSettled(
            batch.map(async (chartId) => {
              const chart = charts.find((c) => c.id === chartId);
              const chartTable = chart
                ? tables.find((t) => t.id === chart.tableRef)
                : undefined;
              if (!chart || !chartTable) return;
              try {
                const original =
                  chartOriginalTables[chart.id] ||
                  (await waitForOriginalTable(chart.id, 800));
                const sample =
                  chartSampleData[chart.id] ||
                  ((await waitForChartSampleReady(chart.id, 800)) &&
                    chartSampleDataRef.current[chart.id]);
                const generated = await getChartImageFromVega(
                  chart,
                  chartTable,
                  sample,
                );
                if (generated.dataUrl) {
                  updateCachedReportImages(
                    chart.id,
                    generated.dataUrl,
                    generated.width,
                    generated.height,
                    chart.dataVersion || 0,
                  );
                  dispatch(
                    dfActions.updateChartPreviewImage({
                      chartId: chart.id,
                      url: generated.dataUrl,
                      width: generated.width,
                      height: generated.height,
                      dataVersion: chart.dataVersion || 0,
                    }),
                  );
                }
              } catch (e) {
                console.warn(
                  `loadReport: failed to generate preview for ${chartId}:`,
                  e,
                );
              } finally {
                setLoadingChartIds((prev) => {
                  const next = new Set(prev);
                  next.delete(chartId);
                  return next;
                });
              }
            }),
          );
          // yield to browser idle between batches
          await yieldToIdle();
        }
      })();
    }
  };

  useEffect(() => {
    if (currentReportId === undefined && allGeneratedReports.length > 0) {
      loadReport(allGeneratedReports[0].id);
    }
  }, [currentReportId]);

  // When the app switches to Report view, load the current report.
  // loadReport is non-blocking â€” it fires background tasks and returns immediately.
  useEffect(() => {
    if (viewMode === "report" && currentReportId) {
      loadReport(currentReportId, false);
    }
  }, [viewMode, currentReportId]);

  // Sort charts based on data thread ordering
  const sortedCharts = useMemo(() => {
    // Create table order mapping (anchored tables get higher order)
    const tableOrder = Object.fromEntries(
      tables.map((table, index) => [
        table.id,
        index + (table.anchored ? 1 : 0) * tables.length,
      ]),
    );

    // Get ancestor orders for a table
    const getAncestorOrders = (table: DictTable): number[] => {
      const triggers = getTriggers(table, tables);
      return [
        ...triggers.map((t) => tableOrder[t.tableId]),
        tableOrder[table.id],
      ];
    };

    // Sort charts by their associated table's ancestor orders
    return [...charts].sort((chartA, chartB) => {
      const tableA = getDataTable(chartA, tables, charts, conceptShelfItems);
      const tableB = getDataTable(chartB, tables, charts, conceptShelfItems);

      const ordersA = getAncestorOrders(tableA);
      const ordersB = getAncestorOrders(tableB);

      // Compare orders element by element
      for (let i = 0; i < Math.min(ordersA.length, ordersB.length); i++) {
        if (ordersA[i] !== ordersB[i]) {
          return ordersA[i] - ordersB[i];
        }
      }

      // If all orders are equal, compare by length
      return ordersA.length - ordersB.length;
    });
  }, [charts, tables, conceptShelfItems]);

  // Clean up Blob URLs on unmount
  useEffect(() => {
    return () => {
      // Clean up preview images (these are always blob URLs)
      previewImages.forEach(({ url }) => {
        if (url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, []); // Only cleanup on unmount, not when images change

  // Get cached preview images from Redux
  const chartPreviewImages = useSelector(dfSelectors.getChartPreviewImages);

  // Keep a ref to the latest chartOriginalTables so async functions can poll it
  const chartOriginalTablesRef =
    useRef<Record<string, any[]>>(chartOriginalTables);
  useEffect(() => {
    chartOriginalTablesRef.current = chartOriginalTables;
  }, [chartOriginalTables]);

  // Keep a ref to the latest chartSampleData so async functions can poll it
  const chartSampleDataRef = useRef<Record<string, any[]>>(chartSampleData);
  useEffect(() => {
    chartSampleDataRef.current = chartSampleData;
  }, [chartSampleData]);

  // Keep a ref to the latest chartSampleReady timestamps so async funcs can poll it
  const chartSampleReadyRef = useRef<Record<string, number>>(chartSampleReady);
  useEffect(() => {
    chartSampleReadyRef.current = chartSampleReady;
  }, [chartSampleReady]);

  // Wait for original table to appear in Redux (small polling) to avoid race
  const waitForOriginalTable = async (
    chartId: string,
    timeoutMs: number = 5000,
  ): Promise<any[] | undefined> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const val = chartOriginalTablesRef.current?.[chartId];
      if (val) return val;
      // small pause
      await new Promise((r) => setTimeout(r, 80));
    }
    console.debug(
      `waitForOriginalTable: timed out waiting for originalTable for ${chartId}`,
    );
    return undefined;
  };

  // Wait for chart sample data to appear in Redux (small polling) to avoid race
  const waitForChartSampleData = async (
    chartId: string,
    timeoutMs: number = 5000,
  ): Promise<any[] | undefined> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const val = chartSampleDataRef.current?.[chartId];
      if (val) return val;
      // small pause
      await new Promise((r) => setTimeout(r, 80));
    }
    console.debug(
      `waitForChartSampleData: timed out waiting for sampleData for ${chartId}`,
    );
    return undefined;
  };

  // Wait for chart sample-ready timestamp (set by Visualization when it updates)
  const waitForChartSampleReady = async (
    chartId: string,
    timeoutMs: number = 5000,
  ): Promise<number | undefined> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ts = chartSampleReadyRef.current?.[chartId];
      if (ts) return ts;
      await new Promise((r) => setTimeout(r, 80));
    }
    console.debug(
      `waitForChartSampleReady: timed out waiting for sampleReady for ${chartId}`,
    );
    return undefined;
  };

  // Sync cached preview images from Redux to local preview state
  useEffect(() => {
    const newPreviewImages = new Map(previewImages);
    let hasChanges = false;

    Object.entries(chartPreviewImages).forEach(([chartId, imageData]) => {
      if (!previewImages.has(chartId)) {
        newPreviewImages.set(chartId, imageData);
        hasChanges = true;
      }
    });

    if (hasChanges) {
      setPreviewImages(newPreviewImages);
    }
  }, [chartPreviewImages]);

  // Generate missing preview images on-demand and cache them in Redux (parallel, batch of 4)
  useEffect(() => {
    let isMounted = true;

    const refreshPreviewsInBackground = async () => {
      const chartsToRefresh = sortedCharts.filter((chart) => {
        if (
          chart.chartType === "Table" ||
          chart.chartType === "?" ||
          chart.chartType === "Auto"
        )
          return false;
        const cached = chartPreviewImages[chart.id];
        if (cached?.url && cached.dataVersion === (chart.dataVersion || 0))
          return false;
        if (!tables.find((t) => t.id === chart.tableRef)) return false;
        return true;
      });

      if (chartsToRefresh.length === 0) return;

      // Mark all as loading upfront
      setLoadingChartIds(new Set(chartsToRefresh.map((c) => c.id)));

      const BATCH = 4;
      for (let i = 0; i < chartsToRefresh.length; i += BATCH) {
        if (!isMounted) break;
        const batch = chartsToRefresh.slice(i, i + BATCH);

        await yieldToIdle();
        if (!isMounted) break;

        await Promise.allSettled(
          batch.map(async (chart) => {
            const chartTable = tables.find((t) => t.id === chart.tableRef)!;
            try {
              const sample =
                chartSampleData[chart.id] ||
                ((await waitForChartSampleReady(chart.id, 1500)) &&
                  chartSampleDataRef.current[chart.id]);
              const { dataUrl, width, height } = await getChartImageFromVega(
                chart,
                chartTable,
                sample,
              );
              if (isMounted && dataUrl) {
                dispatch(
                  dfActions.updateChartPreviewImage({
                    chartId: chart.id,
                    url: dataUrl,
                    width,
                    height,
                    dataVersion: chart.dataVersion || 0,
                  }),
                );
              }
            } catch (err) {
              console.warn(
                `Failed to refresh preview for chart ${chart.id}:`,
                err,
              );
            } finally {
              if (isMounted) {
                setLoadingChartIds((prev) => {
                  const next = new Set(prev);
                  next.delete(chart.id);
                  return next;
                });
              }
            }
          }),
        );
      }
    };

    // Start background refresh (don't await)
    refreshPreviewsInBackground();

    return () => {
      isMounted = false;
    };
  }, [sortedCharts, tables, chartSampleData, chartOriginalTables, dispatch]);

  const toggleChartSelection = (chartId: string) => {
    const newSelection = new Set(selectedChartIds);
    if (newSelection.has(chartId)) {
      newSelection.delete(chartId);
    } else {
      newSelection.add(chartId);
    }
    setSelectedChartIds(newSelection);
  };

  const selectAll = () => {
    // Only select charts that have a loaded preview (not still loading)
    const availableChartIds = sortedCharts
      .filter((chart) => {
        const isUnavailable =
          chart.chartType === "Table" ||
          chart.chartType === "?" ||
          chart.chartType === "Auto";
        return !isUnavailable && previewImages.has(chart.id);
      })
      .map((c) => c.id);
    setSelectedChartIds(new Set(availableChartIds));
  };

  const deselectAll = () => {
    setSelectedChartIds(new Set());
  };

  const getChartImageFromVega = async (
    chart: any,
    chartTable: any,
    chartSampleDataForChart?: any[],
  ): Promise<{ dataUrl: string; width: number; height: number }> => {
    try {
      return await generateChartPreview(
        chart,
        chartTable,
        conceptShelfItems,
        config.defaultChartWidth,
        config.defaultChartHeight,
        chartSampleDataForChart,
      );
    } catch (e) {
      console.warn("Could not capture chart image:", e);
      return { dataUrl: "", width: 0, height: 0 };
    }
  };

  const generateReport = async () => {
    if (selectedChartIds.size === 0) {
      setError("Please select at least one chart");
      return;
    }

    setIsGenerating(true);
    setError("");
    setGeneratedReport("");
    setGeneratedStyle(style);

    // Create a new report ID
    const reportId = `report-${Date.now()}-${Math.floor(
      Math.random() * 10000,
    )}`;

    try {
      const model = models.find((m) => m.id === modelSlot.generation);
      if (!model) {
        throw new Error("No model selected");
      }

      const inputTables = tables
        .filter((t) => t.anchored)
        .map((table) => ({
          name: table.id,
          rows: table.rows,
          attached_metadata: table.attachedMetadata,
        }));

      const selectedCharts = await Promise.all(
        sortedCharts
          .filter((chart) => selectedChartIds.has(chart.id))
          .map(async (chart) => {
            const chartTable = tables.find((t) => t.id === chart.tableRef);
            if (!chartTable) return null;

            if (chart.chartType === "Table" || chart.chartType === "?") {
              return null;
            }

            // Try to use cached preview image first to ensure consistency with what user sees
            let dataUrl = "";
            let width = 0;
            let height = 0;

            if (
              chartPreviewImages[chart.id] &&
              chartPreviewImages[chart.id].url
            ) {
              // Use cached preview image - this ensures report image matches preview
              dataUrl = chartPreviewImages[chart.id].url;
              width = chartPreviewImages[chart.id].width;
              height = chartPreviewImages[chart.id].height;
            } else {
              // Fall back to generating if no cached preview
              const original =
                chartOriginalTables[chart.id] ||
                (await waitForOriginalTable(chart.id, 800));
              const sample =
                chartSampleData[chart.id] ||
                ((await waitForChartSampleReady(chart.id, 800)) &&
                  chartSampleDataRef.current[chart.id]);
              console.log(
                "ReportView: calling getChartImageFromVega (generateReport fallback)",
                {
                  chartId: chart.id,
                  hasSample: !!sample,
                  hasOriginal: !!original,
                  dataVersion: chart.dataVersion,
                  ts: Date.now(),
                },
              );
              const generated = await getChartImageFromVega(
                chart,
                chartTable,
                sample,
              );
              dataUrl = generated.dataUrl;
              width = generated.width;
              height = generated.height;
            }

            if (dataUrl) {
              // Cache dataUrl (base64 string) - this is persistent and won't be revoked
              updateCachedReportImages(
                chart.id,
                dataUrl,
                width,
                height,
                chart.dataVersion || 0,
              );
            }

            return {
              chart_id: chart.id,
              code: chartTable.derive?.code || "",
              chart_data: {
                name: chartTable.id,
                rows: chartTable.rows,
              },
              chart_url: dataUrl, // Send dataUrl to server (server can process this)
            };
          }),
      );

      const validCharts = selectedCharts.filter((c) => c !== null);

      const requestBody = {
        model: model,
        input_tables: inputTables,
        charts: validCharts,
        style: style,
        language: tables.some((t) => t.virtual) ? "sql" : "python",
        report_language: reportLanguage,
      };

      const response = await fetch(getUrls().GENERATE_REPORT_STREAM, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        let detail = `Failed to generate report (HTTP ${response.status})`;
        try {
          const raw = await response.text();
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              detail =
                parsed?.content || parsed?.error || parsed?.message || detail;
            } catch {
              detail = raw.slice(0, 500);
            }
          }
        } catch {
          // keep default detail
        }
        throw new Error(detail);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let accumulatedReport = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // Create the report object for saving to Redux
          const report: GeneratedReport = {
            id: reportId,
            content: accumulatedReport,
            style: style,
            selectedChartIds: Array.from(selectedChartIds),
            createdAt: Date.now(),
          };
          // Save to Redux state
          dispatch(dfActions.saveGeneratedReport(report));
          break;
        }

        const chunk = decoder.decode(value, { stream: true });

        if (chunk.startsWith("error:")) {
          const errorData = JSON.parse(chunk.substring(6));
          throw new Error(
            errorData.content ||
              errorData.debug_hint ||
              "Error generating report",
          );
        }

        accumulatedReport += chunk;

        // Update local state
        setGeneratedReport(accumulatedReport);
        setCurrentReportId(reportId);

        if (mode === "compose") {
          setMode("post");
        }
      }
    } catch (err) {
      setError((err as Error).message || "Failed to generate report");
    } finally {
      setIsGenerating(false);
    }
  };

  const deleteReport = (reportId: string, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent triggering the card click
    dispatch(dfActions.deleteGeneratedReport(reportId));

    // If we're deleting the currently viewed report, switch to another report or clear the view
    if (currentReportId === reportId) {
      const remainingReports = allGeneratedReports.filter(
        (r) => r.id !== reportId,
      );
      if (remainingReports.length > 0) {
        // Switch to the first remaining report
        loadReport(remainingReports[0].id);
      } else {
        // No reports left, clear the view and go back to compose mode
        setCurrentReportId(undefined);
        setGeneratedReport("");
        setGeneratedStyle("short note");
        setMode("compose");
      }
    }
  };

  let displayedReport = isGenerating
    ? `${generatedReport} <span class="pencil" style="opacity: 0.4; margin-left: 2px;">âœï¸</span>`
    : generatedReport;
  displayedReport = processReport(displayedReport);

  return (
    <Box
      sx={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {mode === "compose" ? (
        <Box sx={{ overflowY: "auto", position: "relative", height: "100%" }}>
          <Box sx={{ p: 2, pb: 0, display: "flex" }}>
            <Button
              variant="text"
              size="small"
              color="secondary"
              onClick={() => dispatch(dfActions.setViewMode("editor"))}
              sx={{ textTransform: "none" }}
              startIcon={<ArrowBackIcon />}
            >
              back to explore
            </Button>
            <Divider orientation="vertical" sx={{ mx: 1 }} flexItem />
            <Button
              variant="text"
              disabled={allGeneratedReports.length === 0}
              size="small"
              onClick={() => setMode("post")}
              sx={{ textTransform: "none" }}
              endIcon={<ArrowForwardIcon />}
            >
              view reports
            </Button>
          </Box>
          {/* Centered Top Bar */}
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              p: 2,
            }}
          >
            <Paper
              elevation={0}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                p: 1,
                borderRadius: 2,
                backgroundColor: "rgba(255, 255, 255, 0.9)",
                backdropFilter: "blur(12px)",
                border: "1px solid",
                borderColor: "rgba(0, 0, 0, 0.08)",
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.06)",
                "&:hover": {
                  backgroundColor: "rgba(255, 255, 255, 0.95)",
                  borderColor: "rgba(0, 0, 0, 0.12)",
                  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
                  transition: "all 0.2s ease-in-out",
                },
                ".MuiTypography-root": {
                  fontSize: "1rem",
                },
              }}
            >
              {/* Natural Flow */}
              <Typography
                variant="body2"
                color="text.primary"
                sx={{ fontWeight: 500 }}
              >
                Create a
              </Typography>

              <ToggleButtonGroup
                value={style}
                exclusive
                onChange={(e, newStyle) => newStyle && setStyle(newStyle)}
                size="small"
                sx={{
                  "& .MuiToggleButtonGroup-grouped": {
                    border: "none",
                    backgroundColor: "action.hover",
                    margin: "0 2px",
                    borderRadius: "4px",
                    "&:hover": {
                      backgroundColor: "action.selected",
                    },
                    "&.Mui-selected": {
                      backgroundColor: "primary.main",
                      color: "white",
                      "&:hover": {
                        backgroundColor: "primary.dark",
                      },
                    },
                  },
                }}
              >
                {[
                  { value: "short note", label: "short note" },
                  { value: "blog post", label: "blog post" },
                  { value: "social post", label: "social post" },
                  { value: "executive summary", label: "executive summary" },
                ].map((option) => (
                  <ToggleButton
                    key={option.value}
                    value={option.value}
                    sx={{
                      px: 1,
                      py: 0.25,
                      textTransform: "none",
                      fontSize: "1rem",
                      minWidth: "auto",
                    }}
                  >
                    {option.label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>

              <Typography
                variant="body2"
                color="text.primary"
                sx={{ fontWeight: 500 }}
              >
                in
              </Typography>

              <Select
                value={reportLanguage}
                onChange={(e) => setReportLanguage(e.target.value)}
                size="small"
                renderValue={(selected) => {
                  const languageIcons: Record<
                    string,
                    { icon: string; label: string }
                  > = {
                    en: { icon: usaFlagIcon, label: "English" },
                    vi: { icon: vietnamFlagIcon, label: "Tiáº¿ng Viá»‡t" },
                    th: { icon: thailandFlagIcon, label: "à¹„à¸—à¸¢" },
                    lo: { icon: laosFlagIcon, label: "Lao" },
                    ja: { icon: japanFlagIcon, label: "æ—¥æœ¬èªž" },
                  };
                  const lang =
                    languageIcons[selected as string] || languageIcons.en;
                  return (
                    <Box
                      sx={{ display: "flex", alignItems: "center", gap: 0.8 }}
                    >
                      <Box
                        component="img"
                        src={lang.icon}
                        alt={lang.label}
                        sx={{ width: 18, height: 18, borderRadius: "2px" }}
                      />
                      <span>{lang.label}</span>
                    </Box>
                  );
                }}
                sx={{
                  minWidth: 140,
                  height: 32,
                  backgroundColor: "action.hover",
                  borderRadius: 1,
                  "& .MuiOutlinedInput-notchedOutline": {
                    border: "none",
                  },
                  "&:hover": {
                    backgroundColor: "action.selected",
                  },
                  "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                    border: "1px solid",
                    borderColor: "primary.main",
                  },
                  "& .MuiSelect-select": {
                    textTransform: "none",
                    fontSize: "1rem",
                    display: "flex",
                    alignItems: "center",
                  },
                }}
              >
                <MenuItem value="en">
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Box
                      component="img"
                      src={usaFlagIcon}
                      alt="English"
                      sx={{ width: 20, height: 20, borderRadius: "2px" }}
                    />
                    English
                  </Box>
                </MenuItem>
                <MenuItem value="vi">
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Box
                      component="img"
                      src={vietnamFlagIcon}
                      alt="Tiáº¿ng Viá»‡t"
                      sx={{ width: 20, height: 20, borderRadius: "2px" }}
                    />
                    Tiáº¿ng Viá»‡t
                  </Box>
                </MenuItem>
                <MenuItem value="th">
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Box
                      component="img"
                      src={thailandFlagIcon}
                      alt="à¹„à¸—à¸¢"
                      sx={{ width: 20, height: 20, borderRadius: "2px" }}
                    />
                    à¹„à¸—à¸¢
                  </Box>
                </MenuItem>
                <MenuItem value="lo">
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Box
                      component="img"
                      src={laosFlagIcon}
                      alt="Lao"
                      sx={{ width: 20, height: 20, borderRadius: "2px" }}
                    />
                    Lao
                  </Box>
                </MenuItem>
                <MenuItem value="ja">
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Box
                      component="img"
                      src={japanFlagIcon}
                      alt="æ—¥æœ¬èªž"
                      sx={{ width: 20, height: 20, borderRadius: "2px" }}
                    />
                    æ—¥æœ¬èªž
                  </Box>
                </MenuItem>
              </Select>

              <Typography
                variant="body2"
                color="text.primary"
                sx={{ fontWeight: 500 }}
              >
                from
              </Typography>

              <Typography
                variant="body2"
                color={
                  selectedChartIds.size === 0 ? "warning.main" : "primary.main"
                }
                sx={{ fontWeight: "bold" }}
              >
                {selectedChartIds.size}
              </Typography>

              <Typography
                variant="body2"
                color="text.primary"
                sx={{ fontWeight: 500 }}
              >
                {selectedChartIds.size <= 1 ? "chart" : "charts"}
              </Typography>

              {/* Generate Button */}
              <Button
                variant="contained"
                disabled={isGenerating || selectedChartIds.size === 0}
                onClick={generateReport}
                size="small"
                sx={{
                  textTransform: "none",
                  ml: 2,
                  px: 2,
                  py: 0.75,
                  borderRadius: 1.5,
                  fontWeight: 500,
                  fontSize: "1rem",
                  minWidth: "auto",
                }}
                startIcon={
                  isGenerating ? (
                    <CircularProgress size={14} />
                  ) : (
                    <EditIcon sx={{ fontSize: 16 }} />
                  )
                }
              >
                {isGenerating ? "composing..." : "compose"}
              </Button>
            </Paper>
          </Box>

          <Box sx={{ py: 2, px: 6 }}>
            {error && (
              <Alert
                severity="error"
                sx={{ mb: 2 }}
                onClose={() => setError("")}
              >
                {error}
              </Alert>
            )}

            {sortedCharts.length === 0 ? (
              <Typography color="text.secondary">
                No charts available. Create some visualizations first.
              </Typography>
            ) : (
              (() => {
                // Filter out only truly unavailable chart types; loading charts get skeleton cards
                const availableCharts = sortedCharts.filter((chart) => {
                  return (
                    chart.chartType !== "Table" &&
                    chart.chartType !== "?" &&
                    chart.chartType !== "Auto"
                  );
                });

                if (availableCharts.length === 0) {
                  return (
                    <Typography color="text.secondary">
                      No charts available. Create some visualizations first.
                    </Typography>
                  );
                }

                // Walk up derive chain to find root table for a given table
                const findRootTable = (
                  startTable: (typeof tables)[number],
                ): (typeof tables)[number] => {
                  let t = startTable;
                  while (true) {
                    if (!t.derive) return t;
                    if (t !== startTable && t.anchored) return t;
                    const parentId = t.derive.trigger.tableId;
                    const parent = tables.find((x) => x.id === parentId);
                    if (!parent) return t;
                    t = parent;
                  }
                };

                // Build 3-level structure: rootId â†’ { rootTable, subGroups: { directId â†’ { directTable, charts[] } } }
                type SubGroup = {
                  directTable: (typeof tables)[number] | undefined;
                  charts: typeof availableCharts;
                };
                type RootGroup = {
                  rootTable: (typeof tables)[number] | undefined;
                  subGroups: Record<string, SubGroup>;
                };
                const chartsByRoot: Record<string, RootGroup> = {};

                availableCharts.forEach((chart) => {
                  const directTable = tables.find(
                    (t) => t.id === chart.tableRef,
                  );
                  const rootTable = directTable
                    ? findRootTable(directTable)
                    : undefined;
                  const rootId = rootTable?.id ?? chart.tableRef;
                  if (!chartsByRoot[rootId])
                    chartsByRoot[rootId] = { rootTable, subGroups: {} };
                  if (!chartsByRoot[rootId].subGroups[chart.tableRef])
                    chartsByRoot[rootId].subGroups[chart.tableRef] = {
                      directTable,
                      charts: [],
                    };
                  chartsByRoot[rootId].subGroups[chart.tableRef].charts.push(
                    chart,
                  );
                });

                const rootIds = Object.keys(chartsByRoot);
                const getRootAccentColor = (rootId: string) =>
                  TABLE_ACCENT_COLORS[
                    rootIds.indexOf(rootId) % TABLE_ACCENT_COLORS.length
                  ];

                const toggleRootSelection = (rootId: string) => {
                  const ids = Object.values(
                    chartsByRoot[rootId].subGroups,
                  ).flatMap((sg) => sg.charts.map((c) => c.id));
                  const allSelected = ids.every((id) =>
                    selectedChartIds.has(id),
                  );
                  const next = new Set(selectedChartIds);
                  if (allSelected) ids.forEach((id) => next.delete(id));
                  else ids.forEach((id) => next.add(id));
                  setSelectedChartIds(next);
                };

                const toggleSubGroupSelection = (
                  directId: string,
                  rootId: string,
                ) => {
                  const ids = chartsByRoot[rootId].subGroups[
                    directId
                  ].charts.map((c) => c.id);
                  const allSelected = ids.every((id) =>
                    selectedChartIds.has(id),
                  );
                  const next = new Set(selectedChartIds);
                  if (allSelected) ids.forEach((id) => next.delete(id));
                  else ids.forEach((id) => next.add(id));
                  setSelectedChartIds(next);
                };

                return (
                  <Box
                    sx={{ display: "flex", flexDirection: "column", gap: 4 }}
                  >
                    {rootIds.map((rootId) => {
                      const { rootTable, subGroups } = chartsByRoot[rootId];
                      const accentColor = getRootAccentColor(rootId);
                      const allChartIds = Object.values(subGroups).flatMap(
                        (sg) => sg.charts.map((c) => c.id),
                      );
                      const rootSelectedCount = allChartIds.filter((id) =>
                        selectedChartIds.has(id),
                      ).length;
                      const allRootSelected =
                        rootSelectedCount === allChartIds.length;

                      return (
                        <Box key={rootId}>
                          {/* Root-level header */}
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 1,
                              mb: 2,
                              pb: 1,
                              borderBottom: `3px solid ${accentColor}`,
                            }}
                          >
                            <Box
                              sx={{
                                width: 12,
                                height: 12,
                                borderRadius: "50%",
                                backgroundColor: accentColor,
                                flexShrink: 0,
                              }}
                            />
                            <Typography
                              variant="subtitle1"
                              sx={{ fontWeight: 700, flex: 1 }}
                            >
                              {rootTable?.displayId ?? rootId}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ mr: 0.5 }}
                            >
                              {rootSelectedCount}/{allChartIds.length} selected
                            </Typography>
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => toggleRootSelection(rootId)}
                              sx={{
                                textTransform: "none",
                                fontSize: 11,
                                color: accentColor,
                                borderColor: accentColor,
                                py: 0.25,
                                px: 1,
                                minWidth: 0,
                                "&:hover": {
                                  borderColor: accentColor,
                                  backgroundColor: alpha(accentColor, 0.08),
                                },
                              }}
                            >
                              {allRootSelected ? "Deselect all" : "Select all"}
                            </Button>
                          </Box>

                          {/* All charts in one horizontal scrollable row */}
                          <Box
                            sx={{
                              display: "flex",
                              flexDirection: "row",
                              flexWrap: "nowrap",
                              gap: 1.5,
                              overflowX: "auto",
                              minWidth: 0,
                              pb: 1,
                              "&::-webkit-scrollbar": { height: 4 },
                              "&::-webkit-scrollbar-thumb": {
                                backgroundColor: alpha(accentColor, 0.3),
                                borderRadius: 2,
                              },
                            }}
                          >
                            {Object.entries(subGroups).flatMap(
                              ([
                                directId,
                                { directTable, charts: subCharts },
                              ]) =>
                                subCharts.map((chart) => {
                                  const previewImage = previewImages.get(
                                    chart.id,
                                  );
                                  const isLoading =
                                    !previewImage &&
                                    loadingChartIds.has(chart.id);
                                  const isSelected = selectedChartIds.has(
                                    chart.id,
                                  );
                                  const showBadge = directId !== rootId;
                                  return (
                                    <Card
                                      key={chart.id}
                                      variant="outlined"
                                      sx={{
                                        cursor: isLoading
                                          ? "default"
                                          : "pointer",
                                        position: "relative",
                                        overflow: "hidden",
                                        flexShrink: 0,
                                        width: 200,
                                        backgroundColor: isSelected
                                          ? alpha(accentColor, 0.08)
                                          : "background.paper",
                                        border: isSelected
                                          ? "2px solid"
                                          : "1px solid",
                                        borderColor: isSelected
                                          ? accentColor
                                          : "divider",
                                        borderLeftColor: accentColor,
                                        borderLeftWidth: "4px",
                                        "&:hover": isLoading
                                          ? {}
                                          : {
                                              backgroundColor: alpha(
                                                accentColor,
                                                0.05,
                                              ),
                                              boxShadow: 3,
                                              transform: "translateY(-2px)",
                                              transition:
                                                "all 0.2s ease-in-out",
                                            },
                                      }}
                                      onClick={() =>
                                        !isLoading &&
                                        toggleChartSelection(chart.id)
                                      }
                                    >
                                      {isLoading ? (
                                        <Box>
                                          <Skeleton
                                            variant="rectangular"
                                            width="100%"
                                            height={130}
                                            sx={{
                                              backgroundColor: alpha(
                                                accentColor,
                                                0.08,
                                              ),
                                            }}
                                          />
                                          <CardContent
                                            sx={{
                                              p: 1,
                                              "&:last-child": { pb: 1 },
                                            }}
                                          >
                                            <Box
                                              sx={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 0.75,
                                              }}
                                            >
                                              <CircularProgress
                                                size={10}
                                                thickness={5}
                                                sx={{
                                                  color: accentColor,
                                                  flexShrink: 0,
                                                }}
                                              />
                                              <Skeleton
                                                variant="text"
                                                width="70%"
                                                height={14}
                                              />
                                            </Box>
                                          </CardContent>
                                        </Box>
                                      ) : previewImage ? (
                                        <Box>
                                          <Box sx={{ position: "relative" }}>
                                            {/* Derived-table badge â€” shown only when chart belongs to a derived table */}
                                            {showBadge && (
                                              <Box
                                                sx={{
                                                  position: "absolute",
                                                  top: 6,
                                                  left: 6,
                                                  zIndex: 3,
                                                  backgroundColor: alpha(
                                                    accentColor,
                                                    0.85,
                                                  ),
                                                  color: "#fff",
                                                  fontSize: 9,
                                                  fontWeight: 600,
                                                  px: 0.6,
                                                  py: 0.2,
                                                  borderRadius: 0.5,
                                                  maxWidth: 120,
                                                  overflow: "hidden",
                                                  textOverflow: "ellipsis",
                                                  whiteSpace: "nowrap",
                                                }}
                                              >
                                                {directTable?.displayId ??
                                                  directId}
                                              </Box>
                                            )}
                                            <Checkbox
                                              checked={isSelected}
                                              onChange={() =>
                                                toggleChartSelection(chart.id)
                                              }
                                              onClick={(e) =>
                                                e.stopPropagation()
                                              }
                                              sx={{
                                                position: "absolute",
                                                top: 4,
                                                right: 4,
                                                p: 0.5,
                                                zIndex: 3,
                                                backgroundColor:
                                                  "rgba(255,255,255,0.9)",
                                                borderRadius: 1,
                                                color: accentColor,
                                                "&.Mui-checked": {
                                                  color: accentColor,
                                                },
                                                "&:hover": {
                                                  backgroundColor:
                                                    "rgba(255,255,255,1)",
                                                },
                                              }}
                                            />
                                            <Box
                                              component="img"
                                              src={previewImage.url}
                                              alt={chart.chartType}
                                              sx={{
                                                p: 1,
                                                width: "calc(100% - 16px)",
                                                height: "auto",
                                                maxHeight:
                                                  config.defaultChartHeight,
                                                display: "block",
                                                objectFit: "contain",
                                                backgroundColor: "white",
                                              }}
                                            />
                                          </Box>
                                          <CardContent
                                            sx={{
                                              p: 1,
                                              "&:last-child": { pb: 1.5 },
                                            }}
                                          >
                                            <Typography
                                              variant="caption"
                                              sx={{
                                                display: "block",
                                                fontWeight: 500,
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                                whiteSpace: "nowrap",
                                              }}
                                            >
                                              {chart.chartType}
                                            </Typography>
                                          </CardContent>
                                        </Box>
                                      ) : null}
                                    </Card>
                                  );
                                }),
                            )}
                          </Box>
                        </Box>
                      );
                    })}
                  </Box>
                );
              })()
            )}
          </Box>
        </Box>
      ) : mode === "post" ? (
        <Box
          sx={{
            height: "100%",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <Box
            sx={{
              p: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Button
              size="small"
              disabled={isGenerating}
              startIcon={<ArrowBackIcon />}
              sx={{ textTransform: "none" }}
              onClick={() => setMode("compose")}
            >
              create a new report
            </Button>
            <Typography variant="body2" color="text.secondary">
              AI generated the post from the selected charts, and it could be
              inaccurate!
            </Typography>
          </Box>
          <Box
            sx={{
              flex: 1,
              display: "flex",
              overflow: "hidden",
              position: "relative",
            }}
          >
            {/* Table of Contents Sidebar */}
            {allGeneratedReports.length > 0 && (
              <Box
                sx={{
                  position: "absolute",
                  top: 0,
                  left: 8,
                  zIndex: 1,
                  width: 200,
                  display: "flex",
                  overflowY: "auto",
                  flexDirection: "column",
                  borderRight: 1,
                  borderColor: "divider",
                  height: "fit-content",
                  background: alpha(theme.palette.background.paper, 0.9),
                }}
              >
                <Button
                  size="small"
                  color="primary"
                  onClick={() => setHideTableOfContents(!hideTableOfContents)}
                  sx={{
                    width: "100%",
                    justifyContent: "flex-start",
                    textAlign: "left",
                    borderRadius: 0,
                    textTransform: "none",
                    fontSize: 12,
                    py: 1,
                    px: 2,
                  }}
                >
                  {hideTableOfContents ? (
                    <ExpandMoreIcon sx={{ fontSize: 16, mr: 1 }} />
                  ) : (
                    <ExpandLessIcon sx={{ fontSize: 16, mr: 1 }} />
                  )}{" "}
                  {hideTableOfContents ? "show all reports" : "reports"}
                </Button>
                <Collapse in={!hideTableOfContents}>
                  {allGeneratedReports.map((report) => (
                    <Box key={report.id} sx={{ position: "relative" }}>
                      <Button
                        variant="text"
                        size="small"
                        color="primary"
                        onClick={() => loadReport(report.id)}
                        sx={{
                          fontSize: 12,
                          textTransform: "none",
                          width: "100%",
                          justifyContent: "flex-start",
                          textAlign: "left",
                          borderRadius: 0,
                          py: 1,
                          px: 2,
                          color:
                            currentReportId === report.id
                              ? "primary.main"
                              : "text.secondary",
                          borderRight: currentReportId === report.id ? 2 : 0,
                          borderColor: "primary.main",
                        }}
                      >
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography
                            variant="body2"
                            sx={{
                              fontSize: "inherit",
                              fontWeight: 500,
                              mb: 0.25,
                            }}
                          >
                            {report.content.split("\n")[0]}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{
                              fontSize: 10,
                              display: "block",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {new Date(report.createdAt).toLocaleDateString()}{" "}
                            â€¢ {report.style}
                          </Typography>
                        </Box>
                      </Button>
                      <Tooltip title="Delete report">
                        <IconButton
                          size="small"
                          disabled={isGenerating}
                          color="warning"
                          onClick={(e) => deleteReport(report.id, e)}
                          sx={{
                            position: "absolute",
                            right: 4,
                            top: "50%",
                            transform: "translateY(-50%)",
                            width: 20,
                            height: 20,
                            "&:hover": {
                              transform: "translateY(-50%) scale(1.2)",
                              transition: "all 0.2s ease-in-out",
                            },
                          }}
                        >
                          <DeleteIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  ))}
                </Collapse>
              </Box>
            )}

            {/* Main Content Area */}
            <Box sx={{ flex: 1, overflowY: "auto", position: "relative" }}>
              {/* Action Buttons */}
              {currentReportId && (
                <Box
                  sx={{
                    position: "absolute",
                    top: 16,
                    right: 16,
                    zIndex: 10,
                    display: "flex",
                    gap: 1,
                  }}
                >
                  <Tooltip title="Create Chartifact report">
                    <Button
                      variant="contained"
                      size="small"
                      onClick={() => {
                        // Convert report to Chartifact markdown format
                        const chartifactMarkdown = convertToChartifact(
                          generatedReport,
                          generatedStyle,
                          charts,
                          tables,
                          conceptShelfItems,
                          config,
                        );
                        openChartifactViewer(chartifactMarkdown);
                      }}
                      sx={{
                        textTransform: "none",
                        backgroundColor: "primary.main",
                        color: "white",
                        "&:hover": {
                          backgroundColor: "primary.dark",
                        },
                      }}
                      startIcon={<CreateChartifact />}
                    >
                      Create Chartifact
                    </Button>
                  </Tooltip>
                  <Tooltip title="Export to PowerPoint">
                    <Button
                      variant="contained"
                      size="small"
                      onClick={exportToPowerPoint}
                      disabled={isExporting}
                      sx={{
                        textTransform: "none",
                        backgroundColor: "primary.main",
                        color: "white",
                        "&:hover": {
                          backgroundColor: "primary.dark",
                        },
                      }}
                      startIcon={
                        isExporting ? (
                          <CircularProgress size={14} />
                        ) : (
                          // Use user-supplied PNG if available, try '/pptx-icon.png' then '/assets/pptx-icon.png', fallback to SlideshowIcon
                          <PptxIcon />
                        )
                      }
                    >
                      {isExporting ? "Exporting..." : "Export to PowerPoint"}
                    </Button>
                  </Tooltip>
                  <Tooltip title="Share report as image">
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={
                        shareButtonSuccess ? <CheckCircleIcon /> : <ShareIcon />
                      }
                      onClick={shareReportAsImage}
                      sx={{
                        textTransform: "none",
                        backgroundColor: shareButtonSuccess
                          ? "success.main"
                          : "primary.main",
                        color: "white",
                        transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
                        opacity: shareButtonSuccess ? 0.9 : 1,
                        transform: shareButtonSuccess
                          ? "scale(0.98)"
                          : "scale(1)",
                        animation: shareButtonSuccess
                          ? "pulse 0.6s ease-in-out"
                          : "none",
                        "@keyframes pulse": {
                          "0%": { transform: "scale(0.98)" },
                          "50%": { transform: "scale(1.05)" },
                          "100%": { transform: "scale(0.98)" },
                        },
                        "&:hover": {
                          backgroundColor: shareButtonSuccess
                            ? "success.dark"
                            : "primary.dark",
                        },
                      }}
                    >
                      {shareButtonSuccess ? "Copied!" : "Share Image"}
                    </Button>
                  </Tooltip>
                </Box>
              )}

              <Box
                sx={{
                  display: "flex",
                  justifyContent: "center",
                  width: "100%",
                  py: 3,
                }}
              >
                <Box
                  data-report-content
                  sx={{
                    // Common styles
                    width: "100%",
                    WebkitFontSmoothing: "antialiased",
                    MozOsxFontSmoothing: "grayscale",
                    "& em": { fontStyle: "italic" },

                    // Conditional styles
                    ...(generatedStyle === "social post" ||
                    generatedStyle === "short note"
                      ? {
                          maxWidth: "720px",
                          borderRadius: "12px",
                          border: "1px solid",
                          borderColor: COLOR_SOCIAL_BORDER,
                          p: 2.5,
                          backgroundColor: "white",
                          fontFamily: FONT_FAMILY_SYSTEM,
                          fontSize: "0.875rem",
                          fontWeight: 400,
                          lineHeight: 1.4,
                          color: COLOR_SOCIAL_TEXT,
                          "& code": {
                            backgroundColor: `${COLOR_SOCIAL_ACCENT}1A`,
                            color: COLOR_SOCIAL_ACCENT,
                            padding: "0.1em 0.25em",
                            borderRadius: "3px",
                            fontSize: "0.8125rem",
                            fontWeight: 500,
                            fontFamily: FONT_FAMILY_MONO,
                          },
                          "& strong": {
                            fontWeight: 600,
                            color: COLOR_SOCIAL_TEXT,
                          },
                          "& img": {
                            width: "100%",
                            maxWidth: "100%",
                            height: "auto",
                            maxHeight: "280px",
                            objectFit: "contain",
                            borderRadius: "8px",
                            marginTop: "8px",
                            marginBottom: "8px",
                          },
                        }
                      : generatedStyle === "executive summary"
                      ? {
                          maxWidth: "900px",
                          p: 2.5,
                          backgroundColor: "white",
                          fontFamily: FONT_FAMILY_SERIF,
                          fontSize: "0.875rem",
                          lineHeight: 1.5,
                          color: COLOR_EXEC_TEXT,
                          "& code": {
                            backgroundColor: COLOR_EXEC_BG,
                            color: COLOR_EXEC_ACCENT,
                            padding: "0.1em 0.25em",
                            borderRadius: "2px",
                            fontSize: "0.75rem",
                            fontFamily: FONT_FAMILY_MONO,
                          },
                          "& strong": {
                            fontWeight: 600,
                            color: COLOR_EXEC_HEADING,
                          },
                          "& img": {
                            maxWidth: "70%",
                            maxHeight: config.defaultChartHeight * 1.5,
                            objectFit: "contain",
                            width: "auto",
                            height: "auto",
                            borderRadius: "3px",
                            marginTop: "1em",
                            marginBottom: "1em",
                          },
                        }
                      : {
                          maxWidth: "1000px",
                          px: 6,
                          py: 0,
                          backgroundColor: "background.paper",
                          ...BODY_TEXT_BASE,
                          "& code": {
                            backgroundColor: "rgba(135, 131, 120, 0.15)",
                            color: "#eb5757",
                            padding: "0.2em 0.4em",
                            borderRadius: "3px",
                            fontSize: "0.875rem",
                            fontWeight: 500,
                            fontFamily: FONT_FAMILY_MONO,
                          },
                          "& strong": { fontWeight: 600, color: COLOR_HEADING },
                          "& img": {
                            maxWidth: "75%",
                            maxHeight: config.defaultChartHeight * 1.5,
                            width: "auto",
                            height: "auto",
                            objectFit: "contain",
                            borderRadius: "4px",
                            marginTop: "1.75em",
                            marginBottom: "1.75em",
                          },
                        }),
                  }}
                >
                  <MuiMarkdown
                    overrides={
                      generatedStyle === "social post" ||
                      generatedStyle === "short note"
                        ? socialStyleMarkdownOverrides
                        : generatedStyle === "executive summary"
                        ? executiveSummaryMarkdownOverrides
                        : notionStyleMarkdownOverrides
                    }
                  >
                    {displayedReport}
                  </MuiMarkdown>

                  {/* Attribution */}
                  <Box
                    sx={{
                      mt: 3,
                      pt: 2,
                      borderTop: "1px solid #e0e0e0",
                      textAlign: "center",
                      fontSize: "0.75rem",
                      color: "#666",
                    }}
                  >
                    created with AI using{" "}
                    {/* <Link
                      href="https://github.com/xxx"
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{
                        color: "#1976d2",
                        textDecoration: "none",
                        "&:hover": {
                          textDecoration: "underline",
                        },
                      }}
                    >
                      https://github.com/xxx
                    </Link> */}
                  </Box>
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
};
