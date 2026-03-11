// /**
//  * QC Trend Chart Server API Client
//  * Gọi backend để xử lý logic nặng
//  */

// interface QCTrendMetadata {
//   yDomain: [number, number];
//   shiftMarkers: Array<{
//     date: string | number;
//     shift: string;
//     index: number;
//   }>;
//   detectedLimits: Record<string, number>;
//   processingTimeMs: number;
//   rowCount: number;
// }

// /**
//  * Fetch QC Trend metadata từ server
//  * Logic nặng (min/max, grouping) được xử lý ở backend
//  */
// export async function fetchQCTrendMetadata(
//   data: any[],
//   valueField: string = 'VALUE',
//   qcLimitsMode: boolean = false,
// ): Promise<QCTrendMetadata | null> {
//   try {
//     if (!data || data.length === 0) {
//       console.warn('[QCTrendMetadata] No data provided');
//       return null;
//     }

//     // Simple: Use VITE_API_HOST:VITE_API_PORT if set, otherwise localhost:8000
//     const apiHost = import.meta.env.VITE_API_HOST || 'localhost';
//     const apiPort = import.meta.env.VITE_API_PORT || '8000';
//     const apiUrl = `http://${apiHost}:${apiPort}/api/charts/qc-trend-metadata`;

//     console.log(
//       `[QCTrendMetadata] 🚀 Requesting from ${apiUrl} (${data.length} rows)...`,
//     );

//     const response = await fetch(apiUrl, {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//       },
//       body: JSON.stringify({
//         data,
//         valueField,
//         qcLimitsMode,
//       }),
//     });

//     if (!response.ok) {
//       throw new Error(`HTTP ${response.status}: ${response.statusText}`);
//     }

//     const result = await response.json();

//     if (!result.success) {
//       throw new Error(result.error || 'Unknown error');
//     }

//     const metadata = result.metadata;
    
//     console.log(
//       `[QCTrendMetadata] ✅ Received metadata in ${metadata.processingTimeMs}ms`,
//     );
//     console.log(
//       `[QCTrendMetadata] Y Domain: [${metadata.yDomain[0].toFixed(2)}, ${metadata.yDomain[1].toFixed(2)}]`,
//     );
//     console.log(
//       `[QCTrendMetadata] Shift markers: ${metadata.shiftMarkers.length}`,
//     );

//     return metadata;
//   } catch (error) {
//     console.error('[QCTrendMetadata] ❌ Error fetching metadata:', error);
//     return null; // Fallback: postProcessor sẽ tính lại ở client
//   }
// }
