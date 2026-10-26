import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Expose only the existing public API setting, never the process environment.
  const env = loadEnv(mode, process.cwd(), 'REACT_APP_');
  const apiTarget = process.env.DEV_API_PROXY_TARGET || 'http://127.0.0.1:8001';
  return {
    plugins: [react()],
    define: {
      'process.env.REACT_APP_API_URL': JSON.stringify(env.REACT_APP_API_URL || '/api'),
      'process.env.PUBLIC_URL': JSON.stringify(''),
    },
    build: {
      outDir: 'build',
      assetsDir: 'static',
      target: 'es2020',
    },
    server: {
      host: '0.0.0.0',
      port: Number(process.env.PORT || 3001),
      strictPort: true,
      allowedHosts: process.env.REPLIT_DEV_DOMAIN ? [process.env.REPLIT_DEV_DOMAIN] : [],
      // Optional local development; the managed preview serves the compiled app.
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true, rewrite: (path) => path.replace(/^\/api/, '') },
        '/openapi.json': { target: apiTarget, changeOrigin: true },
      },
      watch: { usePolling: process.env.CHOKIDAR_USEPOLLING === 'true' },
    },
  };
});
