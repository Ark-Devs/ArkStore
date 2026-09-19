// Expo config plugin: build one APK per CPU type (plus a universal one) in release builds.
// Phones then download only the native code they can run; ArkStore itself picks the right
// APK for each device from a release, so ArkStore's own releases benefit the same way.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// arkstore:abi-splits';

module.exports = function withAbiSplits(config, { universalApk = true } = {}) {
  return withAppBuildGradle(config, (cfg) => {
    const gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;
    cfg.modResults.contents = gradle.replace(
      /\nandroid\s*\{/,
      (match) => `${match}
    ${MARKER}
    splits {
        abi {
            enable true
            reset()
            include(*((findProperty('reactNativeArchitectures') ?: 'arm64-v8a,armeabi-v7a').split(',')))
            universalApk ${universalApk}
        }
    }
`,
    );
    return cfg;
  });
};
