import type { InjectionKey } from 'vue';
import type { BrowserLocalArchitectureTokenDirectoryProvider } from '@/domain/architectureTokens/architectureTokenDirectory';

/**
 * Explicit host-to-editor boundary for a pre-authorized local Token directory.
 * The editor provides no default catalogue and never resolves this key from a
 * network source; test and future host integrations must inject it directly.
 */
export const architectureTokenDirectoryProviderKey: InjectionKey<BrowserLocalArchitectureTokenDirectoryProvider> =
  Symbol('architectureTokenDirectoryProvider');
