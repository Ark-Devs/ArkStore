import '@/lib/updates';

// Per-weight imports: the package entry points require every weight, which would ship
// all of them in the app. These are the only weights ArkStore uses.
import { Doto_800ExtraBold } from '@expo-google-fonts/doto/800ExtraBold';
import { SpaceGrotesk_400Regular } from '@expo-google-fonts/space-grotesk/400Regular';
import { SpaceGrotesk_500Medium } from '@expo-google-fonts/space-grotesk/500Medium';
import { SpaceGrotesk_600SemiBold } from '@expo-google-fonts/space-grotesk/600SemiBold';
import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk/700Bold';
import { SpaceMono_400Regular } from '@expo-google-fonts/space-mono/400Regular';
import { SpaceMono_700Bold } from '@expo-google-fonts/space-mono/700Bold';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useLinkMyApps } from '@/lib/api';
import '@/lib/auth';
import '@/lib/devices';
import { desktop, onDesktopUrl } from '@/lib/desktop';
import { isPackageInstalled, reconcileDesktopApps, reconcileInstallers } from '@/lib/install';
import { useInstalled } from '@/lib/stores/installed';
import { checkForUpdates, setupUpdateChecks } from '@/lib/updates';
import { useColors, useScheme } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
});

/** Update checks on launch and whenever the app comes back to the foreground. */
function UpdateWatcher() {
  useEffect(() => {
    setupUpdateChecks().catch(() => undefined);

    // Coming back to the app is frequent; the phone-side checks ask Android about every
    // installed app, so run them at most every 10 minutes.
    let lastPhoneCheck = 0;
    const refresh = async () => {
      if (Platform.OS === 'android' && Date.now() - lastPhoneCheck > 10 * 60 * 1000) {
        lastPhoneCheck = Date.now();
        // Forget apps that were uninstalled outside ArkStore.
        const { apps, forget } = useInstalled.getState();
        for (const app of Object.values(apps)) {
          if (app.packageName && !(await isPackageInstalled(app.packageName))) forget(app.appId);
        }
        // Notice installs that finished outside the app and tidy installer files.
        await reconcileInstallers().catch(() => undefined);
      }
      await checkForUpdates({ notify: false }).catch(() => undefined);
    };
    refresh();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, []);

  // Tapping an update notification opens the app page or the Updates tab.
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const url = response?.notification.request.content.data?.url;
    if (typeof url === 'string') router.push(url as never);
  }, [response]);

  return null;
}

export default function RootLayout() {
  const scheme = useScheme();
  const c = useColors();
  const [loaded, error] = useFonts({
    Doto_800ExtraBold,
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    SpaceMono_400Regular,
    SpaceMono_700Bold,
  });

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(c.bg).catch(() => undefined);
  }, [c.bg]);

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync().catch(() => undefined);
  }, [loaded, error]);

  if (!loaded && !error) return null;

  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: { ...base.colors, background: c.bg, card: c.bg, text: c.text, border: c.line, primary: c.accent },
  };

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.bg }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={navTheme}>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          {Platform.OS !== 'web' ? <UpdateWatcher /> : <WebUpdateWatcher />}
          <AppLinker />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: c.bg },
              animation: 'slide_from_right',
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="publish" options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="account" options={{ animation: 'slide_from_bottom' }} />
          </Stack>
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

/** Links the signed-in developer's apps to their account (public.link_my_apps). */
function AppLinker() {
  useLinkMyApps();
  return null;
}

function WebUpdateWatcher() {
  useEffect(() => {
    checkForUpdates({ notify: false }).catch(() => undefined);
    if (!desktop) return;

    // The desktop app stays open for long stretches: check every 30 minutes and notify, and
    // follow notification clicks and arkstore:// links to their page.
    reconcileDesktopApps().catch(() => undefined);
    const timer = setInterval(() => {
      reconcileDesktopApps().catch(() => undefined);
      checkForUpdates({ notify: true }).catch(() => undefined);
    }, 30 * 60 * 1000);
    const stop = onDesktopUrl((url) => {
      if (url.startsWith('/')) router.push(url as never);
      else if (url.startsWith('arkstore://app/')) router.push(`/app/${url.slice('arkstore://app/'.length)}` as never);
    });
    return () => {
      clearInterval(timer);
      stop();
    };
  }, []);
  return null;
}
