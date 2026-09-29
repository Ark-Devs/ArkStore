// Sign-in buttons for every provider the Supabase project has switched on (GitHub always;
// Google and Apple once they're enabled there), and the "Connect GitHub" prompt publishing needs.
import { AppleLogo } from 'phosphor-react-native/src/icons/AppleLogo';
import { GithubLogo } from 'phosphor-react-native/src/icons/GithubLogo';
import { GoogleLogo } from 'phosphor-react-native/src/icons/GoogleLogo';
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Txt } from '@/components/ui/text';
import { showAlert } from '@/lib/alert';
import { linkProvider, PROVIDER_LABEL, signIn, useProviders, type AuthProvider } from '@/lib/auth';
import { friendlyError } from '@/lib/supabase';
import { useColors } from '@/theme';

const ORDER: AuthProvider[] = ['github', 'google', 'apple'];

function ProviderIcon({ provider, color, size }: { provider: AuthProvider; color: string; size: number }) {
  if (provider === 'google') return <GoogleLogo size={size} color={color} weight="bold" />;
  if (provider === 'apple') return <AppleLogo size={size} color={color} weight="fill" />;
  return <GithubLogo size={size} color={color} weight="fill" />;
}

/** One button per enabled provider. `onError` shows the message inline instead of an alert. */
export function SignInButtons({
  size = 'md',
  full,
  disabled,
  onError,
  only,
}: {
  size?: 'sm' | 'md' | 'lg';
  full?: boolean;
  disabled?: boolean;
  onError?: (message: string) => void;
  only?: AuthProvider[];
}) {
  const c = useColors();
  const enabled = useProviders((s) => s.enabled);
  const [busy, setBusy] = useState<AuthProvider | null>(null);
  const providers = ORDER.filter((p) => (p === 'github' || enabled[p]) && (!only || only.includes(p)));

  const go = async (p: AuthProvider) => {
    setBusy(p);
    try {
      await signIn(p);
    } catch (e) {
      if (onError) onError(friendlyError(e));
      else showAlert("Couldn't sign in", friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const iconSize = size === 'lg' ? 20 : 14;
  return (
    <View style={{ gap: 10, flexDirection: full ? 'column' : 'row', flexWrap: 'wrap' }}>
      {providers.map((p, i) => (
        <Button
          key={p}
          label={`Sign in with ${PROVIDER_LABEL[p]}`}
          size={size}
          full={full}
          variant={i === 0 ? 'primary' : 'secondary'}
          loading={busy === p}
          disabled={disabled || (busy !== null && busy !== p)}
          icon={<ProviderIcon provider={p} size={iconSize} color={i === 0 ? c.onInvert : c.text} />}
          onPress={() => go(p)}
        />
      ))}
    </View>
  );
}

/** Adds a provider to the signed-in account (GitHub for publishing, or another way to sign in). */
export function LinkButton({ provider, size = 'sm', variant = 'secondary' }: { provider: AuthProvider; size?: 'sm' | 'md' | 'lg'; variant?: 'primary' | 'secondary' | 'accent' }) {
  const c = useColors();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      label={`Connect ${PROVIDER_LABEL[provider]}`}
      size={size}
      variant={variant}
      loading={busy}
      icon={<ProviderIcon provider={provider} size={size === 'lg' ? 20 : 14} color={variant === 'primary' ? c.onInvert : variant === 'accent' ? c.onAccent : c.text} />}
      onPress={async () => {
        setBusy(true);
        try {
          await linkProvider(provider);
        } catch (e) {
          showAlert(`Couldn't connect ${PROVIDER_LABEL[provider]}`, friendlyError(e));
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

/** Shown where publishing starts when the account has no GitHub linked yet. */
export function ConnectGitHubCard() {
  const c = useColors();
  return (
    <View style={{ borderRadius: 20, backgroundColor: c.surface, padding: 20, gap: 12 }}>
      <Txt variant="headline">Connect GitHub to publish</Txt>
      <Txt variant="callout" color="text2">
        Apps on ArkStore come from GitHub releases, so publishing needs the GitHub account that owns the repo. Your
        ArkStore account and sign-in stay the same.
      </Txt>
      <LinkButton provider="github" size="lg" variant="primary" />
    </View>
  );
}
