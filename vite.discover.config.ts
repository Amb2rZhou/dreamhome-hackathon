import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build the teammate-owned React feed into the static prototype deployed from
// `web/`.
export default defineConfig({
  plugins: [react()],
  // Use a stable absolute asset base so the app can be served directly from
  // the short /dreamhome route without an iframe or an extra HTML round-trip.
  base: '/prototype/pages/discover/app/',
  // Runtime media uses root-relative URLs and is synced once into `web/` by
  // the build script, so do not duplicate the 40+ MB public directory here.
  publicDir: false,
  build: {
    outDir: 'web/prototype/pages/discover/app',
    emptyOutDir: true,
  },
})
