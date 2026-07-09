/* @refresh reload */
import { render } from 'solid-js/web'
import './index.css'
import App from './App.tsx'

const root = document.getElementById('root')

render(() => <App />, root!)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    if (import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.warn('Service worker registration failed:', error)
      })
    } else {
      // Dev must never be controlled by the PWA cache. Otherwise Vite can serve
      // stale TS/JS modules from the service worker and code changes appear to
      // "do nothing" even after restarting the app.
      navigator.serviceWorker.getRegistrations()
        .then((regs) => Promise.all(regs.map((reg) => reg.unregister())))
        .catch(() => {})
      caches?.keys?.()
        .then((keys) => Promise.all(keys.filter((key) => key.startsWith('sylph-pwa-')).map((key) => caches.delete(key))))
        .catch(() => {})
    }
  })
}
