import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build the teammate-owned React feed into the static prototype deployed from
// `web/`. A relative base keeps the bundle portable under Vercel and Pages.
export default defineConfig({
  base: './',
  plugins: [react()],
  // Runtime media uses root-relative URLs and is synced once into `web/` by
  // the build script, so do not duplicate the 40+ MB public directory here.
  publicDir: false,
  build: {
    outDir: 'web/prototype/pages/discover/app',
    emptyOutDir: true,
  },
})
