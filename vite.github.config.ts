import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS === 'true' ? '/IRT/' : '/',
  css: { postcss: { plugins: [tailwindcss()] } },
  resolve: { alias: { '@': path.resolve(process.cwd()) } },
  plugins: [react()],
  build: { outDir: 'dist/client', emptyOutDir: true },
});
