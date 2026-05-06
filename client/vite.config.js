import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/', // Use absolute paths from root
  server: {
    port: 5173,
    strictPort: true, // Fail if port is already in use
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // Generate manifest for better asset handling
    manifest: true,
    rollupOptions: {
      output: {
        // Ensure consistent asset naming
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      }
    }
  }
})
