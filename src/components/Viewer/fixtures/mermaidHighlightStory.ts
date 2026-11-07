import store from '@/model/store2'
import {applyForgeEnv,forgeEnv,type ForgeEnvOptions} from '../../../../.storybook/forgeEnv'
import {DataSource,DiagramType} from '@/model/Diagram/Diagram'
import {FeatureFlags} from '@forge/bridge'
import {resetFeatureFlagsForTests} from '@/apis/aiTitleFeatureFlag'
import {resetStubResponses} from '@/stubs/forge-bridge'
import {loadMermaid} from '@/utils/mermaid/loadMermaid'
export const HIGHLIGHT_SOURCE = `flowchart LR
  A[购物车] --> B[创建订单]
  B --> C[库存检查]
  B --> D[支付处理]
  B --> E[订单记录]
  C --> F[订单事件]
  C --> G[仓库备货]
  D --> F
  D --> G
  E --> F
  E --> H[通知客户]
  classDef default fill:#fbf8f2,stroke:#bcb3a5,color:#3d3933,stroke-width:1.4px;`
export async function primeHighlightMermaid() {
  const bundled = await import('mermaid')
  await loadMermaid({importer:async()=>bundled,retries:0})
}
/** Forge environment of the highlight stories: a Lite viewer. `inline` drops the fullscreen modal. */
export function highlightForgeEnvOptions({inline=false}:{inline?:boolean}={}):ForgeEnvOptions{
  return {
    forge:{
      isForge:false,isLite:true,zenumlRemoteBaseUrl:'https://storybook.invalid',
      forgeContext:{accountId:'storybook-user',cloudId:'storybook-cloud',extension:{content:{id:'storybook-page'},space:{key:'DOCS'},config:{},...(inline?{}:{modal:{macroMode:'fullscreen'}})}},
    },
    apWrapper:{
      isDisplayMode:()=>true,
      initializeContext:async()=>undefined,
      canUserEdit:async()=>false,
      getMacroData:async()=>({customContentId:'storybook-diagram',uuid:'storybook-macro'}),
      getCurrentPage:async()=>({title:'Synthetic order flow',body:{export_view:{value:'<p>Synthetic order workflow.</p>'}},_links:{base:'https://example.atlassian.net/wiki',webui:'/spaces/DOCS/pages/123'}}),
    },
  }
}
/** Decorator form: applies the highlight Forge environment and restores it on unmount. */
export function highlightForgeEnv(o:{inline?:boolean}={}){return forgeEnv(()=>highlightForgeEnvOptions(o))}
/** Store, flags and stubbed responses for the highlight stories (no Forge singletons). */
export function configureHighlightStoreAndFlags() {
  resetStubResponses();resetFeatureFlagsForTests()
  FeatureFlags.prototype.checkFlag = (_key,defaultValue=false)=>defaultValue
  store.commit('updateDiagramType',DiagramType.Mermaid);store.commit('updateMermaidCode',HIGHLIGHT_SOURCE);store.commit('updateTitle','订单处理流程');store.commit('setDiagramAttribution',null)
  Object.assign(store.state.diagram,{source:DataSource.CustomContent,id:'storybook-diagram',isCopy:false,recoveredFromOrphan:false,snapshotFallback:false,magic:undefined})
  store.state.viewerLoadState='ready';store.state.loadError=null
}
/**
 * Legacy one-call setup for MermaidHighlightFeedbackPrototype.stories.ts, which another
 * PR is editing. It cannot restore on unmount; move that story to highlightForgeEnv().
 */
export function configureHighlightStory() {
  applyForgeEnv(highlightForgeEnvOptions())
  configureHighlightStoreAndFlags()
}
