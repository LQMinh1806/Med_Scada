import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Đọc .env từ thư mục root (parent) thay vì frontend/
  envDir: path.resolve(import.meta.dirname, '..'),
  server: {
    host: true,
    port: 5173,
    allowedHosts: ['medscada.id.vn'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://127.0.0.1:3000',
        ws: true,
      },
    },
  },
  preview: {
    host: true,
    port: 4173,
  },
})
