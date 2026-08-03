import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    {
      name: 'dreamhome-local-prototype-assets',
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          // Production is served from `web/`, where `/prototype/...` exists
          // at the domain root. During local Vite development the same files
          // live below `/web/prototype/...`, so rewrite only the dev request.
          if (request.url?.startsWith('/prototype/')) {
            request.url = `/web${request.url}`
          }
          next()
        })
      },
    },
    react(),
  ],
  server: {
    proxy: {
      '/api/photo-to-3d': 'http://localhost:8001',
      '/api/jobs': 'http://localhost:8001',
    },
  },
})
