// Route handler for the AsyncAPI variant's confluence:globalPage entry
// (key: zenuml-asyncapi-dashboard-page). Mirrors handleGetStartedRoute's
// shape — initialize Forge context, mount a Vue landing component into #app.

import { createApp } from 'vue'
import AsyncApiDashboard from '@/components/AsyncApiDashboard/AsyncApiDashboard.vue'
import globals from '@/model/globals'

export async function handleAsyncApiDashboardRoute() {
  try {
    await globals.apWrapper.initializeContext()

    const app = createApp(AsyncApiDashboard)
    const container = document.getElementById('app')
    if (container) {
      app.mount(container)
    } else {
      console.error('AsyncAPI dashboard: #app container not found')
    }
  } catch (error) {
    console.error('Error handling AsyncAPI dashboard route:', error)
  }
}
