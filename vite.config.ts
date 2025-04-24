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
  build: {
    outDir: path.join(__dirname, 'py-src', 'data_formulator', "dist"),
    rollupOptions: {
      output: {
        entryFileNames: `DataFormulator.js`,  // specific name for the main JS bundle
        chunkFileNames: `assets/[name]-[hash].js`, // keep default naming for chunks
        assetFileNames: `assets/[name]-[hash].[ext]` // keep default naming for other assets
      }
    }
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
