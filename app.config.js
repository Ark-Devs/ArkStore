// app.json holds the config. This only lets a web build live under a sub-path, for GitHub
// Pages (https://ark-devs.github.io/ArkStore/): EXPO_BASE_URL=/ArkStore npx expo export -p web
module.exports = ({ config }) => {
  const baseUrl = process.env.EXPO_BASE_URL;
  return baseUrl ? { ...config, experiments: { ...config.experiments, baseUrl } } : config;
};
