import { useFocusEffect } from 'expo-router';
import { Trash } from 'phosphor-react-native';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { Button } from '@/components/ui/button';
import { DotRule } from '@/components/ui/dots';
import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { fileSize, relativeDate, shortVersion } from '@/lib/format';
import { deleteInstaller, deleteLooseFile, installFromFile, reconcileInstallers, type LooseFile } from '@/lib/install';
import { useInstalled } from '@/lib/stores/installed';
import { installerStatus, isNeeded, useInstallers, type InstallerStatus } from '@/lib/stores/installers';
import { friendlyError } from '@/lib/supabase';
import { radius, space, useColors } from '@/theme';

/** Installer files on disk, what each one is for, and how much space is safe to free. */
export function useInstallerStorage() {
  const files = useInstallers((s) => s.files);
  const installed = useInstalled((s) => s.apps);
  const [loose, setLoose] = useState<LooseFile[]>([]);

  const refresh = useCallback(async () => {
    setLoose(await reconcileInstallers().catch(() => []));
  }, []);
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const rows = Object.values(files)
    .map((file) => ({ file, status: installerStatus(file, installed[file.appId]) }))
    .sort((a, b) => Number(isNeeded(b.status)) - Number(isNeeded(a.status)) || a.file.name.localeCompare(b.file.name));
  const unneeded = rows.filter((r) => !isNeeded(r.status));
  const reclaimableBytes =
    unneeded.reduce((sum, r) => sum + r.file.size, 0) + loose.reduce((sum, l) => sum + l.size, 0);
  const reclaimableCount = unneeded.length + loose.length;

  const clearUnneeded = () => {
    unneeded.forEach((r) => deleteInstaller(r.file.appId));
    loose.forEach((l) => deleteLooseFile(l.uri));
    refresh();
  };

  return { rows, loose, reclaimableBytes, reclaimableCount, clearUnneeded, refresh };
}

const STATUS_LABEL: Record<InstallerStatus, string> = {
  ready: 'Ready to install',
  installed: 'Installed, safe to delete',
  outdated: 'Older version, safe to delete',
};

export function InstallerList() {
  const c = useColors();
  const { rows, loose, reclaimableBytes, reclaimableCount, clearUnneeded, refresh } = useInstallerStorage();

  if (rows.length === 0 && loose.length === 0) {
    return (
      <Txt variant="callout" color="text2" style={{ paddingHorizontal: space.gutter }}>
        No installer files on this phone. ArkStore cleans up after itself.
      </Txt>
    );
  }

  return (
    <View style={{ paddingHorizontal: space.gutter }}>
      {rows.map(({ file, status }, i) => {
        const needed = isNeeded(status);
        return (
          <View key={file.appId}>
            {i > 0 ? <DotRule /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
              <AppIcon uri={file.iconUrl} name={file.name} size={44} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt variant="headline" numberOfLines={1}>
                  {file.name}
                </Txt>
                <Txt variant="mono" color="text3" numberOfLines={1} style={{ fontSize: 11 }}>
                  {shortVersion(file.version)}  ·  {fileSize(file.size)}  ·  {relativeDate(file.downloadedAt).toLowerCase()}
                </Txt>
                <Txt variant="label" color={needed ? 'accent' : 'text2'} style={{ fontSize: 9.5, marginTop: 3 }}>
                  {STATUS_LABEL[status]}
                </Txt>
              </View>
              {needed ? (
                <Button
                  label="Install"
                  size="sm"
                  onPress={() =>
                    installFromFile(file, useInstalled.getState().apps[file.appId] ? 'update' : 'install')
                      .then(refresh)
                      .catch((e) => Alert.alert(`Couldn't install ${file.name}`, friendlyError(e)))
                  }
                />
              ) : null}
              <Tap
                onPress={() => {
                  deleteInstaller(file.appId);
                  refresh();
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Delete the ${file.name} installer`}
                style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}
              >
                <Trash size={16} color={c.text2} />
              </Tap>
            </View>
          </View>
        );
      })}

      {loose.map((l) => (
        <View key={l.uri}>
          <DotRule />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt variant="headline" numberOfLines={1}>
                {l.name}
              </Txt>
              <Txt variant="label" color="text2" style={{ fontSize: 9.5, marginTop: 3 }}>
                Leftover file  ·  {fileSize(l.size)}
              </Txt>
            </View>
            <Tap
              onPress={() => {
                deleteLooseFile(l.uri);
                refresh();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${l.name}`}
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}
            >
              <Trash size={16} color={c.text2} />
            </Tap>
          </View>
        </View>
      ))}

      {reclaimableCount > 0 ? (
        <Button
          label={`Free up ${fileSize(reclaimableBytes)}`}
          variant="secondary"
          full
          style={{ marginTop: 14 }}
          onPress={clearUnneeded}
        />
      ) : null}
    </View>
  );
}

/** Small nudge on the Updates tab when installer files can be cleared. */
export function ReclaimBanner() {
  const c = useColors();
  const { reclaimableBytes, reclaimableCount, clearUnneeded } = useInstallerStorage();
  if (reclaimableCount === 0) return null;
  return (
    <View
      style={{
        marginHorizontal: space.gutter,
        marginTop: 20,
        padding: 16,
        borderRadius: radius.card,
        backgroundColor: c.surface,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Trash size={24} color={c.text2} weight="light" />
      <View style={{ flex: 1 }}>
        <Txt variant="subhead">
          {reclaimableCount} installer {reclaimableCount === 1 ? "file isn't" : "files aren't"} needed anymore
        </Txt>
        <Txt variant="caption" color="text2">
          The apps are installed. Clearing frees {fileSize(reclaimableBytes)}.
        </Txt>
      </View>
      <Button label="Clear" size="sm" onPress={clearUnneeded} />
    </View>
  );
}
