import { defineConfig } from 'vite'

export default defineConfig({
  base: '/annotated-align-visualiser/',
  build: {
    outDir: 'dist',
    sourcemap: false
  }
})
