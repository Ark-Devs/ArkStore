// Expo config plugin: lets ArkStore see which apps are installed (to show Open instead of Get,
// and notice uninstalls) through a <queries> declaration for apps with a launcher icon, instead
// of the QUERY_ALL_PACKAGES permission. That permission is one Play Protect and Google look at
// closely in an app that also installs apps, and apps without an icon never need a button.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withPackageQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const launcher = {
      intent: [
        {
          action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
          category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
        },
      ],
    };
    manifest.queries = manifest.queries?.length ? manifest.queries : [{}];
    if (!JSON.stringify(manifest.queries).includes('android.intent.category.LAUNCHER')) {
      const first = manifest.queries[0];
      first.intent = [...(first.intent ?? []), ...launcher.intent];
    }
    return cfg;
  });
};
