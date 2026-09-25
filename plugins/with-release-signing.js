// Expo config plugin: sign release APKs with ArkStore's own key instead of the public debug key.
// The key comes from the environment, so nothing secret is committed:
//   ARKSTORE_KEYSTORE           path to the .jks / .keystore file
//   ARKSTORE_KEYSTORE_PASSWORD  keystore password
//   ARKSTORE_KEY_ALIAS          key alias
//   ARKSTORE_KEY_PASSWORD       key password (defaults to the keystore password)
// Without ARKSTORE_KEYSTORE, release builds keep using the debug key (local builds, forks).
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// arkstore:release-signing';

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;
    gradle = gradle.replace(
      /signingConfigs\s*\{/,
      (match) => `${match}
        ${MARKER}
        release {
            def ks = System.getenv('ARKSTORE_KEYSTORE')
            if (ks) {
                storeFile file(ks)
                storePassword System.getenv('ARKSTORE_KEYSTORE_PASSWORD')
                keyAlias System.getenv('ARKSTORE_KEY_ALIAS')
                keyPassword System.getenv('ARKSTORE_KEY_PASSWORD') ?: System.getenv('ARKSTORE_KEYSTORE_PASSWORD')
            }
        }`,
    );
    gradle = gradle.replace(
      /(release\s*\{\s*\n(?:\s*\/\/.*\n)*\s*)signingConfig signingConfigs\.debug/,
      "$1signingConfig System.getenv('ARKSTORE_KEYSTORE') ? signingConfigs.release : signingConfigs.debug",
    );
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
