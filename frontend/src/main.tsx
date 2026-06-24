import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { applyFontScale, applyTheme, getStoredFontScale, getStoredTheme } from './lib/theme'
import { registerServiceWorker } from './lib/push'

// Apply persisted theme + font scale before first render to avoid flash
const storedTheme = getStoredTheme()
if (storedTheme) applyTheme(storedTheme)
const storedFontScale = getStoredFontScale()
if (storedFontScale) applyFontScale(storedFontScale)

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Missing #root element')

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

void registerServiceWorker()
