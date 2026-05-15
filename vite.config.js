import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    open: true,
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: true,
    open: true,
  },
  cacheDir: 'node_modules/.vite-swiftm',
})