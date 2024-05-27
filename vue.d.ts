// This file fixes error "TS2339: Property $store does not exist on type" if you need to access vm.$store.
// This happens more likely in tests. But you should use the store variable whenever possible. See Header.spec.ts for an example.
import { Store } from 'vuex'
import { State } from './src/model/store2/ExtendedStore'  // todo: it seems the path does not make a difference

declare module '@vue/runtime-core' {
  interface ComponentCustomProperties {
    $store: Store<State>;
  }
}
