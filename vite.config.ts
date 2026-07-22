import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/photo-to-3d': 'http://localhost:8001',
      '/api/jobs': 'http://localhost:8001',
    },
  },
})
