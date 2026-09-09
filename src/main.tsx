import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './index.css'

registerSW({ immediate: true })

const root = document.getElementById('root')!

try {
  if (window.opener) window.opener = null
} catch {
  // Cross-origin opener restrictions vary by browser; the app does not rely on opener.
}

if (window.top !== window.self) {
  // GitHub Pages cannot set frame-ancestors/X-Frame-Options itself. Refuse to render
  // inside a third-party frame to reduce clickjacking risk.
  root.textContent = 'O-Wallet cannot run inside another page.'
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
