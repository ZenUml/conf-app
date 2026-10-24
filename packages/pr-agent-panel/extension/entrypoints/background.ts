import { LOCAL_HOST_ORIGIN } from '@zenuml/pr-panel-shared'
import { browser } from 'wxt/browser'
import { McpBroker, type BrokerPort } from '../src/bridge/broker'
import { HubClient, type WebSocketCtor } from '../src/bridge/hub-client'
import { PORT_NAME } from '../src/bridge/messages'
import { getPref, onPrefsChanged, setPref } from '../src/state/prefs'

export default defineBackground(() => {
  const client = new HubClient({
    fetch: (input, init) => fetch(input, init),
    WebSocket: WebSocket as unknown as WebSocketCtor,
    extVersion: browser.runtime.getManifest().version,
    getLastPort: () => getPref('lastPort'),
    setLastPort: (port) => setPref('lastPort', port),
  })

  const broker = new McpBroker({
    client,
    hasHostPermission: () => browser.permissions.contains({ origins: [LOCAL_HOST_ORIGIN] }),
    getMcpAccess: () => getPref('mcpAccess'),
    setMcpAccess: (value) => setPref('mcpAccess', value),
    openOptions: () => browser.runtime.openOptionsPage(),
  })

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return
    // Only our own pages and content scripts reach onConnect (no externally_connectable).
    broker.addPort(port as unknown as BrokerPort)
  })

  // Enabling from the options page (or disabling anywhere) takes effect even after a service-worker restart.
  onPrefsChanged((change) => {
    if (change.mcpAccess !== undefined) void broker.applyAccess()
  })
  browser.permissions.onAdded.addListener(() => void broker.applyAccess())
  browser.permissions.onRemoved.addListener(() => void broker.applyAccess())

  void broker.applyAccess()
})
