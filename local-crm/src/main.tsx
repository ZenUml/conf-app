import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { CrmProvider } from './stores/crm'
import './styles/app.css'

const root = document.getElementById('app')

if (!root) {
  throw new Error('Local CRM root element was not found')
}

createRoot(root).render(
  <StrictMode>
    <CrmProvider>
      <App />
    </CrmProvider>
  </StrictMode>
)
