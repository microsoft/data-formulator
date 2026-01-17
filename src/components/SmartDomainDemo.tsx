/**
 * Demo: Smart Y-Axis Domain Calculation for Bar Charts
 *
 * Problem:
 *   When data values are clustered (e.g., 45.1, 45.2, 45.3),
 *   bar charts may have large scale which hides small differences.
 *
 * Solution:
 *   Automatically calculate optimal domain based on data min/max
 *   with smart padding percentage.
 *
 * Example:
 *   Data: [45.1176, 45.2, 45.1066, 45.3416, 45.2833, 45.0216, 44.9766]
 *   Min: 44.9766, Max: 45.3416
 *   Range: 0.365
 *   Padding (10%): 0.0365
 *   Domain: [44.94, 45.38]  <- Clear visualization of small differences
 */

// Example data from user's request
const exampleData = [
  { QCDATE: 20250801, AVG_VALUE: 45.225, QCSHIFT: "NIGHT" },
  { QCDATE: 20250801, AVG_VALUE: 45.1176470588, QCSHIFT: "DAY" },
  { QCDATE: 20250802, AVG_VALUE: 45.1423076923, QCSHIFT: "NIGHT" },
  { QCDATE: 20250802, AVG_VALUE: 45.1537037037, QCSHIFT: "DAY" },
  { QCDATE: 20250803, AVG_VALUE: 45.1066666667, QCSHIFT: "DAY" },
  { QCDATE: 20250803, AVG_VALUE: 45.3416666667, QCSHIFT: "NIGHT" },
  { QCDATE: 20250804, AVG_VALUE: 45.2833333333, QCSHIFT: "NIGHT" },
  { QCDATE: 20250804, AVG_VALUE: 45.0216666667, QCSHIFT: "DAY" },
  { QCDATE: 20250805, AVG_VALUE: 44.9766666667, QCSHIFT: "DAY" },
];

/**
 * Calculate optimal Y-axis domain
 */
function calculateOptimalYDomain(
  data: any[],
  yField: string,
  paddingPercent: number = 10
): [number, number] | null {
  if (!data || data.length === 0 || !yField) return null;

  // Extract all numeric Y values
  const yValues = data
    .map((row) => row[yField])
    .filter((val: any) => typeof val === "number" && isFinite(val));

  if (yValues.length === 0) return null;

  const minValue = Math.min(...yValues);
  const maxValue = Math.max(...yValues);
  const range = maxValue - minValue;

  // If all values are the same, just add small padding
  if (range === 0) {
    const padding = Math.abs(minValue) * 0.1 || 0.1;
    return [minValue - padding, minValue + padding];
  }

  // Add percentage-based padding to each side
  const padding = range * (paddingPercent / 100);
  return [minValue - padding, maxValue + padding];
}

// Demo output
console.log("\n" + "=".repeat(70));
console.log("SMART Y-AXIS DOMAIN CALCULATION DEMO");
console.log("=".repeat(70));

console.log("\nInput Data:");
console.log(exampleData);

const yField = "AVG_VALUE";
const domain = calculateOptimalYDomain(exampleData, yField, 10);

console.log(`\n📊 Analysis for field: "${yField}"`);
console.log(
  `   Data values: [${exampleData.map((d) => d[yField]).join(", ")}]`
);

if (domain) {
  const yValues = exampleData
    .map((row) => row[yField])
    .filter((val) => typeof val === "number" && isFinite(val));

  const minValue = Math.min(...yValues);
  const maxValue = Math.max(...yValues);
  const range = maxValue - minValue;
  const padding = range * 0.1;

  console.log(`\n📈 Domain Calculation:`);
  console.log(`   Min Value:    ${minValue.toFixed(4)}`);
  console.log(`   Max Value:    ${maxValue.toFixed(4)}`);
  console.log(`   Range:        ${range.toFixed(4)}`);
  console.log(`   Padding (10%): ${padding.toFixed(4)}`);
  console.log(
    `\n✅ Optimal Domain: [${domain[0].toFixed(4)}, ${domain[1].toFixed(4)}]`
  );

  // Compare with naive approach
  console.log(`\n📊 Comparison:`);
  console.log(`   Naive (0 - max):       [0, ${maxValue.toFixed(4)}]`);
  console.log(
    `   With zero=false:       [${minValue.toFixed(4)}, ${maxValue.toFixed(4)}]`
  );
  console.log(
    `   Smart (our approach):  [${domain[0].toFixed(4)}, ${domain[1].toFixed(
      4
    )}]`
  );

  console.log(`\n💡 Benefits:`);
  console.log(`   - Shows small differences clearly`);
  console.log(`   - Maintains visual clarity with padding`);
  console.log(`   - Automatically adapts to data range`);
  console.log(`   - Works with any data distribution`);
}

console.log("\n" + "=".repeat(70));
console.log("VEGA-LITE ENCODING CONFIGURATION");
console.log("=".repeat(70));

const vegaLiteConfig = {
  $schema: "https://vega.github.io/schema/vega-lite/v5.json",
  data: { values: exampleData },
  mark: "bar",
  encoding: {
    x: {
      field: "QCDATE",
      type: "ordinal",
      title: "QC Date",
    },
    y: {
      field: "AVG_VALUE",
      type: "quantitative",
      title: "Average Value",
      scale: {
        zero: false,
        domain: domain, // 👈 Smart domain applied here
      },
    },
    color: {
      field: "QCSHIFT",
      type: "nominal",
      title: "Shift",
    },
  },
};

console.log("\n✅ Vega-Lite encoding with smart domain:");
console.log(JSON.stringify(vegaLiteConfig, null, 2));

console.log("\n" + "=".repeat(70));
console.log("IMPLEMENTATION IN CHARTTEMPLATES");
console.log("=".repeat(70));

const implementationCode = `
// In ChartTemplates.tsx postProcessor:
postProcessor: (vgSpec: any, table: any[]) => {
  try {
    const yDef = vgSpec.encoding?.y;
    if (!yDef || !yDef.field) return vgSpec;

    const yField = yDef.field;
    const domain = calculateOptimalYDomain(table, yField, 10);

    if (domain) {
      if (!yDef.scale) yDef.scale = {};
      yDef.scale.domain = domain;
      yDef.scale.zero = false;
      console.log(\`📊 Applied smart domain [\${domain[0]}, \${domain[1]}]\`);
    }
  } catch (error) {
    console.warn("Failed to calculate domain", error);
  }
  return vgSpec;
}
`;

console.log(implementationCode);

console.log("\n" + "=".repeat(70));
console.log("CHART TYPES UPDATED");
console.log("=".repeat(70));

const chartTypes = [
  "Bar Chart",
  "Grouped Bar Chart",
  "Stacked Bar Chart",
  "Histogram",
];

console.log("\nCharts with smart domain calculation:");
chartTypes.forEach((chart) => {
  console.log(`  ✅ ${chart}`);
});

console.log("\n" + "=".repeat(70));
