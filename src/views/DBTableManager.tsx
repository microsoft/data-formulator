// TableManager.tsx
import React, { useState, useEffect, useRef, FC } from "react";
import {
  Card,
  CardContent,
  Typography,
  Button,
  Grid,
  Box,
  IconButton,
  Paper,
  Tabs,
  Tab,
  TextField,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  SxProps,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  ButtonGroup,
  Tooltip,
  MenuItem,
  Chip,
  Collapse,
  styled,
  ToggleButtonGroup,
  ToggleButton,
  useTheme,
  Link,
  Autocomplete,
} from "@mui/material";

import DeleteIcon from "@mui/icons-material/Delete";
import CloseIcon from "@mui/icons-material/Close";
import AnalyticsIcon from "@mui/icons-material/Analytics";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import TableRowsIcon from "@mui/icons-material/TableRows";
import RefreshIcon from "@mui/icons-material/Refresh";
import CleaningServicesIcon from "@mui/icons-material/CleaningServices";
import SearchIcon from "@mui/icons-material/Search";
import DownloadIcon from "@mui/icons-material/Download";

import { getUrls } from "../app/utils";
import { CustomReactTable } from "./ReactTable";
import { DictTable } from "../components/ComponentType";
import { Type } from "../data/types";
import { useDispatch, useSelector } from "react-redux";
import { dfActions, dfSelectors, getSessionId } from "../app/dfSlice";
import { alpha } from "@mui/material";
import { DataFormulatorState } from "../app/dfSlice";
import { fetchFieldSemanticType } from "../app/dfSlice";
import { AppDispatch } from "../app/store";
import Editor from "react-simple-code-editor";
import Markdown from "markdown-to-jsx";

import Prism from "prismjs";
import "prismjs/components/prism-javascript"; // Language
import "prismjs/themes/prism.css"; //Example style, you can use another
import PrecisionManufacturingIcon from "@mui/icons-material/PrecisionManufacturing";
import CheckIcon from "@mui/icons-material/Check";
import MuiMarkdown from "mui-markdown";

// Type definition for Autocomplete options
interface ParamOption {
  value: string;
  text: string;
}

// Load options from API endpoints
let paramOptions: ParamOption[] = [];
let facodeOptions: ParamOption[] = [];
let itemGroupOptions: ParamOption[] = [];
let itemOptions: ParamOption[] = [];
let operationOptions: ParamOption[] = [];

// Load param options from JSON (keep as-is for now)
fetch("/std_param_options.json")
  .then((res) => res.json())
  .then((data) => {
    paramOptions = data;
  })
  .catch((err) => console.error("Failed to load param options:", err));

// Load facode options from API with JWT (via session cookies)
(async () => {
  try {
    const res = await fetch("/api/production/facode-options", {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

    const data = await res.json();
    if (data.status === "success" && Array.isArray(data.data)) {
      facodeOptions.length = 0;
      facodeOptions.push(...data.data);
    } else {
      console.error("Failed to load facode options from API:", data.message);
      // Fallback to JSON
      throw new Error("API returned error");
    }
  } catch (err) {
    console.error(
      "Failed to load facode options from API, attempting fallback to JSON:",
      err,
    );
  }
})();

// Load item group options from API with JWT (via session cookies)
(async () => {
  try {
    const res = await fetch("/api/production/item-group-options", {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

    const data = await res.json();
    if (data.status === "success" && Array.isArray(data.data)) {
      itemGroupOptions.length = 0;
      itemGroupOptions.push(...data.data);
    } else {
      console.error(
        "Failed to load item group options from API:",
        data.message,
      );
      // Fallback to JSON
      throw new Error("API returned error");
    }
  } catch (err) {
    console.error(
      "Failed to load item group options from API, attempting fallback to JSON:",
      err,
    );
    // Fallback to JSON file
    try {
      const res = await fetch("/item_group_name.json");
      const data = await res.json();
      itemGroupOptions.length = 0;
      itemGroupOptions.push(...data);
    } catch (fallbackErr) {
      console.error(
        "Failed to load item group options from JSON fallback:",
        fallbackErr,
      );
    }
  }
})();

// Function to load item options based on group_item_id
export const loadItemOptions = async (groupItemId: string) => {
  try {
    const res = await fetch(`/api/production/item-options/${groupItemId}`, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

    const data = await res.json();
    if (data.status === "success" && Array.isArray(data.data)) {
      itemOptions.length = 0;
      itemOptions.push(...data.data);
      console.log(
        `Loaded ${itemOptions.length} items for group ${groupItemId}`,
      );
      return itemOptions;
    } else {
      console.error("Failed to load item options from API:", data.message);
      itemOptions.length = 0;
      return [];
    }
  } catch (err) {
    console.error("Failed to load item options from API:", err);
    itemOptions.length = 0;
    return [];
  }
};

// Load operation options from API on startup
(async () => {
  try {
    const res = await fetch("/api/production/operation-options", {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

    const data = await res.json();
    if (data.status === "success" && Array.isArray(data.data)) {
      operationOptions.length = 0;
      operationOptions.push(...data.data);
      console.log(`Loaded ${operationOptions.length} operations`);
    } else {
      console.error("Failed to load operation options from API:", data.message);
    }
  } catch (err) {
    console.error("Failed to load operation options from API:", err);
  }
})();

/**
 * Build the QC_Data SQL query from connection params, optionally overriding date range.
 * Returns { query, name_as } or null if required params are missing.
 */
export const buildQcDataQuery = (
  params: Record<string, string>,
  overrides?: { from_date?: string; to_date?: string; is_live?: boolean },
): { query: string; name_as: string } | null => {
  const merged = { ...params, ...overrides };
  const from = (merged["from_date"] ?? "").toString().replace(/-/g, "");
  const to = (merged["to_date"] ?? "").toString().replace(/-/g, "");
  const stdParam = (params["std_param_name"] ?? "").toString().trim();
  if (!from || !to || !stdParam) return null;

  const facode = (params["facode_name"] ?? "").toString();
  const itemGroup = (params["group_item_name"] ?? "").toString().trim();
  const item = (params["item_name"] ?? "").toString().trim();
  const operation = (params["operation_name"] ?? "").toString().trim();

  const safeParam = stdParam.replace(/'/g, "''");
  const safeFacode = facode.replace(/'/g, "''");
  const safeItemGroup = itemGroup.replace(/'/g, "''");
  const safeItem = item.replace(/'/g, "''");
  const safeOperation = operation.replace(/'/g, "''");
  // PARAMVALUE,
  let query = `SELECT
                    ROW_NUMBER() OVER (ORDER BY LASTUPDATE) AS INDEX,
                    VALUEVIEW AS VALUE,
                    QCSTDPARAMNAME,
                    STDPARAMNICKNAME AS PARAMNICKNAME,
                    SLIPNO,
                    LL,ARLL,TARGET,ARUL,UL,
                    QCDATE,
                    QCSHIFT,
                    DISKNO,
                    LASTUPDATE,
                    SPITEMNAME as ITEMNAME,
                    OPERATIONNAME as OPERATION,
                    FACODE
                    FROM gcdb.DPD_QC_INFO
                    WHERE QCDATE >= '${from}' AND QCDATE <= '${to}'
                    AND ISMAXQCROUND = '1'
                    AND IS_DELETED <> '1'
                    AND (MAINSLIPNO = '1' OR MAINSLIPNO is null)`;

  if (safeParam) query += ` AND STDPARAMREPORTNAME ='${safeParam}'`;
  if (safeFacode) query += ` AND FACODE ='${safeFacode}'`;
  if (safeItemGroup) query += ` AND GROUPITEMOID ='${safeItemGroup}'`;
  if (safeItem) query += ` AND SPITEMOID ='${safeItem}'`;
  if (safeOperation) query += ` AND OPERATIONOID ='${safeOperation}'`;
  query += " ORDER BY LASTUPDATE";

  // Use _live suffix when in Data Live mode, otherwise use base parameter name
  // Allows storing live data separately from original data without conflicts
  const paramName = safeParam.replace(" ", "-");
  const name_as = overrides?.is_live ? `${paramName}_live` : paramName;

  return { query, name_as };
};

export const handleDBDownload = async (sessionId: string) => {
  const response = await fetch(getUrls().DOWNLOAD_DB_FILE, {
    method: "GET",
  });

  // Check if the response is ok
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to download database file");
  }

  // Get the blob directly from response
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  // Create a temporary link element
  const link = document.createElement("a");
  link.href = url;
  link.download = `df_${sessionId?.slice(0, 4)}.db`;
  document.body.appendChild(link);

  // Trigger download
  link.click();

  // Clean up
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

interface DBTable {
  name: string;
  columns: {
    name: string;
    type: string;
  }[];
  row_count: number;
  sample_rows: any[];
  view_source: string | null;
}

interface ColumnStatistics {
  column: string;
  type: string;
  statistics: {
    count: number;
    unique_count: number;
    null_count: number;
    min?: number;
    max?: number;
    avg?: number;
  };
}

interface TableStatisticsViewProps {
  tableName: string;
  columnStats: ColumnStatistics[];
}

export class TableStatisticsView extends React.Component<TableStatisticsViewProps> {
  render() {
    const { tableName, columnStats } = this.props;

    // Common styles for header cells
    const headerCellStyle = {
      backgroundColor: "#fff",
      fontSize: 10,
      color: "#333",
      borderBottomColor: (theme: any) => theme.palette.primary.main,
      borderBottomWidth: "1px",
      borderBottomStyle: "solid",
      padding: "6px",
    };

    // Common styles for body cells
    const bodyCellStyle = {
      fontSize: 10,
      padding: "6px",
    };

    return (
      <Box
        sx={{
          height: "310px", // Match the table container height from CustomReactTable
          display: "flex",
          flexDirection: "column",
        }}
      >
        <TableContainer
          sx={{
            flex: 1,
            maxHeight: "310px", // Adjust to account for the header
            overflow: "auto",
          }}
        >
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell
                  sx={{
                    ...headerCellStyle,
                    backgroundColor: "#f7f7f7",
                    fontWeight: "bold",
                  }}
                >
                  Column
                </TableCell>
                <TableCell sx={headerCellStyle}>Type</TableCell>
                <TableCell align="right" sx={headerCellStyle}>
                  Count
                </TableCell>
                <TableCell align="right" sx={headerCellStyle}>
                  Unique
                </TableCell>
                <TableCell align="right" sx={headerCellStyle}>
                  Null
                </TableCell>
                <TableCell align="right" sx={headerCellStyle}>
                  Min
                </TableCell>
                <TableCell align="right" sx={headerCellStyle}>
                  Max
                </TableCell>
                <TableCell align="right" sx={headerCellStyle}>
                  Avg
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {columnStats.map((stat, idx) => (
                <TableRow key={stat.column} hover sx={{}}>
                  <TableCell
                    component="th"
                    scope="row"
                    sx={{
                      ...bodyCellStyle,
                      fontWeight: "bold",
                      backgroundColor: "#f7f7f7",
                    }}
                  >
                    {stat.column}
                  </TableCell>
                  <TableCell sx={bodyCellStyle}>{stat.type}</TableCell>
                  <TableCell align="right" sx={bodyCellStyle}>
                    {stat.statistics.count}
                  </TableCell>
                  <TableCell align="right" sx={bodyCellStyle}>
                    {stat.statistics.unique_count}
                  </TableCell>
                  <TableCell align="right" sx={bodyCellStyle}>
                    {stat.statistics.null_count}
                  </TableCell>
                  <TableCell align="right" sx={bodyCellStyle}>
                    {stat.statistics.min !== undefined
                      ? stat.statistics.min
                      : "-"}
                  </TableCell>
                  <TableCell align="right" sx={bodyCellStyle}>
                    {stat.statistics.max !== undefined
                      ? stat.statistics.max
                      : "-"}
                  </TableCell>
                  <TableCell align="right" sx={bodyCellStyle}>
                    {stat.statistics.avg !== undefined
                      ? Number(stat.statistics.avg).toFixed(2)
                      : "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    );
  }
}

export const DBTableSelectionDialog: React.FC<{
  buttonElement: any;
  sx?: SxProps;
}> = function DBTableSelectionDialog({ buttonElement, sx }) {
  const theme = useTheme();

  const dispatch = useDispatch<AppDispatch>();
  const sessionId = useSelector(
    (state: DataFormulatorState) => state.sessionId,
  );
  const tables = useSelector((state: DataFormulatorState) => state.tables);
  const serverConfig = useSelector(
    (state: DataFormulatorState) => state.serverConfig,
  );

  const [tableDialogOpen, setTableDialogOpen] = useState<boolean>(false);
  const [tableAnalysisMap, setTableAnalysisMap] = useState<
    Record<string, ColumnStatistics[] | null>
  >({});

  // maps data loader type to list of param defs
  const [dataLoaderMetadata, setDataLoaderMetadata] = useState<
    Record<
      string,
      {
        params: {
          name: string;
          default: string;
          type: string;
          required: boolean;
          description: string;
        }[];
        auth_instructions: string;
      }
    >
  >({});

  const [dbTables, setDbTables] = useState<DBTable[]>([]);
  const [selectedTabKey, setSelectedTabKey] = useState("");

  const [isUploading, setIsUploading] = useState<boolean>(false);

  // Maps table name → QC loader params used when that table was ingested.
  // Used so each virtual table remembers its own query params independently.
  const pendingLoaderParamsRef = useRef<Record<string, Record<string, string>>>(
    {},
  );

  let setSystemMessage = (
    content: string,
    severity: "error" | "warning" | "info" | "success",
  ) => {
    dispatch(
      dfActions.addMessages({
        timestamp: Date.now(),
        component: "DB manager",
        type: severity,
        value: content,
      }),
    );
  };

  useEffect(() => {
    fetchDataLoaders();
  }, []);

  useEffect(() => {
    if (!selectedTabKey.startsWith("dataLoader:") && dbTables.length == 0) {
      setSelectedTabKey("");
    } else if (
      !selectedTabKey.startsWith("dataLoader:") &&
      dbTables.find((t) => t.name === selectedTabKey) == undefined
    ) {
      setSelectedTabKey(dbTables[0].name);
    }
  }, [dbTables]);

  // Fetch list of tables
  const fetchTables = async () => {
    if (serverConfig.DISABLE_DATABASE) return;
    try {
      const response = await fetch(getUrls().LIST_TABLES);
      const data = await response.json();
      if (data.status === "success") {
        setDbTables(data.tables);
      }
    } catch (error) {
      setSystemMessage(
        "Failed to fetch tables, please check if the server is running",
        "error",
      );
    }
  };

  const fetchDataLoaders = async () => {
    fetch(getUrls().DATA_LOADER_LIST_DATA_LOADERS, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.status === "success") {
          setDataLoaderMetadata(data.data_loaders);
        } else {
          console.error("Failed to fetch data loader params:", data.error);
        }
      })
      .catch((error) => {
        console.error("Failed to fetch data loader params:", error);
      });
  };

  const handleDBUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("table_name", file.name.split(".")[0]);

    try {
      setIsUploading(true);
      const response = await fetch(getUrls().UPLOAD_DB_FILE, {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (data.status === "success") {
        fetchTables(); // Refresh table list
      } else {
        // Handle error from server
        setSystemMessage(data.error || "Failed to upload table", "error");
      }
    } catch (error) {
      setSystemMessage(
        "Failed to upload table, please check if the server is running",
        "error",
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleDBFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("table_name", file.name.split(".")[0]);

    try {
      setIsUploading(true);
      const response = await fetch(getUrls().CREATE_TABLE, {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (data.status === "success") {
        if (data.is_renamed) {
          setSystemMessage(
            `Table ${data.original_name} already exists. Renamed to ${data.table_name}`,
            "warning",
          );
        }
        fetchTables(); // Refresh table list
      } else {
        setSystemMessage(data.error || "Failed to upload table", "error");
      }
    } catch (error) {
      setSystemMessage(
        "Failed to upload table, please check if the server is running",
        "error",
      );
    } finally {
      setIsUploading(false);
      // Clear the file input value to allow uploading the same file again
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const handleDBReset = async () => {
    try {
      const response = await fetch(getUrls().RESET_DB_FILE, {
        method: "POST",
      });
      const data = await response.json();
      if (data.status === "success") {
        fetchTables();
      } else {
        setSystemMessage(data.error || "Failed to reset database", "error");
      }
    } catch (error) {
      setSystemMessage("Failed to reset database", "error");
    }
  };

  const handleCleanDerivedViews = async () => {
    let unreferencedViews = dbTables.filter(
      (t) =>
        t.view_source !== null &&
        t.view_source !== undefined &&
        !tables.some((t2) => t2.id === t.name),
    );

    if (unreferencedViews.length > 0) {
      if (
        confirm(
          `Are you sure you want to delete the following unreferenced derived views? \n${unreferencedViews
            .map((v) => `- ${v.name}`)
            .join("\n")}`,
        )
      ) {
        let deletedViews = [];
        for (let view of unreferencedViews) {
          try {
            const response = await fetch(getUrls().DELETE_TABLE, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ table_name: view.name }),
            });
            const data = await response.json();
            if (data.status === "success") {
              deletedViews.push(view.name);
            } else {
              setSystemMessage(data.error || "Failed to delete table", "error");
            }
          } catch (error) {
            setSystemMessage(
              "Failed to delete table, please check if the server is running",
              "error",
            );
          }
        }
        if (deletedViews.length > 0) {
          setSystemMessage(
            `Deleted ${
              deletedViews.length
            } unreferenced derived views: ${deletedViews.join(", ")}`,
            "success",
          );
        }
        fetchTables();
        setSelectedTabKey(dbTables.length > 0 ? dbTables[0].name : "");
      }
    }
  };

  // Delete table
  const handleDropTable = async (tableName: string) => {
    if (tables.some((t) => t.id === tableName)) {
      if (
        !confirm(
          `Are you sure you want to delete ${tableName}? \n ${tableName} is currently loaded into the GDIS AI Agent and will be removed from the database.`,
        )
      )
        return;
    }

    try {
      const response = await fetch(getUrls().DELETE_TABLE, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ table_name: tableName }),
      });
      const data = await response.json();
      if (data.status === "success") {
        // Remove from UI state immediately
        setDbTables((prevTables) =>
          prevTables.filter((t) => t.name !== tableName),
        );

        // Clean up analysis cache for this table
        setTableAnalysisMap((prevMap) => {
          const newMap = { ...prevMap };
          delete newMap[tableName];
          return newMap;
        });

        // Reset selected tab if we deleted the currently selected table
        setSelectedTabKey((prevKey) => {
          if (prevKey === tableName) {
            return "";
          }
          return prevKey;
        });

        setSystemMessage(`Table ${tableName} deleted successfully`, "success");
      } else {
        setSystemMessage(data.error || "Failed to delete table", "error");
      }
    } catch (error) {
      setSystemMessage(
        "Failed to delete table, please check if the server is running",
        "error",
      );
    }
  };

  // Handle data analysis
  const handleAnalyzeData = async (tableName: string) => {
    if (!tableName) return;
    if (tableAnalysisMap[tableName]) return;

    console.log("Analyzing table:", tableName);

    try {
      const response = await fetch(getUrls().GET_COLUMN_STATS, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ table_name: tableName }),
      });
      const data = await response.json();
      if (data.status === "success") {
        console.log("Analysis results:", data);
        // Update the analysis map with the new results
        setTableAnalysisMap((prevMap) => ({
          ...prevMap,
          [tableName]: data.statistics,
        }));
      }
    } catch (error) {
      console.error("Failed to analyze table data:", error);
      setSystemMessage(
        "Failed to analyze table data, please check if the server is running",
        "error",
      );
    }
  };

  // Toggle analysis view
  const toggleAnalysisView = (tableName: string) => {
    if (tableAnalysisMap[tableName]) {
      // If we already have analysis, remove it to show table data again
      setTableAnalysisMap((prevMap) => {
        const newMap = { ...prevMap };
        delete newMap[tableName];
        return newMap;
      });
    } else {
      // If no analysis yet, fetch it
      handleAnalyzeData(tableName);
    }
  };

  // Clear all tables
  const handleClearAllTables = async () => {
    if (dbTables.length === 0) return;

    if (
      !confirm(
        `Are you sure you want to delete all ${dbTables.length} tables? This action cannot be undone.`,
      )
    ) {
      return;
    }

    const tablesToDelete = [...dbTables];
    let deletedCount = 0;

    for (let table of tablesToDelete) {
      try {
        const response = await fetch(getUrls().DELETE_TABLE, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ table_name: table.name }),
        });
        const data = await response.json();
        if (data.status === "success") {
          deletedCount++;
        }
      } catch (error) {
        console.error(`Failed to delete table ${table.name}:`, error);
      }
    }

    setDbTables([]);
    setTableAnalysisMap({});
    setSelectedTabKey("");

    if (deletedCount > 0) {
      setSystemMessage(
        `Successfully deleted ${deletedCount} table(s)`,
        "success",
      );
    }
  };

  const handleAddTableToDF = (dbTable: DBTable) => {
    const convertSqlTypeToAppType = (sqlType: string): Type => {
      // Convert SQL types to application types
      sqlType = sqlType.toUpperCase();
      if (
        sqlType.includes("INT") ||
        sqlType === "BIGINT" ||
        sqlType === "SMALLINT" ||
        sqlType === "TINYINT"
      ) {
        return Type.Integer;
      } else if (
        sqlType.includes("FLOAT") ||
        sqlType.includes("DOUBLE") ||
        sqlType.includes("DECIMAL") ||
        sqlType.includes("NUMERIC") ||
        sqlType.includes("REAL")
      ) {
        return Type.Number;
      } else if (sqlType.includes("BOOL")) {
        return Type.Boolean;
      } else if (
        sqlType.includes("DATE") ||
        sqlType.includes("TIME") ||
        sqlType.includes("TIMESTAMP")
      ) {
        return Type.Date;
      } else {
        return Type.String;
      }
    };

    // Sanitize rows & columns: try to convert VALUE to number, fallback to string
    const sanitizedRows = dbTable.sample_rows.map((row: any) => {
      const r = { ...row };
      // Try to convert VALUE to number if possible
      if (r.VALUE !== undefined && r.VALUE !== null) {
        const numValue = Number(r.VALUE);
        // If conversion succeeds and results in a valid number, use it
        r.VALUE = isNaN(numValue) ? r.VALUE : numValue;
      }
      return r;
    });

    const sanitizedColumns = dbTable.columns.filter(
      (c: any) => c.name !== "VALUE_NUM" && c.name !== "VALUE_IS_NUM",
    );

    let table: DictTable = {
      id: dbTable.name,
      displayId: dbTable.name,
      names: sanitizedColumns.map((col: any) => col.name),
      metadata: sanitizedColumns.reduce(
        (
          acc: Record<
            string,
            { type: Type; semanticType: string; levels: any[] }
          >,
          col: any,
        ) => ({
          ...acc,
          [col.name]: {
            type: convertSqlTypeToAppType(col.type),
            semanticType: "",
            levels: [],
          },
        }),
        {},
      ),
      rows: sanitizedRows,
      virtual: {
        tableId: dbTable.name,
        rowCount: dbTable.row_count,
        loaderParams: pendingLoaderParamsRef.current[dbTable.name],
      },
      anchored: true, // by default, db tables are anchored
      createdBy: "user",
      attachedMetadata: "",
    };
    // Use replaceTable so that if a table with the same ID already exists it is
    // updated in-place (rows, rowCount, columns) rather than duplicated.
    dispatch(dfActions.replaceTable(table));
    dispatch(fetchFieldSemanticType(table));
    setTableDialogOpen(false);
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: string) => {
    setSelectedTabKey(newValue);
  };

  useEffect(() => {
    if (tableDialogOpen) {
      fetchTables();
    }
  }, [tableDialogOpen]);

  let importButton = (buttonElement: React.ReactNode) => {
    return (
      <Tooltip title="import a duckdb .db file to the local database">
        <Button
          variant="text"
          sx={{ fontSize: "inherit", minWidth: "auto" }}
          component="label"
          disabled={isUploading}
        >
          {buttonElement}
          <input
            type="file"
            hidden
            onChange={handleDBUpload}
            accept=".db"
            disabled={isUploading}
          />
        </Button>
      </Tooltip>
    );
  };

  let exportButton = (
    <Tooltip title="save the local database to a duckdb .db file">
      <Button
        variant="text"
        size="small"
        onClick={() => {
          handleDBDownload(sessionId ?? "").catch((error) => {
            console.error("Failed to download database:", error);
            setSystemMessage("Failed to download database file", "error");
          });
        }}
        disabled={isUploading || dbTables.length === 0}
      >
        export
      </Button>
    </Tooltip>
  );

  function uploadFileButton(element: React.ReactNode, buttonSx?: SxProps) {
    return (
      <Tooltip title="upload a csv/tsv file to the local database">
        <Button
          variant="text"
          component="label"
          sx={{ fontSize: "inherit", ...buttonSx }}
          disabled={isUploading}
        >
          {element}
          <input
            type="file"
            hidden
            onChange={handleDBFileUpload}
            accept=".csv,.xlsx,.json"
            disabled={isUploading}
          />
        </Button>
      </Tooltip>
    );
  }

  let hasDerivedViews =
    dbTables.filter((t) => t.view_source !== null).length > 0;

  let dataLoaderPanel = (
    <Box
      sx={{
        p: 1,
        display: "flex",
        flexDirection: "column",
        backgroundColor: alpha(theme.palette.secondary.main, 0.02),
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", px: 1, mb: 1 }}>
        <Typography
          variant="caption"
          sx={{
            color: "text.disabled",
            fontWeight: "500",
            flexGrow: 1,
            fontSize: "0.75rem",
          }}
        >
          Data Connectors
        </Typography>
      </Box>

      {[
        "file upload",
        ...Object.keys(dataLoaderMetadata ?? {}).filter(
          (type) => type !== "s3" && type !== "kusto",
        ),
      ].map((dataLoaderType, i) => (
        <Button
          key={`dataLoader:${dataLoaderType}`}
          variant="text"
          size="small"
          onClick={() => {
            setSelectedTabKey("dataLoader:" + dataLoaderType);
          }}
          color="secondary"
          sx={{
            textTransform: "none",
            width: 120,
            justifyContent: "flex-start",
            textAlign: "left",
            borderRadius: 0,
            py: 0.5,
            px: 2,
            color:
              selectedTabKey === "dataLoader:" + dataLoaderType
                ? "secondary.main"
                : "text.secondary",
            borderRight:
              selectedTabKey === "dataLoader:" + dataLoaderType ? 2 : 0,
            borderColor: "secondary.main",
          }}
        >
          <Typography
            fontSize="inherit"
            sx={{
              textTransform: "none",
              width: "calc(100% - 4px)",
              textAlign: "left",
              textOverflow: "ellipsis",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            {dataLoaderType}
          </Typography>
        </Button>
      ))}
    </Box>
  );

  let tableSelectionPanel = (
    <Box
      sx={{
        px: 0.5,
        pt: 1,
        display: "flex",
        flexDirection: "column",
        backgroundColor: alpha(theme.palette.primary.main, 0.02),
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", px: 1, mb: 1 }}>
        <Typography
          variant="caption"
          sx={{
            color: "text.disabled",
            fontWeight: "500",
            flexGrow: 1,
            fontSize: "0.75rem",
          }}
        >
          Data Tables
        </Typography>
        <Tooltip title="refresh the table list">
          <IconButton
            size="small"
            color="primary"
            sx={{
              "&:hover": {
                transform: "rotate(180deg)",
              },
              transition: "transform 0.3s ease-in-out",
            }}
            onClick={() => {
              fetchTables();
            }}
          >
            <RefreshIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="clear all tables">
          <IconButton
            size="small"
            color="primary"
            sx={{
              "&:hover": {
                transform: "rotate(180deg)",
              },
              transition: "transform 0.3s ease-in-out",
            }}
            onClick={() => {
              handleClearAllTables();
            }}
            disabled={dbTables.length === 0}
          >
            <DeleteIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {dbTables.length == 0 && (
        <Typography
          variant="caption"
          sx={{ color: "lightgray", px: 2, py: 0.5, fontStyle: "italic" }}
        >
          no tables available
        </Typography>
      )}

      {/* Regular Tables */}
      {dbTables
        .filter((t) => t.view_source === null)
        .map((t, i) => (
          <Button
            key={t.name}
            variant="text"
            size="small"
            color="primary"
            onClick={() => {
              setSelectedTabKey(t.name);
            }}
            sx={{
              textTransform: "none",
              width: 160,
              justifyContent: "flex-start",
              textAlign: "left",
              borderRadius: 0,
              py: 0.5,
              px: 2,
              color:
                selectedTabKey === t.name ? "primary.main" : "text.secondary",
              borderRight: selectedTabKey === t.name ? 2 : 0,
            }}
          >
            <Typography
              fontSize="inherit"
              sx={{
                width: "calc(100% - 4px)",
                textAlign: "left",
                textOverflow: "ellipsis",
                overflow: "hidden",
                whiteSpace: "nowrap",
              }}
            >
              {t.name}
            </Typography>
          </Button>
        ))}

      {/* Derived Views Section */}
      {hasDerivedViews && (
        <Box sx={{ mt: 2, display: "flex", flexDirection: "column" }}>
          <Box sx={{ display: "flex", alignItems: "center", px: 1, mb: 1 }}>
            <Typography
              variant="caption"
              sx={{
                color: "text.disabled",
                fontWeight: "500",
                flexGrow: 1,
                fontSize: "0.75rem",
              }}
            >
              Derived Views
            </Typography>
            <Tooltip title="clean up unreferenced derived views">
              <IconButton
                size="small"
                color="primary"
                sx={{
                  "&:hover": {
                    transform: "rotate(180deg)",
                  },
                  transition: "transform 0.3s ease-in-out",
                }}
                disabled={
                  dbTables.filter((t) => t.view_source !== null).length === 0
                }
                onClick={() => {
                  handleCleanDerivedViews();
                }}
              >
                <CleaningServicesIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </Box>

          {dbTables
            .filter((t) => t.view_source !== null)
            .map((t, i) => (
              <Button
                key={t.name}
                variant="text"
                size="small"
                onClick={() => {
                  setSelectedTabKey(t.name);
                }}
                sx={{
                  textTransform: "none",
                  width: 160,
                  justifyContent: "flex-start",
                  textAlign: "left",
                  borderRadius: 0,
                  py: 0.5,
                  px: 2,
                  color:
                    selectedTabKey === t.name
                      ? "primary.main"
                      : "text.secondary",
                  backgroundColor: "transparent",
                  borderRight: selectedTabKey === t.name ? 2 : 0,
                  borderColor: "primary.main",
                  "&:hover": {
                    backgroundColor:
                      selectedTabKey === t.name ? "primary.100" : "primary.50",
                  },
                }}
              >
                <Typography
                  fontSize="inherit"
                  sx={{
                    width: "calc(100% - 4px)",
                    textAlign: "left",
                    textOverflow: "ellipsis",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.name}
                </Typography>
              </Button>
            ))}
        </Box>
      )}
    </Box>
  );

  let tableView = (
    <Box sx={{ flex: 1, width: 880, overflow: "auto", p: 2 }}>
      {/* Empty state */}
      {selectedTabKey === "" && (
        <Typography variant="caption" sx={{ color: "text.secondary", px: 1 }}>
          The database is empty, refresh the table list or import some data to
          get started.
        </Typography>
      )}

      {/* File upload */}
      {selectedTabKey === "dataLoader:file upload" && (
        <Box>
          {uploadFileButton(
            <Typography component="span" fontSize={18} textTransform="none">
              {isUploading
                ? "uploading..."
                : "upload a csv/tsv file to the local database"}
            </Typography>,
          )}
        </Box>
      )}

      {/* Data loader forms */}
      {dataLoaderMetadata &&
        Object.entries(dataLoaderMetadata)
          .filter(
            ([dataLoaderType]) =>
              dataLoaderType !== "s3" && dataLoaderType !== "kusto",
          )
          .map(
            ([dataLoaderType, metadata]) =>
              selectedTabKey === "dataLoader:" + dataLoaderType && (
                <Box
                  key={`dataLoader:${dataLoaderType}`}
                  sx={{ position: "relative", maxWidth: "100%" }}
                >
                  <DataLoaderForm
                    key={`data-loader-form-${dataLoaderType}`}
                    dataLoaderType={dataLoaderType}
                    paramDefs={metadata.params}
                    authInstructions={metadata.auth_instructions}
                    onImport={() => {
                      setIsUploading(true);
                    }}
                    onQcLoadSuccess={(tableName, loaderParams) => {
                      pendingLoaderParamsRef.current[tableName] = loaderParams;
                    }}
                    onFinish={(status, message) => {
                      setIsUploading(false);
                      fetchTables();
                      if (status === "error") {
                        setSystemMessage(message, "error");
                      }
                    }}
                  />
                </Box>
              ),
          )}

      {/* Table content */}
      {dbTables.map((t, i) => {
        if (selectedTabKey !== t.name) return null;

        const currentTable = t;
        const showingAnalysis =
          tableAnalysisMap[currentTable.name] !== undefined;
        return (
          <Box
            key={t.name}
            sx={{
              maxWidth: "100%",
              overflowX: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 1,
            }}
          >
            <Paper variant="outlined">
              <Box
                sx={{
                  px: 1,
                  display: "flex",
                  alignItems: "center",
                  borderBottom: "1px solid rgba(0,0,0,0.1)",
                }}
              >
                <Typography variant="caption" sx={{}}>
                  {showingAnalysis ? "column stats for " : "sample data from "}
                  <Typography
                    component="span"
                    sx={{ fontSize: 12, fontWeight: "bold" }}
                  >
                    {currentTable.name}
                  </Typography>
                  <Typography
                    component="span"
                    sx={{ ml: 1, fontSize: 10, color: "text.secondary" }}
                  >
                    ({currentTable.columns.length} columns ×{" "}
                    {currentTable.row_count} rows)
                  </Typography>
                </Typography>
                <Box sx={{ marginLeft: "auto", display: "flex", gap: 1 }}>
                  <Button
                    size="small"
                    color={showingAnalysis ? "secondary" : "primary"}
                    onClick={() => toggleAnalysisView(currentTable.name)}
                    startIcon={<AnalyticsIcon fontSize="small" />}
                    sx={{ textTransform: "none" }}
                  >
                    {showingAnalysis
                      ? "show data samples"
                      : "show column stats"}
                  </Button>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => handleDropTable(currentTable.name)}
                    title="Drop Table"
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Box>
              {showingAnalysis ? (
                <TableStatisticsView
                  tableName={currentTable.name}
                  columnStats={tableAnalysisMap[currentTable.name] ?? []}
                />
              ) : (
                <CustomReactTable
                  rows={currentTable.sample_rows
                    .map((row: any) => {
                      // Prefer numeric VALUE if available
                      const r = { ...row };
                      if (r.VALUE_NUM !== undefined && r.VALUE_NUM !== null) {
                        r.VALUE = r.VALUE_NUM;
                      }
                      // Remove helper columns from display
                      delete r.VALUE_NUM;
                      delete r.VALUE_IS_NUM;

                      return Object.fromEntries(
                        Object.entries(r).map(([key, value]: [string, any]) => {
                          return [key, String(value)];
                        }),
                      );
                    })
                    .slice(0, 9)}
                  columnDefs={currentTable.columns
                    .filter(
                      (col) =>
                        col.name !== "VALUE_NUM" && col.name !== "VALUE_IS_NUM",
                    )
                    .map((col) => ({
                      id: col.name,
                      label: col.name,
                      minWidth: 60,
                    }))}
                  rowsPerPageNum={-1}
                  compact={false}
                  isIncompleteTable={currentTable.row_count > 10}
                />
              )}
            </Paper>
            <Box sx={{ display: "flex", gap: 1, ml: "auto" }}>
              <Button
                variant="outlined"
                size="small"
                disabled={
                  isUploading ||
                  dbTables.length === 0 ||
                  dbTables.find((t) => t.name === selectedTabKey) === undefined
                }
                onClick={async () => {
                  const tableName = selectedTabKey;
                  if (!tableName) return;

                  try {
                    // Tìm thông tin bảng hiện tại
                    const table = dbTables.find((t) => t.name === tableName);
                    if (!table) throw new Error("Table not found");

                    // Gọi API lấy toàn bộ dữ liệu bảng
                    const response = await fetch(getUrls().SAMPLE_TABLE, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        table: tableName,
                        size: table.row_count,
                        method: "head",
                        range_start: 0,
                        range_size: table.row_count,
                      }),
                    });
                    const result = await response.json();
                    if (
                      result.status !== "success" ||
                      !result.rows ||
                      result.rows.length === 0
                    ) {
                      throw new Error("No data available for this table");
                    }
                    const rows = result.rows;
                    if (
                      !Array.isArray(rows) ||
                      rows.length === 0 ||
                      typeof rows[0] !== "object"
                    ) {
                      throw new Error("No valid data to export");
                    }

                    // Convert to CSV
                    const headers = Object.keys(rows[0]);
                    const csvContent = [
                      headers.join(","),
                      ...rows.map((row) =>
                        headers
                          .map((h) => {
                            const value = row[h];
                            if (
                              typeof value === "string" &&
                              (value.includes(",") || value.includes('"'))
                            ) {
                              return `"${value.replace(/"/g, '""')}"`;
                            }
                            return value;
                          })
                          .join(","),
                      ),
                    ].join("\n");

                    // Download
                    const blob = new Blob([csvContent], {
                      type: "text/csv;charset=utf-8;",
                    });
                    const link = document.createElement("a");
                    const url = URL.createObjectURL(blob);
                    link.href = url;
                    link.download = `${tableName}.csv`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);

                    setSystemMessage(
                      `Table ${tableName} downloaded successfully (${rows.length} rows)`,
                      "success",
                    );
                  } catch (error) {
                    console.error("Failed to download table:", error);
                    setSystemMessage("Failed to download table data", "error");
                  }
                }}
                startIcon={<DownloadIcon />}
              >
                Download
              </Button>
              <Button
                variant="contained"
                size="small"
                disabled={
                  isUploading ||
                  dbTables.length === 0 ||
                  dbTables.find((t) => t.name === selectedTabKey) === undefined
                }
                onClick={() => {
                  let t = dbTables.find((t) => t.name === selectedTabKey);
                  if (t) {
                    handleAddTableToDF(t);
                    setTableDialogOpen(false);
                  }
                }}
              >
                Load Table
              </Button>
            </Box>
          </Box>
        );
      })}
    </Box>
  );

  let mainContent = (
    <Box
      sx={{
        display: "flex",
        flexDirection: "row",
        minHeight: 400,
        borderRadius: 2,
        width: "fit-content",
        bgcolor: "white",
      }}
    >
      {/* Button navigation - similar to TableSelectionView */}
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          px: 1,
          borderRight: 1,
          borderColor: "divider",
        }}
      >
        <Box
          sx={{
            minWidth: 180,
            display: "flex",
            flexDirection: "row",
            flexWrap: "nowrap",
            overflowY: "auto",
            flexGrow: 1,
          }}
        >
          {/* External Data Loaders Section */}
          {dataLoaderPanel}
          {/* Available Tables Section */}
          {tableSelectionPanel}
        </Box>
        <Typography
          variant="caption"
          sx={{
            mr: "auto",
            mt: "auto",
            mb: 1,
            textWrap: "wrap",
            "& .MuiButton-root": { minWidth: "auto", textTransform: "none" },
          }}
        >
          {importButton(
            <Typography component="span" fontSize="inherit">
              Import
            </Typography>,
          )}
          ,{exportButton}
          or
          <Button
            variant="text"
            size="small"
            color="warning"
            onClick={handleDBReset}
            disabled={isUploading}
            //endIcon={<RestartAltIcon />}
          >
            reset
          </Button>
          the backend database
        </Typography>
      </Box>
      {/* Content area - using conditional rendering instead of TabPanel */}
      {tableView}
    </Box>
  );

  return (
    <>
      <Tooltip
        title={
          serverConfig.DISABLE_DATABASE ? (
            <Typography sx={{ fontSize: "11px" }}>
              {/* Install GDIS AI Agent locally to use database. <br />
              Link:{" "}
              <Link
                href="https://github.com/xxx"
                target="_blank"
                rel="noopener noreferrer"
                sx={{ color: "inherit", textDecoration: "underline" }}
                onClick={(e) => e.stopPropagation()}
              >
                https://github.com/xxx
              </Link> */}
            </Typography>
          ) : (
            ""
          )
        }
        placement="top"
      >
        <Box
          onClick={() => setTableDialogOpen(true)}
          sx={{
            cursor: serverConfig.DISABLE_DATABASE ? "not-allowed" : "pointer",
            display: "inline-block",
            opacity: serverConfig.DISABLE_DATABASE ? 0.5 : 1,
            pointerEvents: serverConfig.DISABLE_DATABASE ? "none" : "auto",
            color: "primary.main",
            fontSize: "inherit",
            fontWeight: 500,
            textTransform: "none",
            padding: "6px 16px",
            borderRadius: "4px",
            transition: "background-color 0.2s",
            "&:hover": {
              backgroundColor: serverConfig.DISABLE_DATABASE
                ? "transparent"
                : "rgba(25, 118, 210, 0.04)",
            },
          }}
        >
          {buttonElement}
        </Box>
      </Tooltip>
      <Dialog
        key="db-table-selection-dialog"
        onClose={() => {
          setTableDialogOpen(false);
        }}
        open={tableDialogOpen}
        sx={{
          "& .MuiDialog-paper": {
            maxWidth: "100%",
            maxHeight: 800,
            minWidth: 800,
          },
        }}
      >
        <DialogTitle sx={{ display: "flex" }}>
          Database
          <IconButton
            sx={{ marginLeft: "auto" }}
            edge="start"
            size="small"
            color="inherit"
            aria-label="close"
            onClick={() => setTableDialogOpen(false)}
          >
            <CloseIcon fontSize="inherit" />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 1, position: "relative" }}>
          {mainContent}
          {isUploading && (
            <Box
              sx={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(255, 255, 255, 0.7)",
                zIndex: 1000,
              }}
            >
              <CircularProgress size={60} thickness={5} />
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export const DataLoaderForm: React.FC<{
  dataLoaderType: string;
  paramDefs: {
    name: string;
    default: string;
    type: string;
    required: boolean;
    description: string;
  }[];
  authInstructions: string;
  onImport: () => void;
  onFinish: (status: "success" | "error", message: string) => void;
  onQcLoadSuccess?: (tableName: string, params: Record<string, string>) => void;
}> = ({
  dataLoaderType,
  paramDefs,
  authInstructions,
  onImport,
  onFinish,
  onQcLoadSuccess,
}) => {
  const dispatch = useDispatch();
  const theme = useTheme();
  const params = useSelector(
    (state: DataFormulatorState) =>
      state.dataLoaderConnectParams[dataLoaderType] ?? {},
  );

  const [tableMetadata, setTableMetadata] = useState<Record<string, any>>({});
  let [displaySamples, setDisplaySamples] = useState<Record<string, boolean>>(
    {},
  );
  let [tableFilter, setTableFilter] = useState<string>("");

  const [displayAuthInstructions, setDisplayAuthInstructions] = useState(false);

  let [isConnecting, setIsConnecting] = useState(false);
  let [mode, setMode] = useState<"view tables" | "query">("view tables");
  let [itemsLoaded, setItemsLoaded] = useState<number>(0); // ✅ Trigger re-render when items loaded

  // ✅ Auto-load items when Group Item is selected or component mounts
  useEffect(() => {
    const groupItemId = params["group_item_name"];
    if (groupItemId && dataLoaderType === "QC_Data") {
      // Group item has value, load items
      loadItemOptions(groupItemId).then(() => {
        // ✅ Trigger re-render after items loaded
        setItemsLoaded((prev) => prev + 1);
      });
    } else if (!groupItemId) {
      // Group item is empty, clear items
      itemOptions.length = 0;
      setItemsLoaded((prev) => prev + 1);
    }
  }, [params["group_item_name"], dataLoaderType]);

  const toggleDisplaySamples = (tableName: string) => {
    setDisplaySamples({
      ...displaySamples,
      [tableName]: !displaySamples[tableName],
    });
  };

  const handleModeChange = (
    event: React.MouseEvent<HTMLElement>,
    newMode: "view tables" | "query",
  ) => {
    if (newMode != null) {
      setMode(newMode);
    }
  };

  let tableMetadataBox = [
    <Box key="mode-toggle" sx={{ my: 2 }}>
      <ToggleButtonGroup
        color="primary"
        value={mode}
        exclusive
        size="small"
        onChange={handleModeChange}
        aria-label="Platform"
        sx={{
          "& .MuiButtonBase-root": {
            lineHeight: 1,
            color: "text.primary",
            textTransform: "none",
            "&.Mui-selected": {
              fontWeight: "bold",
            },
          },
        }}
      >
        <ToggleButton value="view tables">View Tables</ToggleButton>
        <ToggleButton value="query">Query Data</ToggleButton>
      </ToggleButtonGroup>
      <Typography variant="body2" sx={{ mb: 1 }}></Typography>
    </Box>,
    mode === "view tables" && (
      <TableContainer
        key="table-view"
        component={Paper}
        sx={{ maxHeight: 360, overflowY: "auto" }}
      >
        <Table sx={{ minWidth: 650 }} size="small" aria-label="simple table">
          <TableBody>
            {Object.entries(tableMetadata).map(([tableName, metadata]) => {
              return [
                <TableRow
                  key={tableName}
                  sx={{
                    "&:last-child td, &:last-child th": { border: 0 },
                    "& .MuiTableCell-root": {
                      padding: 0.25,
                      wordWrap: "break-word",
                      whiteSpace: "normal",
                    },
                  }}
                >
                  <TableCell
                    sx={{
                      borderBottom: displaySamples[tableName]
                        ? "none"
                        : "1px solid rgba(0, 0, 0, 0.1)",
                    }}
                  >
                    <IconButton
                      size="small"
                      onClick={() => toggleDisplaySamples(tableName)}
                    >
                      {displaySamples[tableName] ? (
                        <ExpandLessIcon />
                      ) : (
                        <ExpandMoreIcon />
                      )}
                    </IconButton>
                  </TableCell>
                  <TableCell
                    sx={{
                      maxWidth: 240,
                      borderBottom: displaySamples[tableName]
                        ? "none"
                        : "1px solid rgba(0, 0, 0, 0.1)",
                    }}
                    component="th"
                    scope="row"
                  >
                    {tableName}{" "}
                    <Typography
                      variant="caption"
                      sx={{ color: "text.secondary" }}
                      fontSize={10}
                    >
                      (
                      {metadata.row_count > 0
                        ? `${metadata.row_count} rows × `
                        : ""}
                      {metadata.columns.length} cols)
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 500 }}>
                    {metadata.columns.map((column: any) => (
                      <Chip
                        key={column.name}
                        label={column.name}
                        sx={{ fontSize: 11, margin: 0.25, height: 20 }}
                        size="small"
                      />
                    ))}
                  </TableCell>
                  <TableCell sx={{ width: 60 }}>
                    <Button
                      size="small"
                      onClick={() => {
                        onImport();
                        fetch(getUrls().DATA_LOADER_INGEST_DATA, {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                          },
                          body: JSON.stringify({
                            data_loader_type: dataLoaderType,
                            data_loader_params: params,
                            table_name: tableName,
                          }),
                        })
                          .then((response) => response.json())
                          .then((data) => {
                            if (data.status === "success") {
                              onFinish("success", "Data ingested successfully");
                            } else {
                              onFinish("error", data.error);
                            }
                          })
                          .catch((error) => {
                            console.error("Failed to ingest data:", error);
                            onFinish(
                              "error",
                              `Failed to ingest data: ${error}`,
                            );
                          });
                      }}
                    >
                      Import
                    </Button>
                  </TableCell>
                </TableRow>,
                <TableRow key={`${tableName}-sample`}>
                  <TableCell
                    colSpan={4}
                    sx={{
                      paddingBottom: 0,
                      paddingTop: 0,
                      px: 0,
                      maxWidth: 800,
                      overflowX: "auto",
                      borderBottom: displaySamples[tableName]
                        ? "1px solid rgba(0, 0, 0, 0.1)"
                        : "none",
                    }}
                  >
                    <Collapse
                      in={displaySamples[tableName]}
                      timeout="auto"
                      unmountOnExit
                    >
                      <Box sx={{ px: 1, py: 0.5 }}>
                        <CustomReactTable
                          rows={metadata.sample_rows
                            .slice(0, 9)
                            .map((row: any) => {
                              return Object.fromEntries(
                                Object.entries(row).map(
                                  ([key, value]: [string, any]) => {
                                    return [key, String(value)];
                                  },
                                ),
                              );
                            })}
                          columnDefs={metadata.columns.map((column: any) => ({
                            id: column.name,
                            label: column.name,
                          }))}
                          rowsPerPageNum={-1}
                          compact={false}
                          isIncompleteTable={metadata.row_count > 10}
                        />
                      </Box>
                    </Collapse>
                  </TableCell>
                </TableRow>,
              ];
            })}
          </TableBody>
        </Table>
      </TableContainer>
    ),
    mode === "query" && (
      <DataQueryForm
        dataLoaderType={dataLoaderType}
        paramDefs={paramDefs}
        availableTables={Object.keys(tableMetadata).map((t) => ({
          name: t,
          fields: tableMetadata[t].columns.map((c: any) => c.name),
        }))}
        dataLoaderParams={params}
        onImport={onImport}
        onFinish={onFinish}
      />
    ),
  ];

  return (
    <Box sx={{ p: 0 }}>
      {isConnecting && (
        <Box
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            backgroundColor: "rgba(255, 255, 255, 0.7)",
          }}
        >
          <CircularProgress size={20} />
        </Box>
      )}
      <Typography variant="body2" sx={{}}>
        Data Connector (
        <Typography
          component="span"
          sx={{ color: "secondary.main", fontWeight: "bold" }}
        >
          {dataLoaderType}
        </Typography>
        )
      </Typography>
      <Box
        sx={{
          display: "flex",
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 1,
          ml: 4,
          mt: 2,
        }}
      >
        {paramDefs.map((paramDef) => (
          <Box key={paramDef.name}>
            {/* Parameter Combobox */}
            {dataLoaderType === "QC_Data" &&
            (paramDef.name === "std_param_name" ||
              paramDef.name.toLowerCase().includes("param")) ? (
              <Autocomplete<ParamOption>
                freeSolo={false}
                disableClearable={false}
                options={paramOptions}
                getOptionLabel={(option) => option.text}
                value={
                  paramOptions.find((o) => o.value === params[paramDef.name]) ||
                  null
                }
                onChange={(event: any, newValue) => {
                  dispatch(
                    dfActions.updateDataLoaderConnectParam({
                      dataLoaderType,
                      paramName: paramDef.name,
                      paramValue: newValue ? newValue.value : "",
                    }),
                  );
                }}
                renderInput={(paramsInput) => (
                  <TextField
                    {...paramsInput}
                    sx={{
                      width: "270px",
                      "& .MuiInputLabel-root": { fontSize: 14 },
                      "& .MuiInputBase-root": { fontSize: 14 },
                      "& .MuiInputBase-input::placeholder": {
                        fontSize: 12,
                        fontStyle: "italic",
                      },
                    }}
                    variant="standard"
                    size="small"
                    required={paramDef.required}
                    key={paramDef.name}
                    label="Parameter"
                    placeholder="Select QC parameter"
                    slotProps={{
                      inputLabel: { shrink: true },
                    }}
                  />
                )}
              />
            ) : null}

            {/* ✅ FACODE Combobox */}
            {dataLoaderType === "QC_Data" && paramDef.name === "facode_name" ? (
              <Autocomplete<ParamOption>
                freeSolo={false}
                disableClearable={false}
                options={facodeOptions}
                getOptionLabel={(option) => option.text}
                value={
                  facodeOptions.find(
                    (o) => o.value === params[paramDef.name],
                  ) || null
                }
                onChange={(event, newValue) => {
                  dispatch(
                    dfActions.updateDataLoaderConnectParam({
                      dataLoaderType,
                      paramName: paramDef.name,
                      paramValue: newValue ? newValue.value : "", // ✅ Lưu VALUE
                    }),
                  );
                }}
                renderInput={(paramsInput) => (
                  <TextField
                    {...paramsInput}
                    sx={{
                      width: "270px",
                      "& .MuiInputLabel-root": { fontSize: 14 },
                      "& .MuiInputBase-root": { fontSize: 14 },
                      "& .MuiInputBase-input::placeholder": {
                        fontSize: 12,
                        fontStyle: "italic",
                      },
                    }}
                    variant="standard"
                    size="small"
                    required={paramDef.required}
                    key={paramDef.name}
                    label="Facode"
                    placeholder="Select Facode"
                    slotProps={{
                      inputLabel: { shrink: true },
                    }}
                  />
                )}
              />
            ) : null}
            {/* ✅ Item group Combobox */}
            {dataLoaderType === "QC_Data" &&
            paramDef.name === "group_item_name" ? (
              <Autocomplete<ParamOption>
                freeSolo={false}
                disableClearable={false}
                options={itemGroupOptions}
                getOptionLabel={(option) => option.text}
                value={
                  itemGroupOptions.find(
                    (o) => o.value === params[paramDef.name],
                  ) || null
                }
                onChange={(event, newValue) => {
                  dispatch(
                    dfActions.updateDataLoaderConnectParam({
                      dataLoaderType,
                      paramName: paramDef.name,
                      paramValue: newValue ? newValue.value : "", // ✅ Lưu VALUE
                    }),
                  );
                  // ✅ Load item options when item group changes
                  if (newValue && newValue.value) {
                    loadItemOptions(newValue.value);
                    // Clear item selection when group changes
                    dispatch(
                      dfActions.updateDataLoaderConnectParam({
                        dataLoaderType,
                        paramName: "item_name",
                        paramValue: "",
                      }),
                    );
                  }
                }}
                renderInput={(paramsInput) => (
                  <TextField
                    {...paramsInput}
                    sx={{
                      width: "270px",
                      "& .MuiInputLabel-root": { fontSize: 14 },
                      "& .MuiInputBase-root": { fontSize: 14 },
                      "& .MuiInputBase-input::placeholder": {
                        fontSize: 12,
                        fontStyle: "italic",
                      },
                    }}
                    variant="standard"
                    size="small"
                    required={paramDef.required}
                    key={paramDef.name}
                    label="Item group"
                    placeholder="Select Item Group"
                    slotProps={{
                      inputLabel: { shrink: true },
                    }}
                  />
                )}
              />
            ) : null}
            {/* ✅ Item Combobox (child of Item Group) */}
            {dataLoaderType === "QC_Data" && paramDef.name === "item_name" ? (
              <Autocomplete<ParamOption>
                freeSolo={false}
                disableClearable={false}
                options={itemOptions}
                getOptionLabel={(option) => option.text}
                value={
                  itemOptions.find((o) => o.value === params[paramDef.name]) ||
                  null
                }
                onChange={(event, newValue) => {
                  dispatch(
                    dfActions.updateDataLoaderConnectParam({
                      dataLoaderType,
                      paramName: paramDef.name,
                      paramValue: newValue ? newValue.value : "",
                    }),
                  );
                }}
                disabled={itemOptions.length === 0}
                renderInput={(paramsInput) => (
                  <TextField
                    {...paramsInput}
                    sx={{
                      width: "270px",
                      "& .MuiInputLabel-root": { fontSize: 14 },
                      "& .MuiInputBase-root": { fontSize: 14 },
                      "& .MuiInputBase-input::placeholder": {
                        fontSize: 12,
                        fontStyle: "italic",
                      },
                    }}
                    variant="standard"
                    size="small"
                    required={paramDef.required}
                    key={paramDef.name}
                    label="Item"
                    placeholder={
                      itemOptions.length === 0
                        ? "Select Item Group first"
                        : "Select Item"
                    }
                    slotProps={{
                      inputLabel: { shrink: true },
                    }}
                  />
                )}
              />
            ) : null}

            {/* ✅ Operation Combobox */}
            {dataLoaderType === "QC_Data" &&
            paramDef.name === "operation_name" ? (
              <Autocomplete<ParamOption>
                freeSolo={false}
                disableClearable={false}
                options={operationOptions}
                getOptionLabel={(option) => option.text}
                value={
                  operationOptions.find(
                    (o) => o.value === params[paramDef.name],
                  ) || null
                }
                onChange={(event, newValue) => {
                  dispatch(
                    dfActions.updateDataLoaderConnectParam({
                      dataLoaderType,
                      paramName: paramDef.name,
                      paramValue: newValue ? newValue.value : "",
                    }),
                  );
                }}
                disabled={operationOptions.length === 0}
                renderInput={(paramsInput) => (
                  <TextField
                    {...paramsInput}
                    sx={{
                      width: "270px",
                      "& .MuiInputLabel-root": { fontSize: 14 },
                      "& .MuiInputBase-root": { fontSize: 14 },
                      "& .MuiInputBase-input::placeholder": {
                        fontSize: 12,
                        fontStyle: "italic",
                      },
                    }}
                    variant="standard"
                    size="small"
                    required={paramDef.required}
                    key={paramDef.name}
                    label="Operation"
                    placeholder={
                      operationOptions.length === 0
                        ? "Loading..."
                        : "Select Operation"
                    }
                    slotProps={{
                      inputLabel: { shrink: true },
                    }}
                  />
                )}
              />
            ) : null}

            {/* Default TextField */}
            {paramDef.name !== "std_param_name" &&
            paramDef.name !== "facode_name" &&
            paramDef.name !== "group_item_name" &&
            paramDef.name !== "item_name" &&
            paramDef.name !== "operation_name" &&
            !paramDef.name.toLowerCase().includes("param") ? (
              <TextField
                disabled={Object.keys(tableMetadata).length > 0}
                sx={{
                  width: "270px",
                  "& .MuiInputLabel-root": { fontSize: 14 },
                  "& .MuiInputBase-root": { fontSize: 14 },
                  "& .MuiInputBase-input::placeholder": {
                    fontSize: 12,
                    fontStyle: "italic",
                  },
                }}
                variant="standard"
                size="small"
                required={paramDef.required}
                key={paramDef.name}
                label={paramDef.name}
                type={paramDef.type === "date" ? "date" : "text"}
                value={params[paramDef.name] ?? ""}
                placeholder={paramDef.description}
                onChange={(event: any) => {
                  dispatch(
                    dfActions.updateDataLoaderConnectParam({
                      dataLoaderType,
                      paramName: paramDef.name,
                      paramValue: event.target.value,
                    }),
                  );
                }}
                slotProps={{
                  inputLabel: { shrink: true },
                }}
              />
            ) : null}
          </Box>
        ))}

        {/* Show table filter only for non-QC loaders */}
        {dataLoaderType !== "QC_Data" && (
          <TextField
            size="small"
            color="secondary"
            sx={{
              width: "270px",
              "& .MuiInputLabel-root": {
                fontSize: 14,
                color: theme.palette.secondary.main,
              },
              "& .MuiInputBase-root": { fontSize: 14 },
              "& .MuiInputBase-input::placeholder": {
                fontSize: 12,
                fontStyle: "italic",
              },
              "&:hover": {
                backgroundColor: alpha(theme.palette.secondary.main, 0.03),
              },
            }}
            key="table-filter"
            autoComplete="off"
            variant="standard"
            label={
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 0.5,
                }}
              >
                <SearchIcon
                  sx={{ fontSize: 16, color: theme.palette.secondary.main }}
                />
                table filter
              </Box>
            }
            placeholder="load only tables containing keywords"
            value={tableFilter}
            onChange={(event) => setTableFilter(event.target.value)}
            slotProps={{
              inputLabel: { shrink: true },
            }}
          />
        )}
        <TextField
          size="small"
          color="secondary"
          key="table-filter-hidden"
          autoComplete="off"
          variant="standard"
          label={
            dataLoaderType === "QC_Data" ? (
              "Parameter"
            ) : (
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 0.5,
                }}
              >
                <SearchIcon
                  sx={{ fontSize: 16, color: theme.palette.secondary.main }}
                />
                table filter
              </Box>
            )
          }
          placeholder={
            dataLoaderType === "QC_Data"
              ? "Select QC parameter"
              : "load only tables containing keywords"
          }
          value={tableFilter}
          onChange={(event) => setTableFilter(event.target.value)}
          slotProps={{
            inputLabel: { shrink: true },
          }}
          sx={{
            display: "none", // ✅ Ẩn luôn field này
            width: "270px",
            "& .MuiInputLabel-root": {
              fontSize: 14,
              color: theme.palette.secondary.main,
            },
            "& .MuiInputBase-root": { fontSize: 14 },
            "& .MuiInputBase-input::placeholder": {
              fontSize: 12,
              fontStyle: "italic",
            },
            "&:hover": {
              backgroundColor: alpha(theme.palette.secondary.main, 0.03),
            },
          }}
        />

        {paramDefs.length > 0 && (
          <Box sx={{ mt: 1 }}>
            {dataLoaderType === "QC_Data" ? (
              /* QC mode: single Load Data button */
              <ButtonGroup
                sx={{ height: 32, mt: "auto" }}
                size="small"
                variant="contained"
                color="primary"
              >
                <Button
                  sx={{ textTransform: "none" }}
                  onClick={async () => {
                    setIsConnecting(true);
                    setDisplayAuthInstructions(false);

                    // Build dates in yyyyMMdd (remove dashes). Use safe fallback.
                    const fromRaw = (params["from_date"] ?? "").toString();
                    const toRaw = (params["to_date"] ?? "").toString();
                    const from = fromRaw ? fromRaw.replace(/-/g, "") : "";
                    const to = toRaw ? toRaw.replace(/-/g, "") : "";

                    // Get std_param_name (must be chosen from Autocomplete)
                    const stdParam = params["std_param_name"] ?? "";
                    const facode = params["facode_name"] ?? "";
                    const itemGroup = (params["group_item_name"] ?? "")
                      .toString()
                      .trim();
                    const item = (params["item_name"] ?? "").toString().trim();
                    const operation = (params["operation_name"] ?? "")
                      .toString()
                      .trim();

                    // Validate required
                    if (!from) {
                      onFinish("error", "Missing from_date parameter");
                      setIsConnecting(false);
                      return;
                    }
                    if (!to) {
                      onFinish("error", "Missing to_date parameter");
                      setIsConnecting(false);
                      return;
                    }
                    if (!stdParam) {
                      onFinish("error", "Please select a parameter");
                      setIsConnecting(false);
                      return;
                    }
                    if (!facode) {
                      onFinish("error", "Please select Factory (Facode)");
                      setIsConnecting(false);
                      return;
                    }
                    if (!itemGroup) {
                      onFinish("error", "Please select Item Group");
                      setIsConnecting(false);
                      return;
                    }

                    // safe escape single quote
                    const safeParam = stdParam.replace(/'/g, "''");
                    const safeFacode = facode.replace(/'/g, "''");
                    const safeItemGroup = itemGroup.replace(/'/g, "''");
                    const safeItem = item.replace(/'/g, "''");
                    const safeOperation = operation.replace(/'/g, "''");

                    // Build the SQL query (use DPD_QC_INFO and QCSTDPARAMNAME as you requested)
                    const queryParam = ` AND STDPARAMREPORTNAME ='${safeParam}'`;
                    const queryFacode = ` AND FACODE ='${safeFacode}'`;
                    const queryItemGroup = ` AND GROUPITEMOID ='${safeItemGroup}'`;
                    const queryItem = ` AND SPITEMOID ='${safeItem}'`;
                    const queryOperation = ` AND OPERATIONOID ='${safeOperation}'`;
                    const queryEnd = " ORDER BY LASTUPDATE";
                    let query = `SELECT
                                ROW_NUMBER() OVER (ORDER BY LASTUPDATE) AS INDEX,
                                VALUEVIEW AS VALUE,
                                QCSTDPARAMNAME,
                                STDPARAMNICKNAME AS PARAMNICKNAME,
                                SLIPNO,
                                LL,ARLL,TARGET,ARUL,UL,
                                QCDATE,
                                QCSHIFT,
                                DISKNO,
                                LASTUPDATE,
                                SPITEMNAME as ITEMNAME,
                                OPERATIONNAME as OPERATION,
                                FACODE
                                FROM gcdb.DPD_QC_INFO
                                WHERE QCDATE >= '${from}' AND QCDATE <= '${to}'
                                AND ISMAXQCROUND = '1'
                                AND IS_DELETED <> '1'
                                AND (MAINSLIPNO = '1' OR MAINSLIPNO is null)`;

                    if (safeParam.trim() !== "") {
                      query += queryParam;
                    }

                    if (safeFacode.trim() !== "") {
                      query += queryFacode;
                    }

                    if (safeItemGroup.trim() !== "") {
                      query += queryItemGroup;
                    }

                    // ✅ Add Item condition if Item is selected
                    if (safeItem.trim() !== "") {
                      query += queryItem;
                    }

                    // ✅ Add Operation condition if Operation is selected
                    if (safeOperation.trim() !== "") {
                      query += queryOperation;
                    }

                    // end query

                    query += queryEnd;

                    try {
                      onImport(); // show busy indicator
                      const response = await fetch(
                        getUrls().DATA_LOADER_INGEST_DATA_FROM_QUERY,
                        {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                          },
                          body: JSON.stringify({
                            data_loader_type: dataLoaderType,
                            data_loader_params: params,
                            query: query,
                            name_as: safeParam.trim().replace(" ", "-"),
                          }),
                        },
                      );
                      const data = await response.json();
                      if (data.status === "success") {
                        // Notify parent with the params used so it can store them per-table
                        onQcLoadSuccess?.(
                          safeParam.trim().replace(" ", "-"),
                          params,
                        );
                        onFinish("success", "QC data loaded successfully");
                        // refresh tables so qc_data appears in DB list (if backend inserts it into main)
                        setTableMetadata({});
                      } else {
                        onFinish(
                          "error",
                          data.reasoning ??
                            data.message ??
                            "Failed to load QC data",
                        );
                      }
                    } catch (err) {
                      console.error("Failed to load QC data:", err);
                      onFinish(
                        "error",
                        "Failed to load QC data, please check server",
                      );
                    } finally {
                      setIsConnecting(false);
                    }
                  }}
                >
                  Load Data
                </Button>
              </ButtonGroup>
            ) : (
              /* Non-QC: existing Connect / Disconnect UI (unchanged behavior) */
              <ButtonGroup
                sx={{ height: 32, mt: "auto" }}
                size="small"
                variant="contained"
                color="primary"
              >
                <Button
                  sx={{ textTransform: "none" }}
                  onClick={async () => {
                    setIsConnecting(true);
                    setDisplayAuthInstructions(false);
                    await fetch(getUrls().DATA_LOADER_LIST_TABLES, {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        data_loader_type: dataLoaderType,
                        data_loader_params: params,
                        table_filter: (tableFilter || "").trim() || null,
                      }),
                    })
                      .then((response) => response.json())
                      .then((data) => {
                        if (data.status === "success") {
                          console.log(data.tables);
                          setTableMetadata(
                            Object.fromEntries(
                              data.tables.map((table: any) => {
                                return [table.name, table.metadata];
                              }),
                            ),
                          );
                        } else {
                          console.error(
                            "Failed to fetch data loader tables: {}",
                            data.message,
                          );
                          onFinish(
                            "error",
                            `Failed to fetch data loader tables: ${data.message}`,
                          );
                        }
                        setIsConnecting(false);
                      })
                      .catch((error) => {
                        onFinish(
                          "error",
                          `Failed to fetch data loader tables, please check the server is running`,
                        );
                        setIsConnecting(false);
                      });
                  }}
                >
                  {Object.keys(tableMetadata).length > 0
                    ? "refresh"
                    : "connect"}{" "}
                  {(tableFilter || "").trim() ? "with filter" : ""}
                </Button>
                <Button
                  disabled={Object.keys(tableMetadata).length === 0}
                  sx={{ textTransform: "none" }}
                  onClick={() => {
                    setTableMetadata({});
                    setTableFilter("");
                  }}
                >
                  disconnect
                </Button>
              </ButtonGroup>
            )}
          </Box>
        )}
      </Box>
      <Box
        sx={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 1,
          ml: 4,
          mt: 4,
        }}
      ></Box>
      <Button
        variant="text"
        size="small"
        sx={{ textTransform: "none", height: 32, mt: 1 }}
        onClick={() => setDisplayAuthInstructions(!displayAuthInstructions)}
      >
        {displayAuthInstructions ? "hide" : "show"} authentication instructions
      </Button>
      {
        <Collapse in={displayAuthInstructions} timeout="auto" unmountOnExit>
          <Paper sx={{ px: 1, py: 0.5, maxHeight: 300, overflowY: "auto" }}>
            <Typography
              variant="body2"
              sx={{ fontSize: 12, whiteSpace: "pre-wrap", p: 1 }}
            >
              {authInstructions.trim()}
            </Typography>
          </Paper>
        </Collapse>
      }

      {Object.keys(tableMetadata).length > 0 && tableMetadataBox}
    </Box>
  );
};

// QCDataDialog - Simplified dialog for quick QC Data import
export const QCDataDialog: React.FC<{
  buttonElement: any;
  sx?: SxProps;
}> = function QCDataDialog({ buttonElement, sx }) {
  const theme = useTheme();
  const dispatch = useDispatch<AppDispatch>();
  const tables = useSelector((state: DataFormulatorState) => state.tables);
  const serverConfig = useSelector(
    (state: DataFormulatorState) => state.serverConfig,
  );

  const [qcDialogOpen, setQcDialogOpen] = useState<boolean>(false);
  const [dataLoaderMetadata, setDataLoaderMetadata] = useState<
    Record<
      string,
      {
        params: {
          name: string;
          default: string;
          type: string;
          required: boolean;
          description: string;
        }[];
        auth_instructions: string;
      }
    >
  >({});

  const [dbTables, setDbTables] = useState<DBTable[]>([]);
  const [selectedTabKey, setSelectedTabKey] = useState("");
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [tableAnalysisMap, setTableAnalysisMap] = useState<
    Record<string, ColumnStatistics[] | null>
  >({});
  const [pendingTableToSelect, setPendingTableToSelect] = useState<string>("");
  const pendingLoaderParamsRef = useRef<Record<string, Record<string, string>>>(
    {},
  );

  let setSystemMessage = (
    content: string,
    severity: "error" | "warning" | "info" | "success",
  ) => {
    dispatch(
      dfActions.addMessages({
        timestamp: Date.now(),
        component: "QC Data loader",
        type: severity,
        value: content,
      }),
    );
  };

  // Auto-select pending table when dbTables updates
  useEffect(() => {
    if (pendingTableToSelect && dbTables.length > 0) {
      const tableExists = dbTables.some((t) => t.name === pendingTableToSelect);
      if (tableExists) {
        setSelectedTabKey(pendingTableToSelect);
        setPendingTableToSelect("");
      }
    }
  }, [dbTables, pendingTableToSelect]);

  useEffect(() => {
    if (qcDialogOpen) {
      fetchDataLoaders();
      fetchTables();
    }
  }, [qcDialogOpen]);

  const fetchDataLoaders = async () => {
    fetch(getUrls().DATA_LOADER_LIST_DATA_LOADERS, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.status === "success") {
          setDataLoaderMetadata(data.data_loaders);
        } else {
          console.error("Failed to fetch data loader params:", data.error);
        }
      })
      .catch((error) => {
        console.error("Failed to fetch data loader params:", error);
      });
  };

  const fetchTables = async () => {
    if (serverConfig.DISABLE_DATABASE) return;
    try {
      const response = await fetch(getUrls().LIST_TABLES);
      const data = await response.json();
      if (data.status === "success") {
        setDbTables(data.tables);
        return data.tables;
      }
    } catch (error) {
      setSystemMessage("Failed to fetch tables", "error");
    }
    return [];
  };

  const handleQcLoadSuccess = async (
    tableName: string,
    loaderParams: Record<string, string>,
  ) => {
    pendingLoaderParamsRef.current[tableName] = loaderParams;
    setPendingTableToSelect(tableName); // Mark table to be selected
    await fetchTables(); // Fetch tables to update dbTables state
  };

  const handleAnalyzeData = async (tableName: string) => {
    if (!tableName) return;
    if (tableAnalysisMap[tableName]) return;

    try {
      const response = await fetch(getUrls().GET_COLUMN_STATS, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ table_name: tableName }),
      });
      const data = await response.json();
      if (data.status === "success") {
        setTableAnalysisMap((prevMap) => ({
          ...prevMap,
          [tableName]: data.statistics,
        }));
      }
    } catch (error) {
      setSystemMessage("Failed to analyze table data", "error");
    }
  };

  const toggleAnalysisView = (tableName: string) => {
    if (tableAnalysisMap[tableName]) {
      setTableAnalysisMap((prevMap) => {
        const newMap = { ...prevMap };
        delete newMap[tableName];
        return newMap;
      });
    } else {
      handleAnalyzeData(tableName);
    }
  };

  const handleAddTableToDF = (dbTable: DBTable) => {
    const convertSqlTypeToAppType = (sqlType: string): Type => {
      sqlType = sqlType.toUpperCase();
      if (
        sqlType.includes("INT") ||
        sqlType === "BIGINT" ||
        sqlType === "SMALLINT" ||
        sqlType === "TINYINT"
      ) {
        return Type.Integer;
      } else if (
        sqlType.includes("FLOAT") ||
        sqlType.includes("DOUBLE") ||
        sqlType.includes("DECIMAL") ||
        sqlType.includes("NUMERIC") ||
        sqlType.includes("REAL")
      ) {
        return Type.Number;
      } else if (sqlType.includes("BOOL")) {
        return Type.Boolean;
      } else if (
        sqlType.includes("DATE") ||
        sqlType.includes("TIME") ||
        sqlType.includes("TIMESTAMP")
      ) {
        return Type.Date;
      } else {
        return Type.String;
      }
    };

    const sanitizedRows = dbTable.sample_rows.map((row: any) => {
      const r = { ...row };
      if (r.VALUE !== undefined && r.VALUE !== null) {
        const numValue = Number(r.VALUE);
        r.VALUE = isNaN(numValue) ? r.VALUE : numValue;
      }
      return r;
    });

    const sanitizedColumns = dbTable.columns.filter(
      (c: any) => c.name !== "VALUE_NUM" && c.name !== "VALUE_IS_NUM",
    );

    let table: DictTable = {
      id: dbTable.name,
      displayId: dbTable.name,
      names: sanitizedColumns.map((col: any) => col.name),
      metadata: sanitizedColumns.reduce(
        (
          acc: Record<
            string,
            { type: Type; semanticType: string; levels: any[] }
          >,
          col: any,
        ) => ({
          ...acc,
          [col.name]: {
            type: convertSqlTypeToAppType(col.type),
            semanticType: "",
            levels: [],
          },
        }),
        {},
      ),
      rows: sanitizedRows,
      virtual: {
        tableId: dbTable.name,
        rowCount: dbTable.row_count,
        loaderParams: pendingLoaderParamsRef.current[dbTable.name],
      },
      anchored: true,
      createdBy: "user",
      attachedMetadata: "",
    };
    dispatch(dfActions.replaceTable(table));
    dispatch(fetchFieldSemanticType(table));
    setQcDialogOpen(false);
  };

  const handleDeleteTable = async (tableName: string) => {
    try {
      const response = await fetch(getUrls().DELETE_TABLE, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ table_name: tableName }),
      });
      const data = await response.json();
      if (data.status === "success") {
        setDbTables((prevTables) =>
          prevTables.filter((t) => t.name !== tableName),
        );
        setTableAnalysisMap((prevMap) => {
          const newMap = { ...prevMap };
          delete newMap[tableName];
          return newMap;
        });
        setSelectedTabKey("");
        setSystemMessage(`Table ${tableName} deleted successfully`, "success");
      } else {
        setSystemMessage(data.error || "Failed to delete table", "error");
      }
    } catch (error) {
      setSystemMessage("Failed to delete table", "error");
    }
  };

  const handleDownloadTable = async (tableName: string) => {
    try {
      const response = await fetch(getUrls().SAMPLE_TABLE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: tableName,
          size: 999999,
          method: "head",
          range_start: 0,
          range_size: 999999,
        }),
      });
      const result = await response.json();
      if (
        result.status !== "success" ||
        !result.rows ||
        result.rows.length === 0
      ) {
        throw new Error("No data available for this table");
      }
      const rows = result.rows;
      if (
        !Array.isArray(rows) ||
        rows.length === 0 ||
        typeof rows[0] !== "object"
      ) {
        throw new Error("No valid data to export");
      }

      // Convert to CSV
      const headers = Object.keys(rows[0]);
      const csvContent = [
        headers.join(","),
        ...rows.map((row) =>
          headers
            .map((h) => {
              const value = row[h];
              if (value === null || value === undefined) {
                return "";
              }
              const stringValue = String(value);
              if (stringValue.includes(",") || stringValue.includes('"')) {
                return `"${stringValue.replace(/"/g, '""')}"`;
              }
              return stringValue;
            })
            .join(","),
        ),
      ].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `${tableName}.csv`);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setSystemMessage(`Table ${tableName} downloaded successfully`, "success");
    } catch (error) {
      setSystemMessage(`Failed to download table: ${error}`, "error");
    }
  };

  let qcDataLoaderPanel = (
    <Box
      sx={{
        p: 1,
        display: "flex",
        flexDirection: "column",
        backgroundColor: alpha(theme.palette.secondary.main, 0.02),
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", px: 1, mb: 1 }}>
        <Typography
          variant="caption"
          sx={{
            color: "text.disabled",
            fontWeight: "500",
            flexGrow: 1,
            fontSize: "0.75rem",
          }}
        >
          Data Connector
        </Typography>
      </Box>

      <Button
        variant="text"
        size="small"
        sx={{
          textTransform: "none",
          width: 120,
          justifyContent: "flex-start",
          textAlign: "left",
          borderRadius: 0,
          py: 0.5,
          px: 2,
          color: "secondary.main",
          borderRight: 2,
          borderColor: "secondary.main",
        }}
      >
        <Typography
          fontSize="inherit"
          sx={{
            textTransform: "none",
            width: "calc(100% - 4px)",
            textAlign: "left",
            textOverflow: "ellipsis",
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          QC_Data
        </Typography>
      </Button>
    </Box>
  );

  let qcDataTablePanel = (
    <Box
      sx={{
        px: 0.5,
        pt: 1,
        display: "flex",
        flexDirection: "column",
        backgroundColor: alpha(theme.palette.primary.main, 0.02),
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", px: 1, mb: 1 }}>
        <Typography
          variant="caption"
          sx={{
            color: "text.disabled",
            fontWeight: "500",
            flexGrow: 1,
            fontSize: "0.75rem",
          }}
        >
          Data Tables
        </Typography>
        <Tooltip title="refresh the table list">
          <IconButton
            size="small"
            color="primary"
            sx={{
              "&:hover": {
                transform: "rotate(180deg)",
              },
              transition: "transform 0.3s ease-in-out",
            }}
            onClick={() => {
              fetchTables();
            }}
          >
            <RefreshIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {dbTables.length == 0 && (
        <Typography
          variant="caption"
          sx={{ color: "lightgray", px: 2, py: 0.5, fontStyle: "italic" }}
        >
          no tables available
        </Typography>
      )}

      <Button
        variant="text"
        size="small"
        color="primary"
        onClick={() => {
          setSelectedTabKey("");
        }}
        sx={{
          textTransform: "none",
          width: 160,
          justifyContent: "flex-start",
          textAlign: "left",
          borderRadius: 0,
          py: 0.5,
          px: 2,
          color: selectedTabKey === "" ? "primary.main" : "text.secondary",
          borderRight: selectedTabKey === "" ? 2 : 0,
        }}
      >
        <Typography
          fontSize="inherit"
          sx={{
            width: "calc(100% - 4px)",
            textAlign: "left",
            textOverflow: "ellipsis",
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          ← New Query
        </Typography>
      </Button>

      {dbTables
        //.filter((t) => !t.name.endsWith("_live"))
        .map((t, i) => (
          <Box
            key={t.name}
            sx={{
              display: "flex",
              alignItems: "center",
              borderRadius: 0,
              py: 0.5,
              px: 0,
              backgroundColor:
                selectedTabKey === t.name
                  ? "rgba(25, 118, 210, 0.08)"
                  : "transparent",
              borderRight: selectedTabKey === t.name ? 2 : 0,
              borderColor: "primary.main",
            }}
          >
            <Button
              variant="text"
              size="small"
              color="primary"
              onClick={() => {
                setSelectedTabKey(t.name);
              }}
              sx={{
                textTransform: "none",
                flex: 1,
                justifyContent: "flex-start",
                textAlign: "left",
                borderRadius: 0,
                py: 0.5,
                px: 2,
                color:
                  selectedTabKey === t.name ? "primary.main" : "text.secondary",
              }}
            >
              <Typography
                fontSize="inherit"
                sx={{
                  width: "100%",
                  textAlign: "left",
                  textOverflow: "ellipsis",
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                }}
              >
                {t.name}
              </Typography>
            </Button>
            <Tooltip title="delete table">
              <IconButton
                size="small"
                color="error"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteTable(t.name);
                }}
                sx={{
                  py: 0.5,
                  px: 0.5,
                  mr: 0.5,
                }}
              >
                <DeleteIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </Box>
        ))}
    </Box>
  );

  let qcDataView = (
    <Box sx={{ flex: 1, width: 880, overflow: "auto", p: 2 }}>
      {/* QC Data Loader Form */}
      {selectedTabKey === "" && dataLoaderMetadata["QC_Data"] && (
        <Box sx={{ position: "relative", maxWidth: "100%" }}>
          <DataLoaderForm
            dataLoaderType="QC_Data"
            paramDefs={dataLoaderMetadata["QC_Data"].params}
            authInstructions={dataLoaderMetadata["QC_Data"].auth_instructions}
            onImport={() => {
              setIsUploading(true);
            }}
            onQcLoadSuccess={(tableName, loaderParams) => {
              handleQcLoadSuccess(tableName, loaderParams);
            }}
            onFinish={(status, message) => {
              setIsUploading(false);
              if (status === "success") {
                setSystemMessage(message, "success");
              } else {
                setSystemMessage(message, "error");
              }
            }}
          />
        </Box>
      )}

      {/* Table View */}
      {dbTables
        .filter((t) => !t.name.endsWith("_live"))
        .map((t, i) => {
          if (selectedTabKey !== t.name) return null;

          const currentTable = t;
          const showingAnalysis =
            tableAnalysisMap[currentTable.name] !== undefined;
          return (
            <Box
              key={t.name}
              sx={{
                maxWidth: "100%",
                overflowX: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 1,
              }}
            >
              <Paper variant="outlined">
                <Box
                  sx={{
                    px: 1,
                    display: "flex",
                    alignItems: "center",
                    borderBottom: "1px solid rgba(0,0,0,0.1)",
                  }}
                >
                  <Typography variant="caption">
                    {showingAnalysis
                      ? "column stats for "
                      : "sample data from "}
                    <Typography
                      component="span"
                      sx={{ fontSize: 12, fontWeight: "bold" }}
                    >
                      {currentTable.name}
                    </Typography>
                    <Typography
                      component="span"
                      sx={{ ml: 1, fontSize: 10, color: "text.secondary" }}
                    >
                      ({currentTable.columns.length} columns ×{" "}
                      {currentTable.row_count} rows)
                    </Typography>
                  </Typography>
                  <Box sx={{ marginLeft: "auto", display: "flex", gap: 1 }}>
                    <Button
                      size="small"
                      color={showingAnalysis ? "secondary" : "primary"}
                      onClick={() => toggleAnalysisView(currentTable.name)}
                      startIcon={<AnalyticsIcon fontSize="small" />}
                      sx={{ textTransform: "none" }}
                    >
                      {showingAnalysis
                        ? "show data samples"
                        : "show column stats"}
                    </Button>
                  </Box>
                </Box>
                {showingAnalysis ? (
                  <TableStatisticsView
                    tableName={currentTable.name}
                    columnStats={tableAnalysisMap[currentTable.name] ?? []}
                  />
                ) : (
                  <CustomReactTable
                    rows={currentTable.sample_rows
                      .map((row: any) => {
                        const r = { ...row };
                        if (r.VALUE_NUM !== undefined && r.VALUE_NUM !== null) {
                          r.VALUE = r.VALUE_NUM;
                        }
                        delete r.VALUE_NUM;
                        delete r.VALUE_IS_NUM;

                        return Object.fromEntries(
                          Object.entries(r).map(
                            ([key, value]: [string, any]) => {
                              return [key, String(value)];
                            },
                          ),
                        );
                      })
                      .slice(0, 9)}
                    columnDefs={currentTable.columns
                      .filter(
                        (col) =>
                          col.name !== "VALUE_NUM" &&
                          col.name !== "VALUE_IS_NUM",
                      )
                      .map((col) => ({
                        id: col.name,
                        label: col.name,
                        minWidth: 60,
                      }))}
                    rowsPerPageNum={-1}
                    compact={false}
                    isIncompleteTable={currentTable.row_count > 10}
                  />
                )}
              </Paper>
              <Box sx={{ display: "flex", gap: 1, ml: "auto" }}>
                <Button
                  variant="text"
                  size="small"
                  onClick={() => {
                    setSelectedTabKey("");
                  }}
                >
                  ← New Query
                </Button>
                <Tooltip title="download table as csv">
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<DownloadIcon fontSize="small" />}
                    onClick={() => {
                      handleDownloadTable(currentTable.name);
                    }}
                    sx={{ textTransform: "none" }}
                  >
                    Download
                  </Button>
                </Tooltip>
                <Button
                  variant="contained"
                  size="small"
                  onClick={() => {
                    handleAddTableToDF(currentTable);
                  }}
                >
                  Use Data
                </Button>
              </Box>
            </Box>
          );
        })}
    </Box>
  );

  return (
    <>
      <Tooltip title="QC Data loader">
        <Box
          onClick={() => setQcDialogOpen(true)}
          sx={{
            cursor: serverConfig.DISABLE_DATABASE ? "not-allowed" : "pointer",
            display: "inline-block",
            opacity: serverConfig.DISABLE_DATABASE ? 0.5 : 1,
            pointerEvents: serverConfig.DISABLE_DATABASE ? "none" : "auto",
          }}
        >
          {buttonElement}
        </Box>
      </Tooltip>
      <Dialog
        open={qcDialogOpen}
        onClose={() => setQcDialogOpen(false)}
        maxWidth="lg"
        fullWidth
        sx={{
          "& .MuiDialog-paper": {
            maxHeight: 700,
          },
        }}
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center" }}>
          QC Data Loader
          <IconButton
            sx={{ marginLeft: "auto" }}
            edge="start"
            size="small"
            color="inherit"
            aria-label="close"
            onClick={() => setQcDialogOpen(false)}
          >
            <CloseIcon fontSize="inherit" />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          <Box sx={{ display: "flex", height: "inherit" }}>
            <Box
              sx={{
                width: 170,
                borderRight: "1px solid rgba(0,0,0,0.1)",
                overflow: "auto",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {qcDataLoaderPanel}
              <Box
                sx={{
                  flex: 1,
                  overflow: "auto",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {qcDataTablePanel}
              </Box>
            </Box>
            {qcDataView}
          </Box>
        </DialogContent>
      </Dialog>
    </>
  );
};

export const DataQueryForm: React.FC<{
  dataLoaderType: string;
  paramDefs?: {
    name: string;
    required: boolean;
  }[];
  availableTables: { name: string; fields: string[] }[];
  dataLoaderParams: Record<string, string>;
  onImport: () => void;
  onFinish: (status: "success" | "error", message: string) => void;
}> = ({
  dataLoaderType,
  paramDefs = [],
  availableTables,
  dataLoaderParams,
  onImport,
  onFinish,
}) => {
  let activeModel = useSelector(dfSelectors.getActiveModel);

  // Helper function to validate required params
  const validateRequiredParams = (): string | null => {
    for (const paramDef of paramDefs) {
      if (paramDef.required && !dataLoaderParams[paramDef.name]) {
        // Format param names for display
        const paramLabel =
          paramDef.name === "from_date"
            ? "from_date"
            : paramDef.name === "to_date"
            ? "to_date"
            : paramDef.name === "std_param_name"
            ? "Parameter"
            : paramDef.name === "facode_name"
            ? "Factory (Facode)"
            : paramDef.name === "operation_name"
            ? "Operation"
            : paramDef.name;
        return `Please select ${paramLabel}`;
      }
    }
    return null;
  };

  const [selectedTables, setSelectedTables] = useState<string[]>(
    availableTables.map((t) => t.name).slice(0, 5),
  );

  const [waiting, setWaiting] = useState(false);

  const [query, setQuery] = useState(
    "-- query the data source / describe your goal and ask AI to help you write the query\n",
  );
  const [queryResult, setQueryResult] = useState<
    | {
        status: string;
        message: string;
        sample: any[];
        code: string;
      }
    | undefined
  >(undefined);
  const [queryResultName, setQueryResultName] = useState("");

  const aiCompleteQuery = (query: string) => {
    if (queryResult?.status === "error") {
      setQueryResult(undefined);
    }
    let data = {
      data_source_metadata: {
        data_loader_type: dataLoaderType,
        tables: availableTables.filter((t) => selectedTables.includes(t.name)),
      },
      query: query,
      model: activeModel,
    };
    setWaiting(true);
    fetch(getUrls().QUERY_COMPLETION, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    })
      .then((response) => response.json())
      .then((data) => {
        setWaiting(false);
        if (data.status === "ok") {
          setQuery(data.query);
        } else {
          onFinish("error", data.reasoning);
        }
      })
      .catch((error) => {
        setWaiting(false);
        onFinish("error", `Failed to complete query please try again.`);
      });
  };

  const handleViewQuerySample = (query: string) => {
    setQueryResult(undefined);
    setWaiting(true);
    fetch(getUrls().DATA_LOADER_VIEW_QUERY_SAMPLE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data_loader_type: dataLoaderType,
        data_loader_params: dataLoaderParams,
        query: query,
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        setWaiting(false);
        if (data.status === "success") {
          setQueryResult({
            status: "success",
            message: "Data loaded successfully",
            sample: data.sample,
            code: query,
          });
          let newName = `r_${Math.random().toString(36).substring(2, 4)}`;
          setQueryResultName(newName);
        } else {
          setQueryResult({
            status: "error",
            message: data.message,
            sample: [],
            code: query,
          });
        }
      })
      .catch((error) => {
        setWaiting(false);
        setQueryResult({
          status: "error",
          message: `Failed to view query sample, please try again.`,
          sample: [],
          code: query,
        });
      });
  };

  const handleImportQueryResult = () => {
    setWaiting(true);
    fetch(getUrls().DATA_LOADER_INGEST_DATA_FROM_QUERY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data_loader_type: dataLoaderType,
        data_loader_params: dataLoaderParams,
        query: queryResult?.code ?? query,
        name_as: queryResultName,
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        setWaiting(false);
        if (data.status === "success") {
          onFinish("success", "Data imported successfully");
        } else {
          onFinish("error", data.reasoning);
        }
      })
      .catch((error) => {
        setWaiting(false);
        onFinish("error", `Failed to import data, please try again.`);
      });
  };

  let queryResultBox =
    queryResult?.status === "success" && queryResult.sample.length > 0
      ? [
          <Box
            key="query-result-table"
            sx={{
              display: "flex",
              flexDirection: "row",
              gap: 1,
              justifyContent: "space-between",
            }}
          >
            <CustomReactTable
              rows={queryResult.sample}
              columnDefs={Object.keys(queryResult.sample[0]).map((t: any) => ({
                id: t,
                label: t,
              }))}
              rowsPerPageNum={-1}
              compact={false}
            />
          </Box>,
          <Box
            key="query-result-controls"
            sx={{
              display: "flex",
              flexDirection: "row",
              gap: 1,
              alignItems: "center",
            }}
          >
            <Button
              variant="outlined"
              color="primary"
              size="small"
              sx={{ textTransform: "none", minWidth: 120, mr: "auto" }}
              onClick={() => {
                setQueryResult(undefined);
                setQueryResultName("");
              }}
            >
              clear result
            </Button>
            <TextField
              size="small"
              label="import as"
              sx={{
                width: 120,
                ml: "auto",
                "& .MuiInputBase-root": { fontSize: 12, height: 32 },
                "& .MuiInputLabel-root": {
                  fontSize: 12,
                  transform: "translate(14px, -6px) scale(0.75)",
                },
              }}
              slotProps={{
                inputLabel: { shrink: true },
              }}
              value={queryResultName}
              onChange={(event: any) => setQueryResultName(event.target.value)}
            />
            <Button
              variant="contained"
              color="primary"
              size="small"
              disabled={queryResultName === ""}
              sx={{ textTransform: "none", width: 120 }}
              onClick={() => {
                // Validate all required params
                const error = validateRequiredParams();
                if (error) {
                  onFinish("error", error);
                  return;
                }
                handleImportQueryResult();
              }}
            >
              import data
            </Button>
          </Box>,
        ]
      : [];

  return (
    <Paper
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        p: 1,
        position: "relative",
      }}
    >
      {waiting && (
        <Box
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            backgroundColor: "rgba(255, 255, 255, 0.7)",
          }}
        >
          <CircularProgress size={20} />
        </Box>
      )}
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        <Typography
          variant="caption"
          sx={{ color: "text.primary", fontSize: 11, mx: 0.5 }}
        >
          query from tables:
        </Typography>
        {availableTables.map((table) => (
          <Chip
            key={table.name}
            label={table.name} //icon={selectedTables.includes(table.name) ? <CheckIcon /> : undefined}
            color={selectedTables.includes(table.name) ? "primary" : "default"}
            variant="outlined"
            sx={{
              fontSize: 11,
              margin: 0.25,
              height: 20,
              borderRadius: 0.5,
              borderColor: selectedTables.includes(table.name)
                ? "primary.main"
                : "rgba(0, 0, 0, 0.1)",
              color: selectedTables.includes(table.name)
                ? "primary.main"
                : "text.secondary",
              "&:hover": {
                backgroundColor: "rgba(0, 0, 0, 0.07)",
              },
            }}
            size="small"
            onClick={() => {
              setSelectedTables(
                selectedTables.includes(table.name)
                  ? selectedTables.filter((t) => t !== table.name)
                  : [...selectedTables, table.name],
              );
            }}
          />
        ))}
      </Typography>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <Box sx={{ maxHeight: 300, overflowY: "auto" }}>
          <Editor
            value={query}
            onValueChange={(tempCode: string) => {
              setQuery(tempCode);
            }}
            highlight={(code) =>
              Prism.highlight(code, Prism.languages.sql, "sql")
            }
            padding={10}
            style={{
              minHeight: queryResult ? 60 : 200,
              fontFamily: '"Fira code", "Fira Mono", monospace',
              fontSize: 12,
              paddingBottom: "24px",
              backgroundColor: "rgba(0, 0, 0, 0.03)",
              overflowY: "auto",
            }}
          />
        </Box>
        {queryResult?.status === "error" && (
          <Box
            sx={{
              display: "flex",
              flexDirection: "row",
              gap: 1,
              alignItems: "center",
              overflow: "auto",
            }}
          >
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
                fontSize: 11,
                backgroundColor: "rgba(255, 0, 0, 0.1)",
                p: 0.5,
                borderRadius: 0.5,
              }}
            >
              {queryResult?.message}
            </Typography>
          </Box>
        )}
        <Box
          sx={{
            display: "flex",
            flexDirection: "row",
            gap: 1,
            justifyContent: "flex-end",
          }}
        >
          <Button
            variant="outlined"
            color="primary"
            size="small"
            sx={{ textTransform: "none" }}
            disabled={queryResult?.status === "error"}
            startIcon={<PrecisionManufacturingIcon />}
            onClick={() => {
              // Validate all required params
              const error = validateRequiredParams();
              if (error) {
                onFinish("error", error);
                return;
              }
              aiCompleteQuery(query);
            }}
          >
            help me complete the query from selected tables
          </Button>
          {queryResult?.status === "error" && (
            <Button
              variant="contained"
              color="primary"
              size="small"
              sx={{ textTransform: "none", minWidth: 120 }}
              startIcon={<PrecisionManufacturingIcon />}
              onClick={() =>
                aiCompleteQuery(
                  queryResult.code + "\n error:" + queryResult.message,
                )
              }
            >
              help me fix the error
            </Button>
          )}
          <Button
            variant="contained"
            color="primary"
            size="small"
            sx={{ textTransform: "none", ml: "auto", width: 80 }}
            onClick={() => {
              // Validate all required params
              const error = validateRequiredParams();
              if (error) {
                onFinish("error", error);
                return;
              }
              handleViewQuerySample(query);
            }}
          >
            run query
          </Button>
        </Box>
        {queryResult && queryResultBox}
      </Box>
    </Paper>
  );
};
