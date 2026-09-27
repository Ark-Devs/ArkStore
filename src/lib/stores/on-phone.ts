// Android: which apps are on the phone right now, however they got there (ArkStore, a browser, an
// APK from GitHub, Play Store). ArkStore's own records only know what it installed and can go
// stale when an app is uninstalled; buttons ask Android through this instead. Answers are cached
// until ArkStore comes back to the foreground (see forgetPhoneChecks), when anything may have
// changed.
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { isPackageInstalled } from '../install';

const useOnPhone = create<{ packages: Record<string, boolean> }>()(() => ({ packages: {} }));
const pending = new Set<string>();

async function check(packageName: string) {
  if (pending.has(packageName)) return;
  pending.add(packageName);
  try {
    const installed = await isPackageInstalled(packageName);
    useOnPhone.setState((s) => ({ packages: { ...s.packages, [packageName]: installed } }));
  } finally {
    pending.delete(packageName);
  }
}

/** Whether the app with this package is installed: true / false, or undefined while unknown. */
export function useOnPhoneCheck(packageName: string | null | undefined): boolean | undefined {
  const known = useOnPhone((s) => (packageName ? s.packages[packageName] : undefined));
  useEffect(() => {
    if (Platform.OS === 'android' && packageName && known === undefined) check(packageName);
  }, [packageName, known]);
  return Platform.OS === 'android' && packageName ? known : undefined;
}

/** Drops the cached answers, so every button asks Android again. */
export function forgetPhoneChecks() {
  useOnPhone.setState({ packages: {} });
}
