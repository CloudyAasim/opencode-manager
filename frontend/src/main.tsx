import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import '@/lib/i18n'
import App from './App.tsx'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { TooltipProvider } from '@/components/ui/tooltip'
import { registerServiceWorker } from './lib/serviceWorker'

registerServiceWorker()

const rootElement = document.getElementById('root')!

const boot = document.getElementById('boot')
if (boot) {
  const observer = new MutationObserver(() => {
    if (rootElement.childElementCount === 0) return
    observer.disconnect()
    boot.remove()
  })
  observer.observe(rootElement, { childList: true })
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </ErrorBoundary>
  </StrictMode>,
)
