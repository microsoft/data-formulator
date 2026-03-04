import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

// Get port from environment variable with fallback to 5000
const apiPort = process.env.API_PORT || 5000;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
      },
    },
  },
  build: {
    outDir: path.join(__dirname, 'py-src', 'data_formulator', "dist"),
    rollupOptions: {
      output: {
        entryFileNames: `DataFormulator.js`,  // specific name for the main JS bundle
        chunkFileNames: `assets/[name]-[hash].js`, // keep default naming for chunks
        assetFileNames: `assets/[name]-[hash].[ext]`, // keep default naming for other assets
        manualChunks: {
          // Separate vendor chunks for better caching and parallel loading
          'vendor-react': ['react', 'react-dom', 'react-redux', 'redux', '@reduxjs/toolkit'],
          'vendor-mui': ['@mui/material', '@mui/icons-material', '@mui/lab', '@emotion/react', '@emotion/styled'],
          'vendor-vega': ['vega', 'vega-lite', 'vega-embed', 'react-vega'],
          'vendor-d3': ['d3'],
          'vendor-utils': ['lodash', 'localforage', 'dompurify', 'validator'],
          'vendor-editor': ['prismjs', 'prism-react-renderer', 'react-simple-code-editor', 'prettier'],
          'vendor-markdown': ['markdown-to-jsx', 'mui-markdown', 'katex', 'react-katex'],
          'vendor-misc': ['exceljs', 'html2canvas', 'allotment', 'react-dnd', 'react-dnd-html5-backend', 'react-virtuoso'],
        }
      }
    },
    chunkSizeWarningLimit: 1000, // Warn if chunks exceed 1MB
  },
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      }
    }
  }
});
