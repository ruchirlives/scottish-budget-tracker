import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/scottish-budget-tracker/',
  plugins: [react()],
});
