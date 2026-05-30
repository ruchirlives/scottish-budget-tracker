import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/scottish-budget-tracker/',
  plugins: [react()],
  server: {
    proxy: {
      "/mcp": "http://127.0.0.1:8787",
      "/canvas": "http://127.0.0.1:8787",
      "/health": "http://127.0.0.1:8787",
    },
  },
});
