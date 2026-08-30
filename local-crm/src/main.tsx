import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { datasetSelection } from './data'
import { CrmProvider } from './stores/crm'
import './styles/app.css'

const root = document.getElementById('app')

if (!root) {
  throw new Error('Local CRM root element was not found')
}

function DataUnavailable() {
  return (
    <main className="flex h-screen items-center justify-center bg-bg2 px-6 font-sans text-fg1">
      <section className="w-full max-w-[620px] rounded-lg border border-[color:var(--color-danger)] bg-bg1 p-6">
        <div className="lc-label text-bad">Data unavailable</div>
        <h1 className="mt-2 text-h3 font-semibold">Local CRM did not load a dataset</h1>
        <p className="mt-3 text-body-sm leading-6 text-fg2">{datasetSelection.reason}</p>
        <p className="mt-3 text-micro leading-5 text-fg3">
          No placeholder records or production freshness are displayed in this state.
        </p>
      </section>
    </main>
  )
}

const application = datasetSelection.state === 'unavailable'
  ? <DataUnavailable />
  : (
      <CrmProvider>
        <App />
      </CrmProvider>
    )

createRoot(root).render(
  <StrictMode>
    {datasetSelection.state === 'fixture' ? (
      <div className="flex h-screen flex-col bg-bg2 font-sans text-fg1">
        <div
          data-testid="fixture-data-banner"
          className="shrink-0 border-b border-[color:var(--accent-drawio-500)] bg-amber-50 px-4 py-2 text-center text-body-sm font-semibold text-amber-800"
        >
          FIXTURE DATA · synthetic development/test records · not production freshness
        </div>
        <div className="min-h-0 flex-1">{application}</div>
      </div>
    ) : application}
  </StrictMode>
)
