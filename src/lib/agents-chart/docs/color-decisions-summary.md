# color-decisions.ts 总结

## 1. 这个文件在做什么

`color-decisions.ts` 实现了一个**与具体图表库无关的「颜色决策层」**：只根据语义和数据决定「用哪类色板、哪个 scheme」，不涉及 Vega-Lite / ECharts 的语法。

### 1.1 核心职责

- **统一色板注册表**：目前仅维护少量内置 colormap（如 `cat10`、`cat20`、`viridis`、`RdBu`，后期可以持续添加），每个带类型、是否支持离散/连续、色盲安全、背景等元数据。
- **按「查询」选色板**：`pickColorMap(query)` 根据 `ColorMapQuery`（类型、分类数、色盲安全、背景、diverging 中点等）从注册表里选一个 colormap。
- **按通道做颜色决策**：
  - 从 `ChannelSemantics`（含 `colorScheme` 等）推断该通道该用 **categorical / sequential / diverging**。
  - 对 `color`、`group` 等通道分别调用 `decideColorForChannel()`，得到每个通道的 `ColorDecision`（scheme 类型、schemeId、是否主通道、是否数据驱动等）。
- **主入口**：`decideColorMaps(ctx)` 根据图表类型、编码、通道语义、数据表等一次性算出所有颜色相关决策，返回 `ColorDecisionResult`（按 channel 存）。
- **取色值**：`getPaletteForScheme(id)` 根据 scheme id 从注册表取出实际颜色数组，供各后端使用。

### 1.2 决策顺序（单通道）

1. 若 encoding 里指定了 `scheme` 且不是 `'default'`，优先用该 scheme（在注册表则用其类型，否则当作用户自定义 id 透传）。
2. 否则用 `ChannelSemantics.colorScheme` 的 type（diverging / sequential / categorical），必要时结合编码类型（如 temporal + color 用 sequential）。
3. 再没有 hint 时，用编码类型兜底（quantitative/temporal → sequential，否则 categorical）。
4. 用数据统计（如 `countDistinctValues`）参与 categorical 的 `categoryCount`，供 `pickColorMap` 选「容量合适」的 palette。

---

## 2. 在当前项目里的作用

- **统一入口**：Vega-Lite 和 ECharts 的 assemble 都在**组装阶段**调用一次 `decideColorMaps(...)`，把得到的 `colorDecisions` 放进 `InstantiateContext`（见 `core/types.ts` 中的 `colorDecisions?: ColorDecisionResult`）。
- **后端只消费不重算**：  
  Vega-Lite / ECharts 的 instantiate 与各图表模板（line、area、scatter、bar、heatmap、pie 等）只读取 `context.colorDecisions` 和 `getPaletteForScheme(schemeId)`，不再各自实现一套「选哪个色板」的逻辑。
- **效果**：同一张图在语义和数据相同的情况下，无论走 Vega-Lite 还是 ECharts，都会得到同一套颜色决策（scheme 类型与 id），只有「如何把决策变成 scale/option」不同，由各自后端负责。

---

## 3. 设计是否合理

整体设计是合理的，并且和当前架构匹配。

- **职责清晰**：  
  「选什么色板」集中在这一层；「怎么画出来」留在 vegalite/echarts 的 instantiate 与模板里。符合「决策与渲染解耦」的分层思路。

- **后端无关**：  
  不依赖 VL/EC 的 API，只输出抽象的 scheme 类型、id、离散数等，便于多后端共用和测试。

- **数据与语义驱动**：  
  结合 `ChannelSemantics`（含 colorScheme）、编码类型、数据 distinct 数来选 categorical/sequential/diverging 和具体 palette，逻辑集中、可维护。

- **扩展点明确**：  
  新 colormap 在 `COLOR_MAPS` 里加一项即可；新通道在 `ColorChannel` 和 `decideColorMaps` 里对 `fill`/`stroke` 等加分支即可（目前注释已说明 fill/stroke 预留）。

可以视需求再做的改进（非必须）：

- **注册表可配置化**：若未来需要从配置或主题注入更多色板，可以把 `COLOR_MAPS` 做成可注入的注册表或从上层传入，而不是写死数组。
- **色盲安全与背景**：`pickColorMap` 里 `preferColorblindSafe` 默认 `true`，若产品需要「可关闭色盲安全」或按主题切换，可在 `DecideColorMapsContext` 里增加选项并传入 `ColorMapQuery`。
- **一致性**：注释中英混用，若团队规范要求可统一为一种语言。

**结论**：`color-decisions.ts` 负责在语义和数据基础上做出与后端无关的颜色决策，并作为 Vega-Lite / ECharts 共用的唯一决策来源，设计分层清晰、职责单一，对当前项目是合理且重要的核心模块。
