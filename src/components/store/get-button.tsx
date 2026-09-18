import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'phosphor-react-native';
import { useEffect } from 'react';
import { Alert, Linking, Platform, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { DotLoader } from '@/components/ui/dots';
import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { repoUrl } from '@/lib/github/repo';
import { cancelDownload, installApp, installFromFile, openInstalledApp } from '@/lib/install';
import { hasUpdate, useInstalled } from '@/lib/stores/installed';
import { installerStatus, isNeeded, useInstallers } from '@/lib/stores/installers';
import { useTasks } from '@/lib/stores/tasks';
import { friendlyError } from '@/lib/supabase';
import type { ListApp } from '@/lib/types';
import { radius, useColors } from '@/theme';

type Size = 'sm' | 'lg';

function ProgressRing({ progress, size }: { progress: number; size: number }) {
  const c = useColors();
  const reduce = useReducedMotion();
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const indeterminate = progress < 0;
  const spin = useSharedValue(0);
  useEffect(() => {
    if (indeterminate && !reduce) spin.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1);
  }, [indeterminate, reduce, spin]);
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }));
  const shown = indeterminate ? 0.25 : Math.max(0.03, progress);

  return (
    <Animated.View style={[{ width: size, height: size }, spinStyle]}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.surface3} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={c.accent}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - shown)}
        />
      </Svg>
      <View
        style={{
          position: 'absolute',
          left: size / 2 - size * 0.14,
          top: size / 2 - size * 0.14,
          width: size * 0.28,
          height: size * 0.28,
          borderRadius: 2,
          backgroundColor: c.accent,
        }}
      />
    </Animated.View>
  );
}

/**
 * App Store style control: GET -> download ring -> installing -> OPEN.
 * INSTALL means the APK is already downloaded (the installer was closed early), so no
 * second download; UPDATE means a newer release is out.
 */
export function GetButton({ app, size = 'sm' }: { app: ListApp; size?: Size }) {
  const c = useColors();
  const qc = useQueryClient();
  const installed = useInstalled((s) => s.apps[app.id]);
  const file = useInstallers((s) => s.files[app.id]);
  const task = useTasks((s) => s.tasks[app.id]);
  const hasRelease = Boolean(app.latest_version && (app.apk_url || app.apk_assets?.length));
  const update = installed ? hasUpdate(installed, app) : false;
  const downloaded =
    file && file.version === app.latest_version && isNeeded(installerStatus(file, installed)) ? file : null;
  const lg = size === 'lg';
  const height = lg ? 44 : 30;

  const done = () => qc.invalidateQueries({ queryKey: ['app', app.id] });
  const run = async (kind: 'install' | 'update') => {
    try {
      const outcome = await installApp(app, kind);
      if (outcome !== 'cancelled') done();
    } catch (e) {
      Alert.alert(`Couldn't ${kind === 'update' ? 'update' : 'get'} ${app.name}`, friendlyError(e));
    }
  };
  const installDownloaded = async () => {
    try {
      await installFromFile(downloaded!, installed ? 'update' : 'install');
      done();
    } catch (e) {
      Alert.alert(`Couldn't install ${app.name}`, friendlyError(e));
    }
  };

  if (task?.status === 'downloading') {
    return (
      <Tap
        onPress={() => cancelDownload(app.id)}
        accessibilityRole="button"
        accessibilityLabel={`Stop downloading ${app.name}`}
        style={{ height, minWidth: lg ? 120 : 74, alignItems: 'center', justifyContent: 'center' }}
      >
        <ProgressRing progress={task.progress} size={lg ? 34 : 28} />
      </Tap>
    );
  }

  if (task?.status === 'installing') {
    return (
      <View
        accessibilityLabel={`Installing ${app.name}`}
        style={{ height, minWidth: lg ? 120 : 74, alignItems: 'center', justifyContent: 'center' }}
      >
        <DotLoader size={lg ? 4 : 3} color={c.accent} />
      </View>
    );
  }

  let label = 'GET';
  let onPress: () => void = () => run('install');
  let icon: React.ReactNode = null;
  if (!hasRelease) {
    label = 'VIEW';
    onPress = () => Linking.openURL(repoUrl(app.repo_full_name));
  } else if (downloaded) {
    label = 'INSTALL';
    onPress = installDownloaded;
  } else if (installed && update) {
    label = 'UPDATE';
    onPress = () => run('update');
  } else if (installed) {
    const canOpen = Platform.OS === 'android' && Boolean(app.package_name);
    label = canOpen ? 'OPEN' : 'INSTALLED';
    icon = canOpen ? null : <Check size={12} color={c.text2} weight="bold" />;
    onPress = () => {
      if (!openInstalledApp(app.package_name)) run('install');
    };
  }

  const primary = lg && (label === 'GET' || label === 'UPDATE' || label === 'INSTALL');

  return (
    <View style={{ alignItems: 'center' }}>
      <Tap
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label.toLowerCase()} ${app.name}`}
        style={{
          height,
          minWidth: lg ? 120 : 74,
          paddingHorizontal: lg ? 28 : 14,
          borderRadius: radius.pill,
          backgroundColor: primary ? c.invert : c.surface2,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 5,
        }}
      >
        {icon}
        <Txt
          variant="label"
          color={primary ? 'onInvert' : label === 'INSTALLED' ? 'text2' : 'text'}
          style={{ fontSize: lg ? 14 : 12, letterSpacing: 1.3, fontFamily: 'SpaceMono_700Bold' }}
        >
          {label}
        </Txt>
      </Tap>
      {!lg && downloaded ? (
        <Txt variant="label" color="accent" style={{ fontSize: 8.5, marginTop: 3 }}>
          Downloaded
        </Txt>
      ) : !lg && app.latest_prerelease && hasRelease ? (
        <Txt variant="label" color="text3" style={{ fontSize: 8.5, marginTop: 3 }}>
          Beta
        </Txt>
      ) : null}
    </View>
  );
}
