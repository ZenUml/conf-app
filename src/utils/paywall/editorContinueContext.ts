import type { InjectionKey, Ref } from 'vue'

export const editorPaywallContinued: InjectionKey<Readonly<Ref<boolean>>> = Symbol('editorPaywallContinued')
