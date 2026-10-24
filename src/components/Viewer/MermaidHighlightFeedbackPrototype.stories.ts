// @ts-expect-error -- Storybook package exports resolve through Vite
import {setup,type Meta,type StoryObj} from '@storybook/vue3-vite'
import store from '@/model/store2'
import MermaidHighlightFeedbackPrototype from './MermaidHighlightFeedbackPrototype.vue'
import {configureHighlightStory,primeHighlightMermaid} from './fixtures/mermaidHighlightStory'
setup(app=>app.use(store))
const meta: Meta<typeof MermaidHighlightFeedbackPrototype> = {
  title:'Viewer/MermaidHighlightFeedbackPrototype',component:MermaidHighlightFeedbackPrototype,
  parameters:{layout:'fullscreen'},loaders:[async()=>{await primeHighlightMermaid();return {}}],
  decorators:[()=>{configureHighlightStory();return {template:'<story />'}}],
  argTypes:{initialState:{control:'select',options:['interactive','prompt','liked','disliked','dismissed']}},
}
export default meta
type Story=StoryObj<typeof MermaidHighlightFeedbackPrototype>
export const Interactive:Story={args:{initialState:'interactive'}}
export const PromptVisible:Story={args:{initialState:'prompt'}}
export const Liked:Story={args:{initialState:'liked'}}
export const Disliked:Story={args:{initialState:'disliked'}}
export const Dismissed:Story={args:{initialState:'dismissed'}}
