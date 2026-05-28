// Shared utilities for generating chart preview images (used by ReportView + DataFormulator).
import embed from "vega-embed";
import { assembleVegaChart, prepVisTable } from "../app/utils";

export interface ChartPreviewResult {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Render a chart spec to a PNG dataUrl using Vega-Lite canvas renderer.
 * Canvas renderer is ~2-3x faster than SVG renderer and skips the
 * expensive SVG → Image → Canvas → PNG pipeline.
 */
export async function generateChartPreview(
  chart: any,
  chartTable: any,
  conceptShelfItems: any[],
  chartWidth: number,
  chartHeight: number,
  sampleData?: any[],
): Promise<ChartPreviewResult> {
  const dataToUse = sampleData || chartTable.rows;
  const processedRows = sampleData
    ? sampleData
    : prepVisTable(dataToUse, conceptShelfItems, chart.encodingMap);

  const spec = assembleVegaChart(
    chart.chartType,
    chart.encodingMap,
    conceptShelfItems,
    processedRows,
    chartTable.metadata,
    24,
    true,
    chart.chartWidth || chartWidth,
    chart.chartHeight || chartHeight,
    true,
    chart.qcLimitsMode || false,
    undefined,
    undefined,
  );

  const tempId = `chart-preview-${chart.id}-${Date.now()}`;
  const tempDiv = document.createElement("div");
  tempDiv.id = tempId;
  tempDiv.style.cssText = "position:absolute;left:-9999px;visibility:hidden;";
  document.body.appendChild(tempDiv);

  try {
    const result = await embed(`#${tempId}`, spec, {
      actions: false,
      renderer: "canvas",
    });
    // toCanvas() returns the rendered HTMLCanvasElement directly — no SVG export needed
    const canvas = await result.view.toCanvas(1);
    result.view.finalize();
    return {
      dataUrl: canvas.toDataURL("image/png"),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    if (document.body.contains(tempDiv)) {
      document.body.removeChild(tempDiv);
    }
  }
}

/**
 * Yield control back to the browser.
 * Uses requestIdleCallback when available so rendering only starts during
 * genuine idle time (no user interaction), falling back to setTimeout(0).
 */
export function yieldToIdle(timeoutMs = 500): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(() => resolve(), { timeout: timeoutMs });
    } else {
      setTimeout(resolve, 0);
    }
  });
}
