import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Listen on all local interfaces so http://localhost:5173 and http://127.0.0.1:5173 both work.
    host: true,
    port: 5173,
    strictPort: false,
  },
})
