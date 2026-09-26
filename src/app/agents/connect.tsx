import { GithubLogo } from 'phosphor-react-native/src/icons/GithubLogo';
import { Key } from 'phosphor-react-native/src/icons/Key';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { CodeBlock } from '@/components/agents/code-block';
import { Button } from '@/components/ui/button';
import { DotRule } from '@/components/ui/dots';
import { Field } from '@/components/ui/field';
import { Chip, SectionHeader } from '@/components/ui/layout';
import { Txt } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { CLIENT_LABEL, type InstallClient } from '@/lib/agent-install';
import { ARKSTORE_MARKETPLACE_REPO, ARKSTORE_MCP_URL, useApiTokens, useTokenActions } from '@/lib/agents';
import { confirmAction, showAlert } from '@/lib/alert';
import { signInWithGitHub, useAuth } from '@/lib/auth';
import { relativeDate } from '@/lib/format';
import { friendlyError } from '@/lib/supabase';
import { radius, space, useColors } from '@/theme';

const CLIENTS: InstallClient[] = ['claude-code', 'codex', 'claude-desktop'];

function Note({ children }: { children: React.ReactNode }) {
  return (
    <Txt variant="callout" color="text2">
      {children}
    </Txt>
  );
}

function ClientSetup({ client }: { client: InstallClient }) {
  if (client === 'claude-code') {
    return (
      <View style={{ gap: 14 }}>
        <Note>The ArkStore plugin adds ArkStore&apos;s tools and teaches Claude when to use them. Inside Claude Code:</Note>
        <CodeBlock label="1. Add ArkStore's plugin marketplace" code={`/plugin marketplace add ${ARKSTORE_MARKETPLACE_REPO}`} />
        <CodeBlock label="2. Install the plugin" code="/plugin install arkstore@arkstore" />
        <Note>To let Claude publish your apps, create a token below and set it before starting Claude Code:</Note>
        <CodeBlock label="macOS / Linux" code="export ARKSTORE_TOKEN=ark_…" />
        <CodeBlock label="Windows (PowerShell)" code={'setx ARKSTORE_TOKEN "ark_…"'} />
        <Note>Only want the tools? Add the MCP server by itself:</Note>
        <CodeBlock code={`claude mcp add --transport http arkstore ${ARKSTORE_MCP_URL} --header "Authorization: Bearer $ARKSTORE_TOKEN"`} />
      </View>
    );
  }
  if (client === 'codex') {
    return (
      <View style={{ gap: 14 }}>
        <CodeBlock label="Search and browse" code={`codex mcp add arkstore --url ${ARKSTORE_MCP_URL}`} />
        <Note>To publish too, put this in ~/.codex/config.toml instead and set ARKSTORE_TOKEN to your token:</Note>
        <CodeBlock label="~/.codex/config.toml" code={`[mcp_servers.arkstore]\nurl = "${ARKSTORE_MCP_URL}"\nbearer_token_env_var = "ARKSTORE_TOKEN"`} />
      </View>
    );
  }
  return (
    <View style={{ gap: 14 }}>
      <Note>In Claude (desktop app or claude.ai): Settings → Connectors → Add custom connector, and paste:</Note>
      <CodeBlock label="Connector URL" code={ARKSTORE_MCP_URL} />
      <Note>Claude can then search ArkStore and find MCP servers. Publishing needs a token, which custom connectors can&apos;t send: publish from Claude Code, Codex or ArkStore Studio.</Note>
    </View>
  );
}

function Tokens() {
  const c = useColors();
  const session = useAuth((s) => s.session);
  const uid = session?.user.id;
  const tokens = useApiTokens(uid);
  const actions = useTokenActions(uid);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  if (!session) {
    return (
      <View style={{ gap: 12 }}>
        <Note>Sign in with GitHub to create a token. Your agent can then publish repos from your GitHub account.</Note>
        <Button
          label="Sign in with GitHub"
          icon={<GithubLogo size={18} color={c.onInvert} />}
          onPress={() => signInWithGitHub().catch((e) => showAlert("Couldn't sign in", friendlyError(e)))}
        />
      </View>
    );
  }

  const create = async () => {
    setBusy(true);
    try {
      setCreated(await actions.create(name.trim() || 'AI agent'));
      setName('');
    } catch (e) {
      showAlert("Couldn't create a token", friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string, label: string) => {
    if (!(await confirmAction('Revoke this token?', `Agents using "${label}" stop being able to publish for you.`, 'Revoke', true))) return;
    try {
      await actions.revoke(id);
    } catch (e) {
      showAlert("Couldn't revoke it", friendlyError(e));
    }
  };

  return (
    <View style={{ gap: 16 }}>
      <Note>A token lets an agent publish and update apps from your GitHub account. Treat it like a password: keep it out of chats and repos.</Note>
      {created ? (
        <View style={{ gap: 10, padding: 14, borderRadius: radius.tile, borderWidth: 1, borderColor: c.accent }}>
          <Txt variant="headline">Copy your token now</Txt>
          <Note>ArkStore only keeps a fingerprint of it, so it can&apos;t show it again.</Note>
          <CodeBlock code={created} />
          <Button label="Done" variant="secondary" size="sm" onPress={() => setCreated(null)} />
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <Field label="Token name" value={name} onChangeText={setName} maxLength={40} placeholder="Claude Code on my laptop" />
          <Button label="Create token" icon={<Key size={18} color={c.onInvert} />} loading={busy} onPress={create} />
        </View>
      )}

      {(tokens.data ?? []).map((t, i) => (
        <View key={t.id}>
          {i > 0 ? <DotRule /> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt variant="headline" numberOfLines={1}>
                {t.name}
              </Txt>
              <Txt variant="mono" color="text3" style={{ fontSize: 11 }}>
                {`${t.prefix}…  ·  created ${relativeDate(t.created_at)}  ·  ${t.last_used_at ? `used ${relativeDate(t.last_used_at)}` : 'never used'}`}
              </Txt>
            </View>
            <Button label="Revoke" variant="ghost" size="sm" onPress={() => revoke(t.id, t.name)} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Connect Claude Code, Codex or Claude to ArkStore's MCP server, and manage agent tokens. */
export default function ConnectAgentScreen() {
  const c = useColors();
  const [client, setClient] = useState<InstallClient>('claude-code');

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TopBar />
      <ScrollView contentContainerStyle={{ paddingBottom: 80, gap: 26 }} keyboardShouldPersistTaps="handled">
        <View style={{ paddingHorizontal: space.gutter, gap: 8 }}>
          <Txt variant="label" color="text2">
            ArkStore MCP server
          </Txt>
          <Txt variant="display" accessibilityRole="header">
            Connect your agent
          </Txt>
          <Txt variant="callout" color="text2">
            Before your agent builds an app, it can check whether one already exists on ArkStore. It can also find MCP servers and plugins with
            install commands, and publish your app once it has a GitHub release.
          </Txt>
        </View>

        <View>
          <SectionHeader title="Set it up" />
          <View style={{ paddingHorizontal: space.gutter, gap: 16 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {CLIENTS.map((k) => (
                <Chip key={k} label={k === 'claude-desktop' ? 'Claude app' : CLIENT_LABEL[k]} active={client === k} onPress={() => setClient(k)} />
              ))}
            </View>
            <ClientSetup client={client} />
          </View>
        </View>

        <View>
          <SectionHeader title="Agent tokens" />
          <View style={{ paddingHorizontal: space.gutter }}>
            <Tokens />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
