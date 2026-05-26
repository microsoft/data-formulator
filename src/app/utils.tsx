// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import _ from "lodash";
import { useEffect, useRef } from "react";
import ts from "typescript";
import {
  getChartChannels,
  getChartTemplate,
} from "../components/ChartTemplates";
import {
  Channel,
  Chart,
  ChartTemplate,
  ConceptTransformation,
  EncodingItem,
  EncodingMap,
  FieldItem,
  Trigger,
} from "../components/ComponentType";
import { DictTable } from "../components/ComponentType";
import { getDType, Type } from "../data/types";
import * as d3 from "d3";

export function getUrls() {
  return {
    GET_SESSION_ID: `/api/get-session-id`,
    APP_CONFIG: `/api/app-config`,
    AUTH_INFO_PREFIX: `/api/.auth/`,

    EXAMPLE_DATASETS: `/api/example-datasets`,

    // these functions involves ai agents
    CHECK_AVAILABLE_MODELS: `/api/agent/check-available-models`,
    TEST_MODEL: `/api/agent/test-model`,

    DERIVE_CONCEPT_URL: `/api/agent/derive-concept-request`,
    DERIVE_PY_CONCEPT: `/api/agent/derive-py-concept`,

    SORT_DATA_URL: `/api/agent/sort-data`,
    CLEAN_DATA_URL: `/api/agent/clean-data-stream`,

    CODE_EXPL_URL: `/api/agent/code-expl`,
    SERVER_PROCESS_DATA_ON_LOAD: `/api/agent/process-data-on-load`,

    DERIVE_DATA: `/api/agent/derive-data`,
    REFINE_DATA: `/api/agent/refine-data`,
    EXPLORE_DATA_STREAMING: `/api/agent/explore-data-streaming`,

    // these functions involves database
    UPLOAD_DB_FILE: `/api/tables/upload-db-file`,
    DOWNLOAD_DB_FILE: `/api/tables/download-db-file`,
    RESET_DB_FILE: `/api/tables/reset-db-file`,

    LIST_TABLES: `/api/tables/list-tables`,
    TABLE_DATA: `/api/tables/get-table`,
    CREATE_TABLE: `/api/tables/create-table`,
    DELETE_TABLE: `/api/tables/delete-table`,
    GET_COLUMN_STATS: `/api/tables/analyze`,
    SAMPLE_TABLE: `/api/tables/sample-table`,

    DATA_LOADER_LIST_DATA_LOADERS: `/api/tables/data-loader/list-data-loaders`,
    DATA_LOADER_LIST_TABLES: `/api/tables/data-loader/list-tables`,
    DATA_LOADER_INGEST_DATA: `/api/tables/data-loader/ingest-data`,
    DATA_LOADER_VIEW_QUERY_SAMPLE: `/api/tables/data-loader/view-query-sample`,
    DATA_LOADER_INGEST_DATA_FROM_QUERY: `/api/tables/data-loader/ingest-data-from-query`,

    EXECUTE_SQL: `/api/tables/execute-sql`,

    QUERY_COMPLETION: `/api/agent/query-completion`,
    GET_RECOMMENDATION_QUESTIONS: `/api/agent/get-recommendation-questions`,
    GENERATE_REPORT_STREAM: `/api/agent/generate-report-stream`,
  };
}

import * as vm from "vm-browserify";
import { generateFreshChart } from "./dfSlice";

// Local fallback to avoid hard runtime coupling on ChannelGroups export shape.
const LOCAL_CHANNEL_GROUPS: Record<string, string[]> = {
  "": [
    "x",
    "y",
    "x2",
    "y2",
    "latitude",
    "longitude",
    "id",
    "radius",
    "theta",
    "detail",
  ],
  legends: ["color", "group", "size", "shape", "text", "opacity"],
  facets: ["column", "row"],
  "data fields": [
    "field 1",
    "field 2",
    "field 3",
    "field 4",
    "field 5",
    "field 6",
    "TARGET",
    "ARUL",
    "ARLL",
    "UL",
    "LL",
    "QCDATE",
    "QCSHIFT",
    "VALUE",
    "INDEX",
    "threshold",
  ],
};

export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}

export function runCodeOnInputListsInVM(
  code: string,
  inputTupleList: any[][],
  mode: "faster" | "safer",
): [any[], any][] {
  // inputList is a list of testInputs, each item can be an arg or a list of args (if the function takes more than one argument)
  "use strict";
  let ioPairs: [any[], any][] = inputTupleList.map((args) => [args, undefined]);
  if (mode == "safer") {
    try {
      // slightly safer?
      if (code != "") {
        let jsCode = ts.transpile(code);
        //target = eval(jsCode)(s);

        //console.log(`let func = ${code}; func(arg)`)
        let context = {
          inputTupleList: inputTupleList,
          outputs: inputTupleList.map((args) => undefined),
        };
        //console.log(`let func = ${jsCode}; let outputs = inputList.map(arg => func(arg));`);
        vm.runInNewContext(
          `let func = ${jsCode}; outputs = inputTupleList.map(args => func(...args));`,
          context,
        );
        ioPairs = inputTupleList.map((args, i) => [args, context.outputs[i]]);
        return ioPairs;
      }
    } catch (err) {
      console.warn(err);
    }
  } else if (mode == "faster") {
    try {
      if (code != "") {
        let jsCode = ts.transpile(code);
        let func = eval(jsCode);
        ioPairs = inputTupleList.map((args) => {
          let target = undefined;
          try {
            // copy args to ensure correctness of mapping
            target = func(...structuredClone(args));
          } catch (err) {
            console.warn(`execution err ${err}`);
          }
          return [args, target];
        });
        return ioPairs;
      }
    } catch (err) {
      console.warn(err);
    }
  }

  return ioPairs;
}

export function extractFieldsFromEncodingMap(
  encodingMap: EncodingMap,
  allFields: FieldItem[],
) {
  let aggregateFields: [string | undefined, string][] = [];
  let groupByFields: string[] = [];

  for (const [channel, encoding] of Object.entries(encodingMap)) {
    const field = encoding.fieldID
      ? _.find(allFields, (f) => f.id === encoding.fieldID)
      : undefined;
    if (encoding.aggregate) {
      aggregateFields.push([field?.name, encoding.aggregate]);
    } else {
      if (field) {
        groupByFields.push(field.name);
      }
    }
  }

  return { aggregateFields, groupByFields };
}

// ⚡ Maximum data points to send to Vega-Lite for rendering
// Beyond this, charts become slow / laggy. Use sampling or aggregation.
const MAX_VEGA_DATA_POINTS = 50000;

/**
 * Sanitize data rows to remove Infinity and NaN values that break Vega-Lite rendering.
 * Replaces problematic values with null to allow Vega's scale calculations to work properly.
 */
function sanitizeDataForVega(table: any[]): any[] {
  return table.map((row) => {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "number" && !isFinite(value)) {
        // Replace Infinity/NaN with null so Vega can handle it
        sanitized[key] = null;
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  });
}

/**
 * Adaptive recursive sampling: when data range has >= threshold points,
 * continue sampling sub-ranges to capture more detail and accuracy.
 * This ensures better data representation in large datasets.
 */
function adaptiveSampleBucket(
  bucket: any[],
  field: string,
  threshold: number = 10,
  pointsToTake: any[] = [],
): any[] {
  // Base case: if bucket is small, take all points
  if (bucket.length <= 3) {
    pointsToTake.push(...bucket);
    return pointsToTake;
  }

  const mid = Math.floor(bucket.length / 2);

  // Always take start, mid, end for continuity
  pointsToTake.push(bucket[0]);
  pointsToTake.push(bucket[mid]);
  pointsToTake.push(bucket[bucket.length - 1]);

  // Find extrema (max, min) in this bucket
  let maxIdx = 0,
    minIdx = 0;
  let maxVal = bucket[0][field];
  let minVal = bucket[0][field];

  for (let i = 1; i < bucket.length; i++) {
    const val = bucket[i][field];
    if (val != null && typeof val === "number" && isFinite(val)) {
      if (val > maxVal) {
        maxVal = val;
        maxIdx = i;
      }
      if (val < minVal) {
        minVal = val;
        minIdx = i;
      }
    }
  }

  // Add extrema if not already included (not at start/end/mid)
  if (maxIdx !== 0 && maxIdx !== bucket.length - 1 && maxIdx !== mid) {
    pointsToTake.push(bucket[maxIdx]);
  }
  if (minIdx !== 0 && minIdx !== bucket.length - 1 && minIdx !== mid) {
    pointsToTake.push(bucket[minIdx]);
  }

  // Recursively sample sub-ranges if they have enough data points
  const leftRange = bucket.slice(0, mid);
  const rightRange = bucket.slice(mid);

  if (leftRange.length >= threshold) {
    adaptiveSampleBucket(leftRange, field, threshold, pointsToTake);
  }
  if (rightRange.length >= threshold) {
    adaptiveSampleBucket(rightRange, field, threshold, pointsToTake);
  }

  return pointsToTake;
}

export function prepVisTable(
  table: any[],
  allFields: FieldItem[],
  encodingMap: EncodingMap,
  chartType: string = "",
) {
  // ✅ Sanitize input data to remove Infinity/NaN values before processing
  let cleanedTable = sanitizeDataForVega(table);

  let { aggregateFields, groupByFields } = extractFieldsFromEncodingMap(
    encodingMap,
    allFields,
  );

  let processedTable = [...cleanedTable];

  // ⚡ OPTIMIZATION: For large datasets without aggregation, return early to avoid expensive processing
  // ✅ Only apply stratified sampling for "QC Trend Line" charts
  if (
    aggregateFields.length === 0 &&
    processedTable.length > MAX_VEGA_DATA_POINTS &&
    chartType === "QC Trend Line"
  ) {
    // ⚡ OPTIMIZATION: Stratified sampling with peak/valley detection
    // Divide into buckets and sample multiple points per bucket to capture anomalies
    const numBuckets = Math.max(1000, MAX_VEGA_DATA_POINTS / 3); // Aim for ~3 points per bucket
    const bucketSize = Math.ceil(processedTable.length / numBuckets);
    const sampledTable: any[] = [];

    // ✅ CHECK: Detect if this is QC data by checking for QC-specific columns
    const firstRow = processedTable[0];
    const qcColumnNames = ["VALUE", "INDEX"];
    const isQCData = firstRow && qcColumnNames.every((col) => col in firstRow);

    for (let i = 0; i < numBuckets; i++) {
      const bucketStart = i * bucketSize;
      const bucketEnd = Math.min(
        bucketStart + bucketSize,
        processedTable.length,
      );

      if (bucketStart < processedTable.length) {
        const bucket = processedTable.slice(bucketStart, bucketEnd);

        // If bucket is small, take all points
        if (bucket.length <= 3) {
          sampledTable.push(...bucket);
          continue;
        }

        // ✅ Use adaptive sampling for larger buckets
        let pointsToTake: any[] = [];
        if (isQCData && "VALUE" in bucket[0]) {
          // Use VALUE field for recursive sampling in QC data
          pointsToTake = adaptiveSampleBucket(bucket, "VALUE", 10, []);
        } else {
          // For non-QC data, use simple 5-point sampling (start, mid, end, max, min)
          pointsToTake.push(bucket[0]);
          if (bucket.length > 1) {
            pointsToTake.push(bucket[Math.floor(bucket.length / 2)]);
          }
          if (bucket.length > 2) {
            pointsToTake.push(bucket[bucket.length - 1]);
          }
        }

        // Deduplicate by keeping insertion order
        const seen = new Set();
        for (const point of pointsToTake) {
          const key = JSON.stringify(point);
          if (!seen.has(key)) {
            sampledTable.push(point);
            seen.add(key);
          }
        }
      }
    }

    // ✅ Deduplicate by INDEX column for QC data (keep only first occurrence)
    let finalTable = sampledTable;
    if (isQCData && sampledTable.length > 0) {
      const seenIndices = new Set<number>();
      const deduplicatedTable: any[] = [];
      for (const row of sampledTable) {
        const index = row.INDEX;
        if (!seenIndices.has(index)) {
          seenIndices.add(index);
          deduplicatedTable.push(row);
        }
      }
      console.log(
        `[Dedup] Deduplicated by INDEX: ${sampledTable.length} → ${deduplicatedTable.length} rows`,
      );
      finalTable = deduplicatedTable;
    }

    console.log(
      `[Chart] Large time-series data (${
        processedTable.length
      } rows) → stratified${
        isQCData ? "+peak-detection (QC mode)" : ""
      } sampled to ${finalTable.length} for visualization`,
    );
    return finalTable;
  }

  let result = processedTable;

  // Stabilize large bar charts:
  // with high-cardinality ordinal x (e.g., QCDATE) and many rows, bars become sub-pixel
  // and look like "missing chart". Pre-aggregate before rendering.
  if (
    aggregateFields.length === 0 &&
    processedTable.length > 10000 &&
    chartType.toLowerCase().includes("bar")
  ) {
    const getFieldName = (channel: keyof EncodingMap): string | undefined => {
      const fieldId = encodingMap[channel]?.fieldID;
      return fieldId
        ? allFields.find((f) => f.id === fieldId)?.name
        : undefined;
    };

    const xField = getFieldName("x");
    const yField = getFieldName("y");
    const colorField = getFieldName("color");

    if (xField && yField) {
      const grouped = d3.flatGroup(
        processedTable.filter(
          (r: any) =>
            r[xField] != null &&
            typeof r[yField] === "number" &&
            isFinite(r[yField]),
        ),
        (d: any) => d[xField],
        ...(colorField ? [((d: any) => d[colorField]) as (d: any) => any] : []),
      );

      const aggregated = grouped.map((row) => {
        const keys = row.slice(0, -1);
        const groupRows = row[row.length - 1] as any[];
        const yValues = groupRows
          .map((r) => r[yField])
          .filter((v) => typeof v === "number" && isFinite(v));
        const ySum =
          yValues.length > 0
            ? yValues.reduce((a: number, b: number) => a + b, 0)
            : 0;

        const out: any = { [xField]: keys[0], [yField]: ySum };
        if (colorField) out[colorField] = keys[1];
        return out;
      });

      // Keep chart readable while preserving global trend context:
      // stratified pick across the whole aggregated range instead of tail-only slicing.
      const MAX_BAR_BUCKETS = 1500;
      if (aggregated.length <= MAX_BAR_BUCKETS) {
        return aggregated;
      }

      const step = aggregated.length / MAX_BAR_BUCKETS;
      const sampled: any[] = [];
      for (let i = 0; i < MAX_BAR_BUCKETS; i++) {
        const idx = Math.min(
          Math.floor(i * step),
          Math.max(aggregated.length - 1, 0),
        );
        sampled.push(aggregated[idx]);
      }

      // Ensure last point is represented
      sampled[sampled.length - 1] = aggregated[aggregated.length - 1];
      return sampled;
    }
  }

  if (aggregateFields.length > 0) {
    // Step 2: Group by and aggregate (with optimization for large datasets)
    let grouped = [];

    if (groupByFields.length > 0) {
      grouped = d3.flatGroup(
        processedTable,
        ...groupByFields.map((field) => (d: any) => d[field]),
      );
    } else {
      grouped = [["_default", processedTable]];
    }

    // ⚡ OPTIMIZATION: If too many groups, stratified sampling to preserve distribution
    if (grouped.length > MAX_VEGA_DATA_POINTS) {
      const numBuckets = MAX_VEGA_DATA_POINTS;
      const bucketSize = Math.ceil(grouped.length / numBuckets);
      const subsampledGroups: any[] = [];

      for (let i = 0; i < numBuckets; i++) {
        const bucketStart = i * bucketSize;
        const bucketEnd = Math.min(bucketStart + bucketSize, grouped.length);

        if (bucketStart < grouped.length) {
          const midIndex = Math.floor((bucketStart + bucketEnd) / 2);
          subsampledGroups.push(grouped[midIndex]);
        }
      }

      grouped = subsampledGroups;
      console.log(
        `[Chart] Large aggregation (${grouped.length} groups) → stratified sampled for visualization`,
      );
    }

    result = grouped.map((row) => {
      const groupValues = row.slice(0, -1);
      const group = row[row.length - 1];

      const aggregatedRow: any = {
        // Add group by fields
        ...Object.fromEntries(
          groupByFields.map((field, i) => [field, groupValues[i]]),
        ),
      };

      // ⚡ OPTIMIZATION: Compute all aggregations in single pass
      if (aggregateFields.some(([_, type]) => type === "count")) {
        aggregatedRow._count = group.length;
      }

      // Batch compute aggregations
      const nonCountAggs = aggregateFields.filter(
        ([fieldName, aggType]) => aggType !== "count" && fieldName,
      );

      for (const [fieldName, aggType] of nonCountAggs) {
        if (!fieldName) continue;
        const values = group.map((r: any) => r[fieldName]);
        const suffix = `_${aggType}`;

        // ⚡ Use simpler aggregations for large groups to avoid d3 overhead
        let result: any;
        if (aggType === "sum") {
          result = values.reduce(
            (a: number, b: number) => (a || 0) + (b || 0),
            0,
          );
        } else if (aggType === "count") {
          result = values.length;
        } else if (aggType === "mean" || aggType === "average") {
          const sum = values.reduce(
            (a: number, b: number) => (a || 0) + (b || 0),
            0,
          );
          result =
            values.filter((v: any) => v != null).length > 0
              ? sum / values.filter((v: any) => v != null).length
              : undefined;
        } else if (aggType === "min") {
          result = Math.min(...values.filter((v: any) => v != null));
        } else if (aggType === "max") {
          result = Math.max(...values.filter((v: any) => v != null));
        } else {
          // Fallback to d3 for complex aggregations (median, mode)
          const aggFunc = {
            median: d3.median,
            mode: d3.mode,
          }[aggType] as (values: any[]) => number | undefined;
          result = aggFunc ? aggFunc(values) : undefined;
        }

        aggregatedRow[fieldName + suffix] = result;
      }

      return aggregatedRow;
    });
  }

  return result;
}

export const assembleVegaChart = (
  chartType: string,
  encodingMap: { [key in Channel]: EncodingItem },
  conceptShelfItems: FieldItem[],
  workingTable: any[],
  tableMetadata: {
    [key: string]: { type: Type; semanticType: string; levels: any[] };
  },
  maxFacetNominalValues: number = 30,
  aggrPreprocessed: boolean = false, // whether the data has been preprocessed for aggregation and binning
  defaultChartWidth: number = 800,
  defaultChartHeight: number = 400,
  addTooltips: boolean = false,
  qcLimitsMode?: boolean,
  chartWidth?: number,
  chartHeight?: number,
) => {
  if (chartType == "Table") {
    return ["Table", undefined];
  }

  // ✅ Sanitize input data to remove Infinity/NaN values before processing
  const cleanedTable = sanitizeDataForVega(workingTable);
  let chartTemplate = getChartTemplate(chartType) as ChartTemplate;
  //console.log(chartTemplate);

  // Handle undefined chart template - return Table as fallback
  if (!chartTemplate || !chartTemplate.template) {
    console.warn(
      `Chart template not found for chart type: ${chartType}. Falling back to Table.`,
    );
    return ["Table", undefined];
  }

  let vgObj = structuredClone(chartTemplate.template);

  for (const [channel, encoding] of Object.entries(encodingMap)) {
    let encodingObj: any = {};

    if (channel == "radius") {
      encodingObj["scale"] = { type: "sqrt", zero: true };
    }

    const field = encoding.fieldID
      ? _.find(conceptShelfItems, (f) => f.id === encoding.fieldID)
      : undefined;
    if (
      field == undefined &&
      encoding.aggregate == "count" &&
      aggrPreprocessed
    ) {
      encodingObj["field"] = "_count";
      encodingObj["title"] = "Count";
      encodingObj["type"] = "quantitative";
    }

    if (field) {
      // create the encoding
      encodingObj["field"] = field.name;
      let fieldMetadata = tableMetadata[field.name];

      if (fieldMetadata != undefined) {
        encodingObj["type"] = getDType(
          fieldMetadata.type,
          cleanedTable.map((r) => r[field.name]),
        );
        if (
          fieldMetadata.semanticType == "Date" ||
          fieldMetadata.semanticType == "DateTime" ||
          fieldMetadata.semanticType == "YearMonth" ||
          fieldMetadata.semanticType == "Year" ||
          fieldMetadata.semanticType == "Decade"
        ) {
          if (["color", "size", "column", "row"].includes(channel)) {
            encodingObj["type"] = "nominal";
          } else if (
            fieldMetadata.type == "string" &&
            (fieldMetadata.semanticType == "Decade" ||
              fieldMetadata.semanticType == "Year")
          ) {
            encodingObj["type"] = "nominal";
          } else if (fieldMetadata.semanticType == "YearMonth") {
            let sampleValues = cleanedTable
              .map((r) => r[field.name])
              .slice(0, 10);
            // Check if values can be parsed as valid temporal dates (Vega-Lite compatible)
            // Temporal: yyyy-mm, yyyy-mm-dd, ISO date formats
            // Nominal: 2021-Aug, Q1-2024, etc.
            let isValidTemporal = sampleValues.some((val) => {
              if (val && typeof val === "string") {
                const trimmed = val.trim();
                // Try to parse as date
                const date = new Date(trimmed);
                // Check if it's a valid date and follows ISO-like format
                // (no letters except 'T' for datetime separator, 'Z' for timezone)
                const isISOLike = /^[\d\-:.TZ+]+$/.test(trimmed);
                return !isNaN(date.getTime()) && isISOLike;
              }
              return false;
            });
            encodingObj["type"] = isValidTemporal ? "temporal" : "nominal";
          } else {
            encodingObj["type"] = "temporal";
          }
        }
      } else {
        encodingObj["type"] = "nominal";
      }

      if (encoding.dtype) {
        // if the dtype is specified, use it
        encodingObj["type"] = encoding.dtype;
      } else if (channel == "column" || channel == "row") {
        // if the column or row channel and no dtype is specified, use nominal
        encodingObj["type"] = "nominal";
      } else if (
        chartType == "Grouped Bar Chart" &&
        (channel == "color" || channel == "x")
      ) {
        // if the chart type is grouped bar chart and the channel is color or x, use nominal
        encodingObj["type"] = "nominal";
      }

      if (aggrPreprocessed) {
        if (encoding.aggregate) {
          if (encoding.aggregate == "count") {
            encodingObj["field"] = "_count";
            encodingObj["title"] = "Count";
            encodingObj["type"] = "quantitative";
          } else {
            encodingObj["field"] = `${field.name || ""}_${encoding.aggregate}`;
            encodingObj["type"] = "quantitative";
          }
        }
      } else {
        if (encoding.aggregate) {
          encodingObj["aggregate"] = encoding.aggregate;
          if (encodingObj["aggregate"] == "count") {
            encodingObj["title"] = "Count";
          }
        }
      }

      if (
        encodingObj["type"] == "quantitative" &&
        chartType.includes("Line") &&
        channel == "x"
      ) {
        encodingObj["scale"] = { nice: false };
      }

      if (encodingObj["type"] == "nominal" && channel == "color") {
        let actualDomain = [...new Set(cleanedTable.map((r) => r[field.name]))];

        if (actualDomain.length >= 16) {
          if (encodingObj["legend"] == undefined) {
            encodingObj["legend"] = {};
          }
          encodingObj["legend"]["symbolSize"] = 12;
          encodingObj["legend"]["labelFontSize"] = 8;
        }
      }
    }

    if (encoding.sortBy || encoding.sortOrder) {
      if (encoding.sortBy == undefined) {
        if (encoding.sortOrder) {
          encodingObj["sort"] = encoding.sortOrder;
        }
      } else if (encoding.sortBy == "x" || encoding.sortBy == "y") {
        if (encoding.sortBy == channel) {
          encodingObj["sort"] = `${
            encoding.sortOrder == "descending" ? "-" : ""
          }${encoding.sortBy}`;
        } else {
          encodingObj["sort"] = `${
            encoding.sortOrder == "ascending" ? "" : "-"
          }${encoding.sortBy}`;
        }
      } else if (encoding.sortBy == "color") {
        if (encodingMap.color?.fieldID != undefined) {
          encodingObj["sort"] = `${
            encoding.sortOrder == "ascending" ? "" : "-"
          }${encoding.sortBy}`;
        }
      } else {
        try {
          if (field) {
            let fieldMetadata = tableMetadata[field.name];
            let sortedValues = JSON.parse(encoding.sortBy);

            // this is to coordinate with the type conversion of temporal fields
            if (
              fieldMetadata.type == "date" ||
              fieldMetadata.semanticType == "Year" ||
              fieldMetadata.semanticType == "Decade"
            ) {
              sortedValues = sortedValues.map((v: any) => v.toString());
            }

            encodingObj["sort"] =
              encoding.sortOrder == "ascending" ||
              encoding.sortOrder == undefined
                ? sortedValues
                : sortedValues.reverse();

            // special hack: ensure stack bar and stacked area charts are ordered correctly
            if (
              channel == "color" &&
              (vgObj["mark"] == "bar" || vgObj["mark"] == "area")
            ) {
              // this is a very interesting hack, it leverages the hidden derived field name used in compiled Vega script to
              // handle order of stack bar and stacked area charts
              vgObj["encoding"]["order"] = {
                field: `color_${field?.name}_sort_index`,
              };
            }
          }
        } catch (err) {
          console.warn(`sort error > ${encoding.sortBy}`);
        }
      }

      // if (encoding.sort == "ascending" || encoding.sort == "descending"
      //     || encoding.sort == "x" || encoding.sort == "y" || encoding.sort == "-x" || encoding.sort == "-y") {
      //     encodingObj["sort"] = encoding.sort;
      // } else {
      //     encodingObj["sort"] = JSON.parse(encoding.sort);
      // }
    } else {
      // Auto-sort: when nominal axis has quantitative opposite axis or color field and no explicit sorting is set
      // prioritize color field if present, otherwise sort by quantitative axis descending
      if (
        (channel === "x" &&
          encodingObj.type === "nominal" &&
          encodingMap.y?.fieldID) ||
        (channel === "y" &&
          encodingObj.type === "nominal" &&
          encodingMap.x?.fieldID)
      ) {
        if (chartType.includes("Line") || chartType.includes("Area")) {
          // do nothing
        } else {
          let colorField = encodingMap.color?.fieldID
            ? _.find(
                conceptShelfItems,
                (f) => f.id === encodingMap.color.fieldID,
              )
            : undefined;
          let colorFieldType = undefined;
          if (colorField) {
            const colorFieldMetadata = tableMetadata[colorField.name];
            if (colorFieldMetadata) {
              colorFieldType = getDType(
                colorFieldMetadata.type,
                cleanedTable.map((r) => r[colorField.name]),
              );
            }
          }

          if (colorField && colorFieldType == "quantitative") {
            // If color field exists, sort by color (ascending for nominal, descending for quantitative)
            encodingObj["sort"] =
              colorFieldType === "quantitative" ? "-color" : "color";
          } else {
            // Otherwise, sort by the quantitative axis descending
            const oppositeChannel = channel === "x" ? "y" : "x";
            const oppositeField = _.find(
              conceptShelfItems,
              (f) => f.id === encodingMap[oppositeChannel]?.fieldID,
            );
            if (oppositeField) {
              const oppositeFieldMetadata = tableMetadata[oppositeField.name];
              if (
                oppositeFieldMetadata &&
                getDType(
                  oppositeFieldMetadata.type,
                  cleanedTable.map((r) => r[oppositeField.name]),
                ) === "quantitative"
              ) {
                encodingObj["sort"] = `-${oppositeChannel}`;
              }
            }
          }
        }
      }
    }
    if (encoding.stack) {
      encodingObj["stack"] =
        encoding.stack == "layered" ? null : encoding.stack;
    }

    if (channel == "color") {
      if (encoding.scheme && encoding.scheme != "default") {
        if ("scale" in encodingObj) {
          encodingObj["scale"]["scheme"] = encoding.scheme;
        } else {
          encodingObj["scale"] = { scheme: encoding.scheme };
        }
      } else {
        if (field) {
          let fieldMetadata = tableMetadata[field.name];
          if (
            fieldMetadata &&
            ["Duration", "Range", "Percentage"].includes(
              fieldMetadata.semanticType,
            ) &&
            encodingObj.type == "nominal"
          ) {
            let candidateSchemes = [
              "oranges",
              "reds",
              "blueorange",
              "bluepurple",
            ];
            if (!("scale" in encodingObj)) {
              encodingObj["scale"] = {};
            }
            encodingObj["scale"]["scheme"] =
              candidateSchemes[
                Math.abs(hashCode(field.name) % candidateSchemes.length)
              ];
          }
        }
      }
    }

    if (Object.keys(encodingObj).length != 0 && chartTemplate.paths[channel]) {
      let pathObj = chartTemplate.paths[channel];
      let paths: (string | number)[][] = [];
      if (pathObj.length > 0 && pathObj[0].constructor === Array) {
        // in this case, there are many destinations, we add the encodingObj to all paths
        paths = pathObj as (string | number)[][];
      } else {
        // in this case, there is only one single destination, we will wrap it with [..]
        paths = [pathObj as (string | number)[]];
      }
      // fill the template with encoding objects
      for (let path of paths) {
        let ref = vgObj;
        for (let key of path.slice(0, path.length - 1)) {
          ref = ref[key];
        }

        // if the template hold is a string, then we only instantiate a string value
        // if the template hold is a dict, then we embed the actual embeding object
        if (
          typeof ref[path[path.length - 1]] === "string" ||
          ref[path[path.length - 1]] instanceof String
        ) {
          ref[path[path.length - 1]] = encodingObj["field"];
        } else {
          let prebuiltEntries =
            ref[path[path.length - 1]] != undefined
              ? Object.entries(ref[path[path.length - 1]])
              : [];
          ref[path[path.length - 1]] = Object.fromEntries([
            ...prebuiltEntries,
            ...Object.entries(encodingObj),
          ]);
        }
      }
    }
  }

  // use post processor to handle smart chart instantiation
  if (chartTemplate.postProcessor) {
    vgObj = chartTemplate.postProcessor(
      vgObj,
      cleanedTable,
      qcLimitsMode,
      chartWidth || defaultChartWidth,
      chartHeight || defaultChartHeight,
    );
  }

  // this is the data that will be assembled into the vega chart
  let values = structuredClone(cleanedTable);
  if (values.length > 0) {
    let keys = Object.keys(values[0]);
    let temporalKeys = keys.filter(
      (k: string) =>
        tableMetadata[k] &&
        (tableMetadata[k].type == "date" ||
          tableMetadata[k].semanticType == "Year" ||
          tableMetadata[k].semanticType == "Decade"),
    );
    if (temporalKeys.length > 0) {
      values = values.map((r: any) => {
        for (let temporalKey of temporalKeys) {
          r[temporalKey] = String(r[temporalKey]);
        }
        return r;
      });
    }
  }

  let nominalCount = {
    x: 0,
    y: 0,
    column: 0,
    row: 0,
    xOffset: 0,
  };

  // by default, we allow strech width twice and fit as many bars as possible with minStepSize
  let defaultStepSize = 20;
  let maxXYToKeep = Math.min((defaultChartWidth * 2) / defaultStepSize, 48);

  // Decide what are top values to keep for each channel
  for (const channel of ["x", "y", "column", "row", "xOffset", "color"]) {
    const encoding = vgObj.encoding?.[channel];
    if (encoding?.type === "nominal") {
      let maxNominalValuesToKeep =
        channel == "x" || channel == "y" ? maxXYToKeep : maxFacetNominalValues;

      const fieldName = encoding.field;
      const uniqueValues = [...new Set(values.map((r: any) => r[fieldName]))];

      // count the nominal values in this channel
      nominalCount[channel as keyof typeof nominalCount] =
        uniqueValues.length > maxNominalValuesToKeep
          ? maxNominalValuesToKeep
          : uniqueValues.length;

      let fieldMetadata = tableMetadata[fieldName];

      const fieldOriginalType = fieldMetadata
        ? getDType(
            fieldMetadata.type,
            cleanedTable.map((r) => r[fieldName]),
          )
        : "nominal";

      let valuesToKeep: any[];
      if (uniqueValues.length > maxNominalValuesToKeep) {
        if (fieldOriginalType == "quantitative" || channel == "color") {
          valuesToKeep = uniqueValues /*.sort((a, b) => a - b)*/
            .slice(0, channel == "color" ? 24 : maxNominalValuesToKeep);
        } else if (
          channel == "facet" ||
          channel == "column" ||
          channel == "row"
        ) {
          valuesToKeep = uniqueValues.slice(0, maxNominalValuesToKeep);
        } else if (channel == "x" || channel == "y") {
          const oppositeChannel = channel === "x" ? "y" : "x";
          const oppositeEncoding = vgObj.encoding?.[oppositeChannel];
          const colorEncoding = vgObj.encoding?.color;

          let isDescending = true;
          let sortChannel: string | undefined;
          let sortField: string | undefined;
          let sortFieldType: string | undefined;

          // Check if this axis already has a sort configuration
          if (encoding.sort) {
            if (
              typeof encoding.sort === "string" &&
              (encoding.sort === "descending" || encoding.sort === "ascending")
            ) {
              isDescending = encoding.sort === "descending";
              sortChannel = oppositeChannel;
              sortField = oppositeEncoding?.field;
              sortFieldType = oppositeEncoding?.type;
            } else if (
              typeof encoding.sort === "string" &&
              (encoding.sort === "-y" ||
                encoding.sort === "-x" ||
                encoding.sort === "-color" ||
                encoding.sort === "y" ||
                encoding.sort === "x" ||
                encoding.sort === "color")
            ) {
              isDescending = encoding.sort.startsWith("-");
              sortChannel = isDescending
                ? encoding.sort.substring(1)
                : encoding.sort;
              if (sortChannel) {
                sortField = vgObj.encoding?.[sortChannel]?.field;
                sortFieldType = vgObj.encoding?.[sortChannel]?.type;
              }
            }
          } else {
            // No explicit sort configuration, use the existing inference logic
            // Check if color field exists and is quantitative
            if (colorEncoding?.field && colorEncoding.type === "quantitative") {
              // Sort by color field descending and take top maxNominalValues
              sortChannel = "color";
              sortField = colorEncoding.field;
              sortFieldType = colorEncoding.type;
            } else if (oppositeEncoding?.type === "quantitative") {
              // Sort by the quantitative field and take top maxNominalValues
              sortChannel = oppositeChannel;
              sortField = oppositeEncoding.field;
              sortFieldType = oppositeEncoding.type;
            } else {
              isDescending = false;
            }
          }

          if (
            !["Line Chart", "Custom Area Chart"].includes(chartType) &&
            sortField != undefined &&
            sortChannel != undefined &&
            sortFieldType === "quantitative"
          ) {
            let aggregateOp = Math.max;
            let initialValue = -Infinity;

            if (chartType == "Bar" && sortChannel != "color") {
              // bar chart by default will be stacked, so we need to sum the values
              aggregateOp = (x: number, y: number) => x + y;
              initialValue = 0;
            }

            // Efficient single-pass aggregation + partial sort
            const valueAggregates = new Map<string, number>();

            // Single pass through cleanedTable to compute aggregates
            for (const row of cleanedTable) {
              const fieldValue = row[fieldName];
              const sortValue = row[sortField as keyof typeof row] || 0;

              if (valueAggregates.has(fieldValue)) {
                valueAggregates.set(
                  fieldValue,
                  aggregateOp(valueAggregates.get(fieldValue)!, sortValue),
                );
              } else {
                valueAggregates.set(
                  fieldValue,
                  aggregateOp(initialValue, sortValue),
                );
              }
            }

            // Convert to array and get top-K efficiently
            const valueSortPairs = Array.from(valueAggregates.entries()).map(
              ([value, sortValue]) => ({
                value,
                sortValue,
              }),
            );

            // Use efficient top-K selection
            if (valueSortPairs.length <= maxNominalValuesToKeep) {
              valuesToKeep = valueSortPairs
                .sort((a, b) =>
                  isDescending
                    ? b.sortValue - a.sortValue
                    : a.sortValue - b.sortValue,
                )
                .map((v) => v.value);
            } else {
              // For large datasets, use partial sort (more efficient than full sort)
              const compareFn = (
                a: { value: string; sortValue: number },
                b: { value: string; sortValue: number },
              ) =>
                isDescending
                  ? b.sortValue - a.sortValue
                  : a.sortValue - b.sortValue;

              // Sort only the top K elements
              valuesToKeep = valueSortPairs
                .sort(compareFn)
                .slice(0, maxNominalValuesToKeep)
                .map((v) => v.value);
            }
          } else {
            // If sort field is not available or not quantitative, fall back to default
            if (
              (typeof encoding.sort === "string" &&
                encoding.sort === "descending") ||
              encoding.sort === `-${channel}`
            ) {
              valuesToKeep = uniqueValues
                .reverse()
                .slice(0, maxNominalValuesToKeep);
            } else {
              valuesToKeep = uniqueValues.slice(0, maxNominalValuesToKeep);
            }
          }
        } else {
          valuesToKeep = uniqueValues.slice(0, maxNominalValuesToKeep);
        }

        // Filter the working table
        const omittedCount = uniqueValues.length - valuesToKeep.length;
        const placeholder = `...${omittedCount} items omitted`;
        if (channel != "color") {
          values = values.filter((row: any) =>
            valuesToKeep.includes(row[fieldName]),
          );
        }

        // Add text formatting configuration
        if (!encoding.axis) {
          encoding.axis = {};
        }
        encoding.axis.labelColor = {
          condition: {
            test: `datum.label == '${placeholder}'`,
            value: "#999999",
          },
          value: "#000000", // default color for other labels
        };

        // Add placeholder to domain
        if (channel == "x" || channel == "y") {
          if (!encoding.scale) {
            encoding.scale = {};
          }
          encoding.scale.domain = [...valuesToKeep, placeholder];
        } else if (channel == "color") {
          if (!encoding.legend) {
            encoding.legend = {};
          }
          encoding.legend.values = [...valuesToKeep, placeholder];
        }
      }
    }
  }

  if (vgObj.encoding?.column != undefined && vgObj.encoding?.row == undefined) {
    vgObj["encoding"]["facet"] = vgObj["encoding"]["column"];

    let expectedXNominalCount = nominalCount.x;
    if (nominalCount.xOffset > 0) {
      expectedXNominalCount = nominalCount.x * nominalCount.xOffset;
    }

    vgObj["encoding"]["facet"]["columns"] = 6;
    if (expectedXNominalCount > 40) {
      vgObj["encoding"]["facet"]["columns"] = 1;
    } else if (expectedXNominalCount > 20) {
      vgObj["encoding"]["facet"]["columns"] = 3;
    }

    if (
      Math.floor(nominalCount.column / vgObj["encoding"]["facet"]["columns"]) >=
      3
    ) {
      vgObj["resolve"] = {
        axis: {
          x: "independent",
        },
      };
    }

    delete vgObj["encoding"]["column"];
  }

  // total facets is the product of the number of columns and rows
  let totalFacets = nominalCount.column > 0 ? nominalCount.column : 1;
  totalFacets *= nominalCount.row > 0 ? nominalCount.row : 1;
  totalFacets *=
    nominalCount.xOffset > 0
      ? Math.min(nominalCount.xOffset, nominalCount.x)
      : 1;

  let facetRescaleFactor = 1;
  if (totalFacets > 6) {
    facetRescaleFactor = 0.4;
  } else if (totalFacets > 4) {
    facetRescaleFactor = 0.5;
  } else if (totalFacets > 1) {
    facetRescaleFactor = 0.75;
  }

  for (const channel of ["facet", "column", "row"]) {
    const encoding = vgObj.encoding?.[channel];
    if (encoding?.type === "quantitative") {
      const fieldName = encoding.field;
      const uniqueValues = [...new Set(values.map((r: any) => r[fieldName]))];
      if (uniqueValues.length > maxFacetNominalValues) {
        encoding.bin = true;
      }
    }
  }

  let xTotalNominalCount = nominalCount.x;
  if (nominalCount.xOffset > 0) {
    xTotalNominalCount = nominalCount.x * nominalCount.xOffset;
  }
  let yTotalNominalCount = nominalCount.y;

  // Check if y-axis should have independent scaling when columns have vastly different value ranges
  if (
    vgObj.encoding?.facet != undefined &&
    vgObj.encoding?.y?.type === "quantitative"
  ) {
    const yField = vgObj.encoding.y.field;
    const columnField = vgObj.encoding.facet.field;

    if (yField && columnField) {
      // Group data by column values and find max y value for each column
      const columnGroups = new Map<any, number>();

      for (const row of cleanedTable) {
        const columnValue = row[columnField];
        const yValue = row[yField];

        if (yValue != null && !isNaN(yValue)) {
          const currentMax = columnGroups.get(columnValue) || 0;
          columnGroups.set(columnValue, Math.max(currentMax, Math.abs(yValue)));
        }
      }

      // Find the ratio between max and min column max values
      const maxValues = Array.from(columnGroups.values()).filter((v) => v > 0);
      if (maxValues.length >= 2) {
        const maxValue = Math.max(...maxValues);
        const minValue = Math.min(...maxValues);
        const ratio = maxValue / minValue;

        // If difference is 100x or more, use independent y-axis scaling
        if (ratio >= 100 && totalFacets < 6) {
          if (!vgObj.resolve) {
            vgObj.resolve = {};
          }
          if (!vgObj.resolve.scale) {
            vgObj.resolve.scale = {};
          }
          vgObj.resolve.scale.y = "independent";
        }
      }
    }
  }

  // Apply 0.75 scale factor for faceted charts
  const widthScale = facetRescaleFactor;
  const heightScale = facetRescaleFactor;

  let stepSize = Math.max(
    8,
    Math.min(
      defaultStepSize,
      Math.floor(
        (facetRescaleFactor * defaultChartHeight * 2) /
          Math.max(xTotalNominalCount, yTotalNominalCount),
      ),
    ),
  );

  vgObj["config"] = {
    view: {
      continuousWidth: defaultChartWidth * widthScale,
      continuousHeight: defaultChartHeight * heightScale,
      step: stepSize,
    },
    axisX: { labelLimit: 100, labelFontSize: stepSize <= 10 ? stepSize : 10 },
    axisY: { labelFontSize: stepSize <= 10 ? stepSize : 10 },
  };
  if (totalFacets > 6) {
    vgObj["config"]["header"] = { labelLimit: 120, labelFontSize: 9 };
  }

  if (addTooltips) {
    // Only add top-level mark tooltip for unit specs (not hconcat/vconcat/concat/layer)
    // Composite specs do not have a top-level mark; adding one would make the spec invalid
    const isCompositeSpec =
      vgObj.hconcat != null ||
      vgObj.vconcat != null ||
      vgObj.concat != null ||
      vgObj.layer != null;

    if (!isCompositeSpec) {
      // Add tooltip configuration to the mark
      if (!vgObj.mark) {
        vgObj.mark = {};
      }
      if (typeof vgObj.mark === "string") {
        vgObj.mark = { type: vgObj.mark };
      }
      // Add tooltip to the mark
      vgObj.mark.tooltip = true;
    }
  }

  if (vgObj.encoding) {
    if (vgObj.encoding.x && vgObj.encoding.x.type === "quantitative") {
      vgObj.encoding.x = {
        ...vgObj.encoding.x,
        scale: { ...(vgObj.encoding.x.scale || {}), zero: false },
      };
    }
    if (vgObj.encoding.y && vgObj.encoding.y.type === "quantitative") {
      vgObj.encoding.y = {
        ...vgObj.encoding.y,
        scale: { ...(vgObj.encoding.y.scale || {}), zero: false },
      };
    }
  }

  // Ensure explicit width/height so Vega-Lite doesn't fall back to its 300px default.
  // postProcessors that already set vgObj.width/height explicitly are not overridden here.
  if (vgObj.width === undefined) {
    vgObj.width = chartWidth || defaultChartWidth;
  }
  if (vgObj.height === undefined) {
    vgObj.height = chartHeight || defaultChartHeight;
  }

  return { ...vgObj, data: { values: values } };
};

export const adaptChart = (chart: Chart, targetTemplate: ChartTemplate) => {
  let discardedChannels = Object.entries(chart.encodingMap).filter(
    ([ch, enc]) => {
      return !targetTemplate.channels.includes(ch) && enc.fieldID != undefined;
    },
  );

  let newEncodingMap = Object.assign(
    {},
    ...targetTemplate.channels.map((channel) => {
      let encoding = Object.keys(chart.encodingMap).includes(channel)
        ? chart.encodingMap[channel as Channel]
        : { channel: channel, bin: false };
      return { [channel]: encoding };
    }),
  ) as EncodingMap;

  // for channels that will be discarded, find another way to adapt it
  for (let [ch, enc] of discardedChannels) {
    let otherChannelsFromSameGroup = (
      Object.entries(LOCAL_CHANNEL_GROUPS).find(([grp, channelList]) =>
        channelList.includes(ch),
      ) as [string, string[]]
    )[1];
    let candChannels = targetTemplate.channels.filter(
      (c) =>
        otherChannelsFromSameGroup.includes(c) &&
        newEncodingMap[c as Channel].fieldID == undefined,
    );
    if (candChannels.length > 0) {
      newEncodingMap[candChannels[0] as Channel] = enc;
    }
  }

  return {
    ...chart,
    chartType: targetTemplate.chart,
    encodingMap: newEncodingMap,
  };
};

export const resolveRecommendedChart = (
  refinedGoal: any,
  allFields: FieldItem[],
  table: DictTable,
) => {
  let rawChartType = refinedGoal["chart_type"];
  let chartEncodings = refinedGoal["chart_encodings"];

  if (chartEncodings == undefined || rawChartType == undefined) {
    let newChart = generateFreshChart(table.id, "Scatter Plot") as Chart;
    let basicEncodings: { [key: string]: string } =
      table.names.length > 1 ? { x: table.names[0], y: table.names[1] } : {};
    newChart = resolveChartFields(newChart, allFields, basicEncodings, table);
    return newChart;
  }

  let chartTypeMap: any = {
    line: "Line Chart",
    histogram: "Histogram",
    bar: "Bar Chart",
    stacked_bar: "Stacked Bar Chart",
    grouped_bar: "Grouped Bar Chart",
    group_bar: "Grouped Bar Chart",
    point: "Scatter Plot",
    boxplot: "Boxplot",
    qc_trend_line: "QC Trend Line",
    qc_histogram: "QC Histogram",
    qc_trend_bar: "QC Trend Bar",
    waterfall: "Waterfall",
    heatmap: "Heat Map",
    radar: "Radar Chart",
    pie: "Pie Chart",
    donut: "Donut Chart",
    area: "Area Chart",
    bubble: "Bubble Plot",
    pareto: "Pareto Chart",
    gauge: "Gauge Chart",
    funnel: "Funnel Chart",
    treemap: "Tree Map",
    sankey: "Sankey Diagram",
    timeline: "Timeline Chart",
    rolling_average: "Rolling Average",
    radial_plot: "Radial Plot",
  };
  let chartType = chartTypeMap[rawChartType] || "Scatter Plot";
  let newChart = generateFreshChart(table.id, chartType) as Chart;
  newChart = resolveChartFields(newChart, allFields, chartEncodings, table);
  if (rawChartType == "histogram") {
    newChart.encodingMap.y = { aggregate: "count" };
  }

  // Force INDEX → x-axis: if the table has an INDEX column AND the chart
  // supports an x channel, always use INDEX for x (overrides AI suggestion).
  const indexFieldName = table.names?.find((n) => n.toUpperCase() === "INDEX");
  if (indexFieldName && "x" in newChart.encodingMap) {
    const indexField = allFields.find((f) => f.name?.toUpperCase() === "INDEX");
    if (indexField) {
      newChart.encodingMap.x = { fieldID: indexField.id };
    }
  }

  return newChart;
};

export const resolveChartFields = (
  chart: Chart,
  allFields: FieldItem[],
  chartEncodings: { [key: string]: string },
  table: DictTable,
) => {
  const allowedChannels = new Set(Object.keys(chart.encodingMap));

  // Get the keys that should be present after this update
  const newEncodingKeys = new Set(
    Object.keys(chartEncodings)
      .map((key) => (key === "facet" ? "column" : key))
      .filter((key) => allowedChannels.has(key)),
  );

  // Remove encodings that are no longer in chartEncodings
  for (const key of Object.keys(chart.encodingMap)) {
    if (
      !newEncodingKeys.has(key) &&
      chart.encodingMap[key as Channel]?.fieldID != undefined
    ) {
      chart.encodingMap[key as Channel] = {};
    }
  }

  // Add/update encodings from chartEncodings
  for (let [key, value] of Object.entries(chartEncodings)) {
    if (key == "facet") {
      key = "column";
    }
    if (!allowedChannels.has(key)) {
      continue;
    }

    let field = allFields.find((c) => c.name === value);
    if (field) {
      chart.encodingMap[key as Channel] = { fieldID: field.id };
    }
  }

  return chart;
};

export let getTriggers = (leafTable: DictTable, tables: DictTable[]) => {
  // recursively find triggers that ends in leafTable (if the leaf table is anchored, we will find till the previous table is anchored)
  let triggers: Trigger[] = [];
  let t = leafTable;

  while (true) {
    // this is when we find an original table
    if (t.derive == undefined) {
      break;
    }

    // this is when we find an anchored table (which is not the leaf table)
    if (t !== leafTable && t.anchored) {
      break;
    }

    let trigger = t.derive.trigger as Trigger;
    triggers = [trigger, ...triggers];
    let parentTable = tables.find((x) => x.id == trigger.tableId);
    if (parentTable) {
      t = parentTable;
    } else {
      break;
    }
  }

  return triggers;
};

/**
 * Returns a hash code from a string
 * @param  {String} str The string to hash.
 * @return {Number}    A 32bit integer
 * @see http://werxltd.com/wp/2010/05/13/javascript-implementation-of-javas-string-hashcode-method/
 */
export function hashCode(str: string) {
  let hash = 0;
  for (let i = 0, len = str.length; i < len; i++) {
    let chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
}
