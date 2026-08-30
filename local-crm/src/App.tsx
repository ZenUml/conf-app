import CaseDrawer from '@/components/drawer/CaseDrawer'
import QueueRequestDrawer from '@/components/drawer/QueueRequestDrawer'
import NavRail from '@/components/NavRail'
import TopBar from '@/components/TopBar'
import AutomationScreen from '@/screens/AutomationScreen'
import ExtensionsScreen from '@/screens/ExtensionsScreen'
import SitesScreen from '@/screens/SitesScreen'
import TodayScreen from '@/screens/TodayScreen'
import { useCrmStore } from '@/stores/crm'

function CurrentScreen() {
  const { screen } = useCrmStore()
  switch (screen) {
    case 'sites':
      return <SitesScreen />
    case 'extensions':
      return <ExtensionsScreen />
    case 'automation':
      return <AutomationScreen />
    default:
      return <TodayScreen />
  }
}

export default function App() {
  return (
    <div className="flex h-full min-h-[720px] overflow-hidden bg-bg2 font-sans text-body text-fg1">
      <NavRail />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div data-testid="screen-scroll" className="min-h-0 flex-1 overflow-y-auto">
          <CurrentScreen />
        </div>
      </main>
      <CaseDrawer />
      <QueueRequestDrawer />
    </div>
  )
}
