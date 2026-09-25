import { create } from 'zustand';

import type { StoreOS } from '../github/assets';
import { catalogOS } from '../platform';

export type BrowseOS = StoreOS | 'all';

/**
 * Which platform's apps the catalog shows. Starts at this device's own platform (Windows apps
 * on Windows, Android apps on a phone, everything in a browser) every time ArkStore opens;
 * people can switch to browse other platforms. Deliberately not persisted.
 */
export const useBrowse = create<{ os: BrowseOS; setOS: (os: BrowseOS) => void }>()((set) => ({
  os: catalogOS() ?? 'all',
  setOS: (os) => set({ os }),
}));
