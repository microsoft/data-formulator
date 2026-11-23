import { describe, expect, it } from "vitest";

import {
  DEFAULT_CHART_THEME_ID,
  dataFormulatorReducer,
  dfActions,
  generateFreshChart,
} from "../../../../src/app/dfSlice";

const initial = () => dataFormulatorReducer(undefined, { type: "@@init" });

describe("default chart theme", () => {
  it("defaults new charts to the Datawrapper theme", () => {
    expect(DEFAULT_CHART_THEME_ID).toBe("datawrapper");
    const state = dataFormulatorReducer(initial(), dfActions.addChart(generateFreshChart("t", "Bar Chart")));
    expect(state.charts[0].themeId).toBe("datawrapper");
  });

  it("applies the configured theme, or none for Flint default", () => {
    let state = initial();
    state = dataFormulatorReducer(state, dfActions.setConfig({ ...state.config, defaultChartThemeId: "economist" }));
    state = dataFormulatorReducer(state, dfActions.addAndFocusChart(generateFreshChart("t", "Bar Chart")));
    expect(state.charts[0].themeId).toBe("economist");

    state = dataFormulatorReducer(state, dfActions.setConfig({ ...state.config, defaultChartThemeId: "" }));
    state = dataFormulatorReducer(state, dfActions.addChart(generateFreshChart("t", "Bar Chart")));
    expect(state.charts[0].themeId).toBeUndefined();
  });

  it("treats configs saved before the setting existed as Datawrapper", () => {
    let state = initial();
    const { defaultChartThemeId: _omit, ...legacyConfig } = state.config;
    state = dataFormulatorReducer(state, dfActions.setConfig(legacyConfig));
    state = dataFormulatorReducer(state, dfActions.addChart(generateFreshChart("t", "Bar Chart")));
    expect(state.charts[0].themeId).toBe("datawrapper");
  });

  it("keeps a theme the chart already has", () => {
    const chart = { ...generateFreshChart("t", "Bar Chart"), themeId: "nyt" };
    const state = dataFormulatorReducer(initial(), dfActions.addChart(chart));
    expect(state.charts[0].themeId).toBe("nyt");
  });
});
