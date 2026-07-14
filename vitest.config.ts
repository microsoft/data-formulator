import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Mirror vite.config: advanced dev may point `flint-chart` at a local checkout
      // via FLINT_CHART_LOCAL so tests exercise the same source. Unset → npm package.
      ...(process.env.FLINT_CHART_LOCAL
        ? { 'flint-chart': path.resolve(__dirname, process.env.FLINT_CHART_LOCAL) }
        : {}),
    },
    dedupe: ['vega', 'vega-lite', 'echarts', 'chart.js'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/frontend/setup.ts'],
    include: ['tests/frontend/**/*.test.{ts,tsx}'],
    css: false,
  },
});
