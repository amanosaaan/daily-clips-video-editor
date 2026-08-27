/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/daily-clips-video-editor/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
