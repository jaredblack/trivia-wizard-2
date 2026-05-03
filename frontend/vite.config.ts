import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // /cdn/* is served by CloudFront in prod; proxy to the live origin in dev
    // so the presentation renderer sees identical paths.
    proxy: {
      '/cdn': {
        target: 'https://trivia.jarbla.com',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
