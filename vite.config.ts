import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const pages = mode === 'pages';
  return {
    plugins: [react()],
    base: pages ? '/jobhunter/' : '/',
    define: { 'import.meta.env.VITE_STATIC_MODE': JSON.stringify(String(pages)) },
    server: { proxy: { '/api': 'http://127.0.0.1:3001' } },
    build: { outDir: pages ? 'dist-pages' : 'dist' },
  };
});
