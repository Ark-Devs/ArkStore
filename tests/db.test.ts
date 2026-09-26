// Runs the real Supabase migration inside PGlite, with small stand-ins for the pieces
// Supabase provides (auth, storage, the http extension). GitHub responses are mocked.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

import { classifyAsset } from '../src/lib/github/assets';

const root = join(import.meta.dirname, '..');
// Every migration except the ones that need real Supabase extensions (http, pg_cron).
const schemaSql = readdirSync(join(root, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql') && !/extensions|cron/.test(f))
  .sort()
  .map((f) => readFileSync(join(root, 'supabase/migrations', f), 'utf8'))
  .join('\n');

const ALICE = '00000000-0000-4000-8000-00000000a11c';
const BOB = '00000000-0000-4000-8000-000000000b0b';

const supabaseStubs = /* sql */ `
  create role anon nologin;
  create role authenticated nologin;

  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create table auth.identities (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users (id),
    provider text,
    provider_id text,
    identity_data jsonb
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create table auth.sessions (id uuid primary key, user_id uuid references auth.users (id));
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant execute on function auth.jwt() to anon, authenticated;

  create schema extensions;
  create type extensions.http_header as (field varchar, value varchar);
  create type extensions.http_request as (
    method text, uri varchar, headers extensions.http_header[], content_type varchar, content varchar
  );
  create type extensions.http_response as (
    status integer, content_type varchar, headers extensions.http_header[], content varchar
  );
  create table extensions.http_mock (uri text primary key, status integer, body text, etag text);
  create table extensions.http_log (uri text, headers extensions.http_header[]);
  create function extensions.http(req extensions.http_request) returns extensions.http_response
  language plpgsql as $$
  declare
    m record;
  begin
    insert into extensions.http_log (uri, headers) values (req.uri, req.headers);
    select * into m from extensions.http_mock where uri = req.uri;
    if not found then
      return row(404, 'application/json', array[]::extensions.http_header[], '{"message":"Not Found"}')::extensions.http_response;
    end if;
    if m.etag is not null and exists (
      select 1 from unnest(req.headers) h where h.field = 'If-None-Match' and h.value = m.etag
    ) then
      return row(304, null, array[row('ETag', m.etag)::extensions.http_header], '')::extensions.http_response;
    end if;
    return row(
      m.status,
      'application/json',
      case when m.etag is null then array[]::extensions.http_header[]
           else array[row('ETag', m.etag)::extensions.http_header] end,
      m.body
    )::extensions.http_response;
  end;
  $$;

  create schema storage;
  create table storage.buckets (
    id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
`;

const api = (path: string) => `https://api.github.com${path}`;

function repoJson(fullName: string, extra: Record<string, unknown> = {}) {
  const [owner, name] = fullName.split('/');
  return {
    full_name: fullName,
    name,
    private: false,
    homepage: '',
    stargazers_count: 1234,
    topics: ['android', 'notes'],
    license: { spdx_id: 'GPL-3.0' },
    owner: { login: owner, avatar_url: `https://avatars.githubusercontent.com/${owner}` },
    ...extra,
  };
}

function release(tag: string, assets: string[], extra: Record<string, unknown> = {}) {
  return {
    tag_name: tag,
    name: `Release ${tag}`,
    body: `Changes in ${tag}`,
    draft: false,
    prerelease: false,
    published_at: '2026-09-01T10:00:00Z',
    assets: assets.map((name, i) => ({
      name,
      size: 1_000_000 + i,
      browser_download_url: `https://github.com/x/y/releases/download/${tag}/${name}`,
    })),
    ...extra,
  };
}

describe('supabase schema', () => {
  let db: PGlite;

  async function mock(path: string, status: number, body: unknown, etag: string | null = null) {
    await db.query(
      `insert into extensions.http_mock (uri, status, body, etag) values ($1, $2, $3, $4)
       on conflict (uri) do update set status = excluded.status, body = excluded.body, etag = excluded.etag`,
      [api(path), status, JSON.stringify(body), etag],
    );
  }

  // Run statements as a client role, the way PostgREST does. `session` is the JWT's session_id.
  async function as<T = any>(uid: string | null, sql: string, params: unknown[] = [], session: string | null = null) {
    const role = uid ? 'authenticated' : 'anon';
    const claims = JSON.stringify(uid ? { sub: uid, session_id: session } : {});
    await db.exec(`set role ${role}; set request.jwt.claim.sub = '${uid ?? ''}'; set request.jwt.claims = '${claims}';`);
    try {
      return await db.query<T>(sql, params);
    } finally {
      await db.exec(`reset role; set request.jwt.claim.sub = ''; set request.jwt.claims = '';`);
    }
  }

  const publish = (uid: string, payload: Record<string, unknown>, token: string | null = null) =>
    as(uid, 'select * from public.publish_app($1::jsonb, $2)', [JSON.stringify(payload), token]);

  before(async () => {
    db = new PGlite();
    await db.exec(supabaseStubs);
    await db.exec(schemaSql);
    await db.exec(`
      insert into auth.users (id, email) values ('${ALICE}', 'alice@example.com'), ('${BOB}', 'bob@example.com');
      insert into auth.identities (user_id, provider, provider_id, identity_data) values
        ('${ALICE}', 'github', '101', '{"user_name": "alice"}'),
        ('${BOB}', 'github', '202', '{"user_name": "bob"}');
    `);

    await mock('/repos/alice/notes', 200, repoJson('alice/notes'));
    await mock(
      '/repos/alice/notes/releases?per_page=15',
      200,
      [
        release('v2.0.0-beta', ['notes-universal.apk'], { prerelease: true, published_at: '2026-09-10T00:00:00Z' }),
        release('v1.4.0', ['notes-arm64-v8a.apk', 'notes-universal.apk', 'notes-armeabi-v7a.apk']),
        release('v1.3.0', ['notes.apk'], { published_at: '2026-08-01T00:00:00Z' }),
      ],
      '"etag-1"',
    );
    await mock('/repos/alice/server', 200, repoJson('alice/server'));
    await mock('/repos/alice/server/releases?per_page=15', 200, [release('v1', ['server.tar.gz'])]);
    await mock('/repos/bob/app', 200, repoJson('bob/app'));
    await mock('/repos/bob/app/releases?per_page=15', 200, [release('1.0', ['app.apk'])]);
    await mock(
      '/repos/Ark-Devs/DB-Crawler',
      200,
      repoJson('Ark-Devs/DB-Crawler', { permissions: { admin: false, maintain: false, push: true } }),
    );
    await mock('/repos/Ark-Devs/DB-Crawler/releases?per_page=15', 200, [release('v0.3', ['db-crawler.apk'])]);
    await mock('/user', 200, { id: 101, login: 'alice' });
  });

  after(async () => {
    await db.close();
  });

  test('normalize_repo accepts URLs, remotes and slugs', async () => {
    const inputs = [
      ['https://github.com/Ark-Devs/DB-Crawler', 'Ark-Devs/DB-Crawler'],
      ['git@github.com:Ark-Devs/DB-Crawler.git', 'Ark-Devs/DB-Crawler'],
      ['github.com/alice/notes/releases/tag/v1', 'alice/notes'],
      ['alice/notes', 'alice/notes'],
      ['not a repo', null],
      ['https://gitlab.com/a/b', null],
    ];
    for (const [input, expected] of inputs) {
      const { rows } = await db.query<{ r: string | null }>('select arkstore_private.normalize_repo($1) r', [input]);
      assert.equal(rows[0].r, expected, `input ${input}`);
    }
  });

  test('pick_apk prefers universal, then ABI-less, then arm64, never debug first', async () => {
    const cases: [string[], string][] = [
      [['a-arm64-v8a.apk', 'a-universal.apk', 'a-x86.apk'], 'a-universal.apk'],
      [['a-armeabi-v7a.apk', 'a-arm64-v8a.apk'], 'a-arm64-v8a.apk'],
      [['a-debug.apk', 'a-arm64-v8a.apk'], 'a-arm64-v8a.apk'],
      [['app-release.apk', 'app-arm64-v8a-release.apk'], 'app-release.apk'],
      [['notes.zip', 'checksums.txt'], ''],
    ];
    for (const [names, expected] of cases) {
      const assets = names.map((name) => ({ name, size: 10 }));
      const { rows } = await db.query<{ n: string | null }>(
        `select arkstore_private.pick_apk($1::jsonb) ->> 'name' n`,
        [JSON.stringify(assets)],
      );
      assert.equal(rows[0].n ?? '', expected, names.join(','));
    }
  });

  test('owner publishes a repo; latest stable APK release is recorded', async () => {
    const { rows } = await publish(ALICE, {
      repo: 'https://github.com/alice/notes',
      name: 'Notes',
      subtitle: 'Plain text notes',
      description: 'Write things down.',
      category: 'productivity',
      icon_url: 'https://raw.githubusercontent.com/alice/notes/main/icon.png',
      screenshots: ['https://example.com/1.png', 'javascript:alert(1)', 'http://insecure.png'],
    });
    const app = rows[0] as any;
    assert.equal(app.repo_full_name, 'alice/notes');
    assert.equal(app.owner_id, ALICE);
    assert.equal(app.latest_version, 'v1.4.0', 'prerelease skipped');
    assert.equal(app.apk_name, 'notes-universal.apk');
    assert.equal(app.stars, 1234);
    assert.deepEqual(app.screenshots, ['https://example.com/1.png']);

    const versions = await db.query<{ version: string }>(
      'select version from public.app_versions where app_id = $1',
      [app.id],
    );
    assert.deepEqual(versions.rows.map((r) => r.version), ['v1.4.0']);
  });

  test("publishing someone else's repo is refused", async () => {
    await assert.rejects(
      publish(ALICE, { repo: 'bob/app', name: 'App', category: 'tools' }),
      /not_repo_owner/,
    );
  });

  test('a release with nothing installable cannot be published', async () => {
    await assert.rejects(
      publish(ALICE, { repo: 'alice/server', name: 'Server', category: 'tools' }),
      /no_apk_release/,
    );
  });

  test('beta-only projects are listed with their newest prerelease, flagged as beta', async () => {
    await mock('/repos/alice/beta', 200, repoJson('alice/beta'));
    await mock('/repos/alice/beta/releases?per_page=15', 200, [
      release('v0.1.0-beta', ['beta-arm64-v8a.apk', 'beta-universal.apk', 'beta.ipa'], {
        prerelease: true,
        published_at: '2026-08-10T00:00:00Z',
      }),
      release('v0.0.9-beta', ['beta-universal.apk'], { prerelease: true, published_at: '2026-08-09T00:00:00Z' }),
    ]);
    const { rows } = await publish(ALICE, { repo: 'alice/beta', name: 'Beta', category: 'developer' });
    const app = rows[0] as any;
    assert.equal(app.latest_version, 'v0.1.0-beta');
    assert.equal(app.latest_prerelease, true);
    assert.equal(app.apk_name, 'beta-universal.apk');
    assert.deepEqual(
      app.apk_assets.map((a: any) => a.name),
      ['beta-arm64-v8a.apk', 'beta-universal.apk'],
      'every APK is kept (not the .ipa) so phones can pick their build',
    );
  });

  test('bad input is rejected before calling GitHub', async () => {
    await assert.rejects(publish(ALICE, { repo: 'alice/notes', name: '', category: 'tools' }), /invalid_name/);
    await assert.rejects(publish(ALICE, { repo: 'alice/notes', name: 'X', category: 'nope' }), /invalid_category/);
    await assert.rejects(publish(ALICE, { repo: '???', name: 'X', category: 'tools' }), /invalid_repo/);
  });

  test('org repos need a token that belongs to the caller and has push access', async () => {
    const payload = { repo: 'git@github.com:Ark-Devs/DB-Crawler.git', name: 'DB Crawler', category: 'developer' };
    await assert.rejects(publish(ALICE, payload), /not_repo_owner/);

    // Token belongs to alice (id 101) but bob is calling.
    await assert.rejects(publish(BOB, payload, 'gho_alice'), /not_repo_owner/);

    const { rows } = await publish(ALICE, payload, 'gho_alice');
    assert.equal((rows[0] as any).repo_full_name, 'Ark-Devs/DB-Crawler');
    assert.equal((rows[0] as any).developer_login, 'Ark-Devs');

    const log = await db.query<{ n: number }>(
      `select count(*)::int n from extensions.http_log l, unnest(l.headers) h
       where h.field = 'Authorization' and h.value = 'Bearer gho_alice'`,
    );
    assert.ok(log.rows[0].n > 0, 'user token was sent to GitHub');
  });

  test('curated listings can be claimed by the repo owner, not by others', async () => {
    await mock('/repos/alice/claimme', 200, repoJson('alice/claimme'));
    await mock('/repos/alice/claimme/releases?per_page=15', 200, [release('3.1', ['claimme.apk'])]);
    await db.exec(`
      insert into public.apps (source, repo_full_name, name, category, developer_login, downloads)
      values ('curated', 'alice/claimme', 'Claim Me', 'tools', 'alice', 77);
    `);
    await assert.rejects(publish(BOB, { repo: 'alice/claimme', name: 'Mine', category: 'tools' }), /not_repo_owner/);

    const { rows } = await publish(ALICE, { repo: 'alice/claimme', name: 'Claimed', category: 'tools' });
    const app = rows[0] as any;
    assert.equal(app.owner_id, ALICE);
    assert.equal(app.source, 'developer');
    assert.equal(app.name, 'Claimed');
    assert.equal(Number(app.downloads), 77, 'download history survives the claim');
  });

  test('owners edit presentation fields only; protected columns stay put', async () => {
    for (const column of ["downloads = 999999", "latest_version = 'v9'", 'featured = true', "apk_url = 'https://evil'"]) {
      await assert.rejects(
        as(ALICE, `update public.apps set ${column} where repo_full_name = 'alice/notes'`),
        /permission denied/,
        column,
      );
    }

    const { rows } = await as(
      ALICE,
      `update public.apps set name = 'Notes+', icon_url = 'javascript:alert(1)',
         screenshots = array['https://ok.png', 'ftp://bad']
       where repo_full_name = 'alice/notes' returning *`,
    );
    const app = rows[0] as any;
    assert.equal(app.name, 'Notes+');
    assert.equal(Number(app.downloads), 0);
    assert.equal(app.latest_version, 'v1.4.0');
    assert.equal(app.icon_url, null);
    assert.deepEqual(app.screenshots, ['https://ok.png']);
  });

  test("other users can't edit or delete an app they don't own", async () => {
    const upd = await as(BOB, `update public.apps set name = 'pwned' where repo_full_name = 'alice/notes'`);
    assert.equal(upd.affectedRows, 0);
    const del = await as(BOB, `delete from public.apps where repo_full_name = 'alice/notes'`);
    assert.equal(del.affectedRows, 0);
  });

  test('hidden apps disappear for everyone except the owner', async () => {
    await as(ALICE, `update public.apps set status = 'hidden' where repo_full_name = 'alice/notes'`);
    const anon = await as(null, `select id from public.apps where repo_full_name = 'alice/notes'`);
    assert.equal(anon.rows.length, 0);
    const owner = await as(ALICE, `select id from public.apps where repo_full_name = 'alice/notes'`);
    assert.equal(owner.rows.length, 1);
    await as(ALICE, `update public.apps set status = 'published' where repo_full_name = 'alice/notes'`);
  });

  test('downloads and confirmed installs are counted separately, once per device and version', async () => {
    const { rows } = await db.query<{ id: string }>(`select id from public.apps where repo_full_name = 'alice/notes'`);
    const id = rows[0].id;
    const rec = (device: string, kind: string, version: string) =>
      as(null, 'select public.record_download($1, $2, $3, $4) total', [id, device, kind, version]);

    // The APK finishes downloading on two phones (one taps twice).
    assert.equal(Number((await rec('device-0001', 'download', 'v1.4.0')).rows[0].total), 1);
    assert.equal(Number((await rec('device-0001', 'download', 'v1.4.0')).rows[0].total), 1, 'repeat ignored');
    assert.equal(Number((await rec('device-0002', 'download', 'v1.4.0')).rows[0].total), 2);
    // Only the first phone finishes installing; later it updates.
    assert.equal(Number((await rec('device-0001', 'install', 'v1.4.0')).rows[0].total), 2, 'installs are not downloads');
    await rec('device-0001', 'install', 'v1.4.0');
    await rec('device-0001', 'download', 'v1.5.0');
    await rec('device-0001', 'update', 'v1.5.0');
    await assert.rejects(rec('x', 'install', 'v1'), /invalid_device/);
    await assert.rejects(rec('device-0003', 'sideload', 'v1'), /invalid_kind/);

    const app = (await as(null, 'select downloads, installs from public.apps where id = $1', [id])).rows[0] as any;
    assert.equal(Number(app.downloads), 3);
    assert.equal(Number(app.installs), 1);

    const stats = await as(ALICE, 'select downloads, installs, updates from public.app_download_stats where app_id = $1', [id]);
    assert.deepEqual(stats.rows[0], { downloads: 3, installs: 1, updates: 1 });
    const bobStats = await as(BOB, 'select * from public.app_download_stats where app_id = $1', [id]);
    assert.equal(bobStats.rows.length, 0, 'stats are private to the owner');

    await assert.rejects(as(ALICE, 'update public.apps set installs = 9999 where id = $1', [id]), /permission denied/);
  });

  test('client roles cannot reach private tables or call publish anonymously', async () => {
    await assert.rejects(as(ALICE, 'select * from arkstore_private.download_events'), /permission denied/);
    await assert.rejects(
      as(null, `select public.publish_app('{}'::jsonb, null)`),
      /permission denied/,
    );
    await assert.rejects(as(ALICE, `select arkstore_private.sync_all()`), /permission denied/);
  });

  test('sync picks up new GitHub releases and uses ETags', async () => {
    // Nothing changed: GitHub answers 304 thanks to the stored ETag.
    await db.exec(`update public.apps set last_synced_at = null, release_etag = '"etag-1"' where repo_full_name = 'alice/notes'`);
    await db.exec('delete from extensions.http_log');
    await db.query('select arkstore_private.sync_all()');
    let app = (await db.query<any>(`select * from public.apps where repo_full_name = 'alice/notes'`)).rows[0];
    assert.equal(app.latest_version, 'v1.4.0');
    assert.equal(app.release_etag, '"etag-1"');

    // Developer ships v1.5.0.
    await mock(
      '/repos/alice/notes/releases?per_page=15',
      200,
      [
        release('v1.5.0', ['notes-v1.5.0.apk'], { published_at: '2026-09-15T00:00:00Z' }),
        release('v1.4.0', ['notes-universal.apk']),
      ],
      '"etag-2"',
    );
    await db.query('select arkstore_private.sync_all()');
    app = (await db.query<any>(`select * from public.apps where repo_full_name = 'alice/notes'`)).rows[0];
    assert.equal(app.latest_version, 'v1.5.0');
    assert.equal(app.apk_name, 'notes-v1.5.0.apk');
    assert.equal(app.release_etag, '"etag-2"');

    const versions = await db.query<{ version: string }>(
      'select version from public.app_versions where app_id = $1 order by published_at desc',
      [app.id],
    );
    assert.deepEqual(versions.rows.map((r) => r.version), ['v1.5.0', 'v1.4.0']);
  });

  test('sync stops when GitHub rate limits', async () => {
    await db.exec('update public.apps set last_synced_at = null, release_etag = null');
    await mock('/repos/alice/notes/releases?per_page=15', 403, { message: 'API rate limit exceeded' });
    const { rows } = await db.query<{ n: number }>('select arkstore_private.sync_all() n');
    assert.ok(rows[0].n < 3, `stopped early, checked ${rows[0].n}`);
  });

  test('refresh_app is owner-only', async () => {
    const { rows } = await db.query<{ id: string }>(`select id from public.apps where repo_full_name = 'bob/app'`);
    assert.equal(rows.length, 0);
    const notes = (await db.query<{ id: string }>(`select id from public.apps where repo_full_name = 'alice/claimme'`)).rows[0];
    await assert.rejects(as(BOB, 'select * from public.refresh_app($1)', [notes.id]), /not_app_owner/);
    const ok = await as(ALICE, 'select * from public.refresh_app($1)', [notes.id]);
    assert.equal((ok.rows[0] as any).latest_version, '3.1');
  });

  test('generated seed loads on top of the schema and is claimable', async () => {
    const seed = readFileSync(join(root, 'supabase/seed.sql'), 'utf8');
    await db.exec(seed);
    await db.exec(seed); // re-running is harmless
    const { rows } = await db.query<any>(
      `select count(*)::int n, count(*) filter (where source = 'curated')::int curated from public.apps`,
    );
    assert.ok(rows[0].curated >= 10, `seeded ${rows[0].curated} apps`);

    // An earlier test published DB-Crawler as Alice; the seed must not take it back.
    const crawler = (
      await as(null, `select * from public.apps where repo_full_name = 'Ark-Devs/DB-Crawler'`)
    ).rows[0] as any;
    assert.equal(crawler.owner_id, ALICE, 'seed never overwrites a listing a developer owns');

    const seal = (await as(null, `select * from public.apps where repo_full_name = 'JunkFood02/Seal'`)).rows[0] as any;
    assert.ok(seal, 'curated listings are publicly visible');
    assert.equal(seal.owner_id, null);
    assert.equal(seal.source, 'curated');
    const versions = await as(null, 'select version from public.app_versions where app_id = $1', [seal.id]);
    assert.ok(versions.rows.length >= 2, 'version history is seeded');

    assert.equal(crawler.name, 'DB Crawler', "the owner's name edits survive a re-seed");

    await db.exec(`delete from public.apps where repo_full_name = 'Ark-Devs/DB-Crawler'`);
    await db.exec(seed);
    const fresh = (await db.query<any>(`select * from public.apps where repo_full_name = 'Ark-Devs/DB-Crawler'`)).rows[0];
    assert.equal(fresh.owner_id, null);
    assert.equal(fresh.latest_prerelease, true);
    assert.equal(fresh.featured, true, 'featured in seed-repos.txt');
    assert.ok(fresh.apk_assets.length >= 3, 'per-ABI builds are stored');

    // Re-seeding refreshes an unclaimed listing's text but never rolls back newer release data.
    await db.exec(`update public.apps set name = 'Old name', latest_version = 'v9.9.9', featured = false
                   where repo_full_name = 'Ark-Devs/DB-Crawler'`);
    await db.exec(seed);
    const again = (await db.query<any>(`select * from public.apps where repo_full_name = 'Ark-Devs/DB-Crawler'`)).rows[0];
    assert.equal(again.name, 'DB Crawler');
    assert.equal(again.featured, true);
    assert.equal(again.latest_version, 'v9.9.9', 'release data belongs to the sync job');
  });

  test('release files are classified the same way in the app and the database', async () => {
    const names = [
      'notes-arm64-v8a.apk',
      'Notes-Setup-1.2.0.exe',
      'notes-1.2.0-x64.msi',
      'Notes_1.2.0_x64.msixbundle',
      'Notes-1.2.0-universal.dmg',
      'Notes-1.2.0-arm64.pkg',
      'Notes-1.2.0-mac-arm64.zip',
      'notes-darwin-x64.zip',
      'notes-win64.zip',
      'notes-windows-arm64.zip',
      'Notes-1.2.0-x86_64.AppImage',
      'notes_1.2.0_amd64.deb',
      'notes-1.2.0.aarch64.rpm',
      'notes.flatpak',
      'notes-linux-armhf.tar.gz',
      'notes-macos.tar.xz',
      'notes-machine.zip',
      'source.tar.gz',
      'checksums.txt',
      'latest.yml',
      'Notes-Setup-1.2.0.exe.blockmap',
      'notes-i686.AppImage',
    ];
    for (const name of names) {
      const { rows } = await db.query<{ os: string | null; arch: string | null }>(
        'select arkstore_private.asset_os($1) os, arkstore_private.asset_arch($1) arch',
        [name],
      );
      const ts = classifyAsset(name);
      assert.equal(rows[0].os, ts?.os ?? null, `os of ${name}`);
      if (ts) assert.equal(rows[0].arch, ts.arch, `arch of ${name}`);
    }
  });

  test('desktop-only releases can be published and are tagged with their platforms', async () => {
    await mock('/repos/alice/desk', 200, repoJson('alice/desk'));
    await mock('/repos/alice/desk/releases?per_page=15', 200, [
      release('v2.0.0', [
        'Desk-Setup-2.0.0.exe',
        'Desk-2.0.0-arm64.dmg',
        'Desk-2.0.0-x86_64.AppImage',
        'desk_2.0.0_amd64.deb',
        'latest.yml',
        'Desk-Setup-2.0.0.exe.blockmap',
        'source.tar.gz',
      ]),
    ]);
    const { rows } = await publish(ALICE, { repo: 'alice/desk', name: 'Desk', category: 'productivity' });
    const app = rows[0] as any;
    assert.equal(app.latest_version, 'v2.0.0');
    assert.equal(app.apk_url, null, 'no APK, and that is fine');
    assert.deepEqual(app.platforms, ['windows', 'macos', 'linux']);
    assert.deepEqual(
      app.assets.map((a: any) => [a.name, a.os, a.arch]),
      [
        ['Desk-2.0.0-arm64.dmg', 'macos', 'arm64'],
        ['Desk-2.0.0-x86_64.AppImage', 'linux', 'x64'],
        ['Desk-Setup-2.0.0.exe', 'windows', null],
        ['desk_2.0.0_amd64.deb', 'linux', 'x64'],
      ],
    );
    const v = await db.query<any>('select assets from public.app_versions where app_id = $1', [app.id]);
    assert.equal(v.rows[0].assets.length, 4);

    // Filtering the catalog by platform, the way the Windows app does.
    const win = await as(null, `select repo_full_name from public.apps where platforms @> array['windows']`);
    assert.ok(win.rows.some((r: any) => r.repo_full_name === 'alice/desk'));
    assert.ok(!win.rows.some((r: any) => r.repo_full_name === 'alice/notes'), 'Android-only apps stay out');

    await assert.rejects(as(ALICE, `update public.apps set platforms = '{android}' where id = $1`, [app.id]), /permission denied/);
    await assert.rejects(as(ALICE, `update public.apps set assets = '[]' where id = $1`, [app.id]), /permission denied/);
  });

  test('APK listings are tagged android, also when written with apk_assets only (seed)', async () => {
    const notes = (await db.query<any>(`select platforms, assets from public.apps where repo_full_name = 'alice/notes'`)).rows[0];
    assert.deepEqual(notes.platforms, ['android']);
    assert.ok(notes.assets.every((a: any) => a.os === 'android'));

    await db.exec(`
      insert into public.apps (source, repo_full_name, name, category, developer_login, apk_assets)
      values ('curated', 'carol/seeded', 'Seeded', 'tools', 'carol',
              '[{"name": "s-arm64-v8a.apk", "url": "https://x/s.apk", "size": 5}]');
    `);
    const seeded = (await db.query<any>(`select platforms, assets from public.apps where repo_full_name = 'carol/seeded'`)).rows[0];
    assert.deepEqual(seeded.platforms, ['android']);
    assert.equal(seeded.assets[0].arch, 'arm64');
    await db.exec(`delete from public.apps where repo_full_name = 'carol/seeded'`);
  });

  test('signed-in devices: listed per account, signed out remotely, private to their owner', async () => {
    const S1 = '00000000-0000-4000-8000-000000000051';
    const S2 = '00000000-0000-4000-8000-000000000052';
    await db.exec(`insert into auth.sessions (id, user_id) values ('${S1}', '${ALICE}'), ('${S2}', '${ALICE}')`);
    const register = (sid: string, device: string, platform: string, name: string) =>
      as(ALICE, 'select public.register_device($1, $2, $3, $4, $5, $6) r', [device, platform, name, '11', 'x64', '1.2.0'], sid);

    assert.equal((await register(S1, 'phone-000000001', 'android', 'Pixel 8')).rows[0].r, 'ok');
    assert.equal((await register(S2, 'laptop-00000001', 'windows', 'DESK-PC')).rows[0].r, 'ok');
    await register(S2, 'laptop-00000001', 'windows', 'DESK-PC'); // check-ins don't duplicate

    const mine = await as(ALICE, 'select device_id, platform, name, session_id from public.user_devices order by platform');
    assert.deepEqual(mine.rows.map((r: any) => [r.platform, r.name]), [['android', 'Pixel 8'], ['windows', 'DESK-PC']]);
    const bobs = await as(BOB, 'select * from public.user_devices');
    assert.equal(bobs.rows.length, 0, "other people can't see your devices");

    await assert.rejects(
      as(ALICE, `insert into public.user_devices (user_id, device_id, platform) values ($1, 'forged-device', 'linux')`, [ALICE]),
      /permission denied/,
    );
    await assert.rejects(as(null, `select public.register_device('anon-device-1', 'web')`), /permission denied/);
    await assert.rejects(register(S1, 'x', 'android', 'bad'), /invalid_device/);
    await assert.rejects(register(S1, 'phone-000000002', 'toaster', 'bad'), /invalid_platform/);

    // Sign the laptop out from the phone.
    const laptop = (await as(ALICE, `select id from public.user_devices where device_id = 'laptop-00000001'`)).rows[0] as any;
    await assert.rejects(as(BOB, 'select public.sign_out_device($1)', [laptop.id]), /device_not_found/);
    await as(ALICE, 'select public.sign_out_device($1)', [laptop.id], S1);
    const sessions = await db.query<any>(`select id from auth.sessions where user_id = '${ALICE}'`);
    assert.deepEqual(sessions.rows.map((r) => r.id), [S1], "the laptop's session is revoked");

    // The laptop checks in with its old session and learns it was signed out.
    assert.equal((await register(S2, 'laptop-00000001', 'windows', 'DESK-PC')).rows[0].r, 'signed_out');
    // Signing in again (new session) brings it back.
    const S3 = '00000000-0000-4000-8000-000000000053';
    assert.equal((await register(S3, 'laptop-00000001', 'windows', 'DESK-PC')).rows[0].r, 'ok');
    const back = (await as(ALICE, `select signed_out_at from public.user_devices where device_id = 'laptop-00000001'`)).rows[0] as any;
    assert.equal(back.signed_out_at, null);

    // Signing out on the phone itself removes it from the list.
    await as(ALICE, 'select public.forget_device($1)', ['phone-000000001'], S1);
    const left = await as(ALICE, 'select device_id from public.user_devices');
    assert.deepEqual(left.rows.map((r: any) => r.device_id), ['laptop-00000001']);
  });

  test('agents: tokens are hashed, private to their owner, and publish only the owner’s repos', async () => {
    await mock('/repos/alice/pdf-studio', 200, repoJson('alice/pdf-studio', { description: 'Edit PDF files on your desktop', topics: ['pdf', 'desktop'] }));
    await mock('/repos/alice/pdf-studio/releases?per_page=15', 200, [release('v2.1', ['PDF-Studio-2.1-windows-x64.exe', 'pdf-studio_2.1_amd64.deb'])]);

    await assert.rejects(as(null, `select * from public.create_api_token('x')`), /permission denied/);
    const created = (await as(ALICE, `select * from public.create_api_token('Claude Code')`)).rows[0] as any;
    assert.match(created.token, /^ark_[0-9a-f]{64}$/);
    const stored = (await db.query<any>('select * from public.api_tokens')).rows;
    assert.equal(stored.length, 1);
    assert.equal(stored[0].name, 'Claude Code');
    assert.notEqual(stored[0].token_hash, created.token, 'only the hash is kept');
    assert.equal((await as(BOB, 'select * from public.api_tokens')).rows.length, 0, "other people can't see your tokens");
    assert.equal((await as(ALICE, 'select * from public.api_tokens')).rows.length, 1);

    // What the MCP server does with it (as anon, with the token as the only credential).
    await assert.rejects(as(null, `select public.mcp_whoami('ark_nope')`), /invalid_token/);
    const who = (await as(null, 'select public.mcp_whoami($1) as w', [created.token])).rows[0] as any;
    assert.equal(who.w.github_login, 'alice');

    await assert.rejects(as(null, `select * from public.mcp_publish($1, '{"repo": "bob/app"}')`, [created.token]), /not_repo_owner/);
    const app = (await as(null, `select * from public.mcp_publish($1, '{"repo": "https://github.com/alice/pdf-studio", "name": ""}')`, [created.token])).rows[0] as any;
    assert.equal(app.owner_id, ALICE);
    assert.equal(app.name, 'pdf-studio', 'empty values fall back to the repo');
    assert.equal(app.subtitle, 'Edit PDF files on your desktop');
    assert.equal(app.category, 'productivity', 'category guessed from the repo');
    assert.deepEqual([...app.platforms].sort(), ['linux', 'windows']);

    const mine = (await as(null, 'select repo_full_name from public.mcp_my_apps($1)', [created.token])).rows.map((r: any) => r.repo_full_name);
    assert.ok(mine.includes('alice/pdf-studio'));
    const used = (await db.query<any>('select last_used_at from public.api_tokens')).rows[0];
    assert.ok(used.last_used_at, 'last use is recorded');

    // Revoking works and the token stops working.
    await as(ALICE, 'delete from public.api_tokens');
    await assert.rejects(as(null, 'select public.mcp_whoami($1)', [created.token]), /invalid_token/);
  });

  test('agents: search_apps finds apps by what they do; search_agent_tools finds MCP servers and plugins', async () => {
    const hits = (await as(null, `select repo_full_name from public.search_apps('pdf editor', 'linux')`)).rows.map((r: any) => r.repo_full_name);
    assert.equal(hits[0], 'alice/pdf-studio');
    const android = (await as(null, `select repo_full_name from public.search_apps('pdf editor', 'android')`)).rows.map((r: any) => r.repo_full_name);
    assert.ok(!android.includes('alice/pdf-studio'), 'platform filter');

    await db.exec(`
      insert into public.agent_tools (key, kind, source, name, title, description, packages) values
        ('mcp:io.github.acme/pg', 'mcp', 'registry', 'pg', 'Postgres', 'Query PostgreSQL databases', '[{"registryType":"npm","identifier":"@acme/pg-mcp","version":"1.2.0"}]'),
        ('plugin:market/review', 'plugin', 'marketplace', 'review', 'Review', 'Code review for pull requests', '[]');
      insert into public.agent_tools (key, kind, source, name, title, description, status) values
        ('mcp:io.github.acme/old', 'mcp', 'registry', 'old', 'Old Postgres', 'Deprecated postgres server', 'hidden');
    `);
    const tools = (await as(null, `select key from public.search_agent_tools('postgres')`)).rows.map((r: any) => r.key);
    assert.deepEqual(tools, ['mcp:io.github.acme/pg'], 'hidden entries stay out');
    const plugins = (await as(null, `select key from public.search_agent_tools(null, 'plugin')`)).rows.map((r: any) => r.key);
    assert.deepEqual(plugins, ['plugin:market/review']);
    await assert.rejects(as(null, `insert into public.agent_tools (key, kind, source, name, title) values ('x', 'mcp', 'registry', 'x', 'x')`), /permission denied/);
  });

  test('the publisher is stored and apps are linked back to their developer on sign-in', async () => {
    const link = (uid: string, token: string | null = null) =>
      as(uid, 'select repo_full_name from public.link_my_apps($1)', [token]).then((r) => r.rows.map((x: any) => x.repo_full_name).sort());

    // Publishing stamps the publisher's GitHub account; clients can't write it themselves.
    await mock('/repos/alice/linked', 200, repoJson('alice/linked'));
    await mock('/repos/alice/linked/releases?per_page=15', 200, [release('1.0', ['linked.apk'])]);
    const pub = (await publish(ALICE, { repo: 'alice/linked', name: 'Linked', category: 'tools' })).rows[0] as any;
    assert.equal(pub.publisher_github_id, '101');
    assert.equal(pub.publisher_login, 'alice');
    await assert.rejects(as(ALICE, `update public.apps set publisher_login = 'bob' where id = '${pub.id}'`), /permission denied/);

    // Her ArkStore account went away (owner_id is "on delete set null"), and a curated listing of
    // another repo of hers was added meanwhile. Signing in links both back; Bob gets neither.
    await db.exec(`
      update public.apps set owner_id = null where id = '${pub.id}';
      insert into public.apps (source, repo_full_name, name, category, developer_login, status)
      values ('curated', 'alice/found', 'Found', 'tools', 'alice', 'hidden'),
             ('curated', 'Ark-Devs/Pushable', 'Pushable', 'tools', 'Ark-Devs', 'published'),
             ('curated', 'Ark-Devs/ReadOnly', 'Read only', 'tools', 'Ark-Devs', 'published');
    `);
    assert.equal(
      (await db.query<any>(`select publisher_login from public.apps where id = '${pub.id}'`)).rows[0].publisher_login,
      'alice',
      'publisher survives losing the owner',
    );
    assert.deepEqual(await link(BOB), []);
    assert.deepEqual(await link(ALICE), ['alice/found', 'alice/linked']);
    const found = (await db.query<any>(`select owner_id, source, publisher_login from public.apps where repo_full_name = 'alice/found'`)).rows[0];
    assert.deepEqual([found.owner_id, found.source, found.publisher_login], [ALICE, 'developer', 'alice']);

    // Organization repos need her token, and push access on each repo.
    await mock('/user/orgs?per_page=100', 200, [{ login: 'Ark-Devs' }]);
    await mock('/repos/Ark-Devs/Pushable', 200, repoJson('Ark-Devs/Pushable', { permissions: { push: true } }));
    await mock('/repos/Ark-Devs/ReadOnly', 200, repoJson('Ark-Devs/ReadOnly', { permissions: { push: false } }));
    assert.deepEqual(await link(ALICE), [], 'no token, no organization repos');
    assert.deepEqual(await link(BOB, 'alice-token'), [], "a token that isn't the caller's links nothing");
    // (Ark-Devs/DB-Crawler is left unowned by an earlier test and grants push too.)
    assert.deepEqual(await link(ALICE, 'alice-token'), ['Ark-Devs/DB-Crawler', 'Ark-Devs/Pushable']);
    await assert.rejects(as(null, 'select * from public.link_my_apps()'), /permission denied/);
  });

  test('storage uploads are limited to the caller folder', async () => {
    await db.exec('grant insert on storage.objects to authenticated; grant usage on schema storage to authenticated;');
    await as(ALICE, `insert into storage.objects (bucket_id, name) values ('media', '${ALICE}/icon.png')`);
    await assert.rejects(
      as(ALICE, `insert into storage.objects (bucket_id, name) values ('media', '${BOB}/icon.png')`),
      /row-level security/,
    );
  });
});
