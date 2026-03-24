import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

// Use the locally bundled Monaco instead of fetching from cdn.jsdelivr.net.
// The CSP (scriptSrc: 'self') blocks external CDN scripts; bundling avoids
// that entirely. Sencho only needs YAML/plaintext so the base editorWorker
// covers all language modes — no additional language workers required.
window.MonacoEnvironment = {
  getWorker(_workerId: string, _label: string): Worker {
    return new editorWorker()
  },
}
loader.config({ monaco })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
