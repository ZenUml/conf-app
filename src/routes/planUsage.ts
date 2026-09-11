// Route handler for the Lite paywall redesign's confluence:globalPage entry
// (key: zenuml-plan-usage-page). Mirrors handleGetStartedRoute's shape —
// initialize Forge context, mount a Vue landing component into #app.

import { createApp } from 'vue'
import PlanUsage from '@/components/PlanUsage/PlanUsage.vue'
import globals from '@/model/globals'

export async function handlePlanUsageRoute() {
  try {
    await globals.apWrapper.initializeContext()

    const app = createApp(PlanUsage)
    const container = document.getElementById('app')
    if (container) {
      app.mount(container)
    } else {
      console.error('Plan and usage: #app container not found')
    }
  } catch (error) {
    console.error('Error handling Plan and usage route:', error)
  }
}
