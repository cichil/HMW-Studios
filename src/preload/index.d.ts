import type { AptanaBridgeAPI } from '@shared/types';

declare global {
  interface Window {
    aptana: AptanaBridgeAPI;
  }
}
