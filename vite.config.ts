import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solid()],
  server: {
    proxy: {
      '/api': {
        // API_PORT lets a second instance (e.g. a worktree copy) run
        // alongside the default one without port collisions.
        target: `http://localhost:${process.env.API_PORT || 3001}`,
        changeOrigin: true,
      }
    }
  }
})
