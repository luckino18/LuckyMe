const { withAndroidManifest } = require("@expo/config-plugins");

module.exports = function withSolanaDappStoreQuery(config) {
  return withAndroidManifest(config, (result) => {
    const manifest = result.modResults.manifest;
    const queries = Array.isArray(manifest.queries) ? manifest.queries : [];
    const hasDappStoreQuery = queries.some((query) =>
      query?.intent?.some((intent) =>
        intent?.data?.some((data) =>
          data?.$?.["android:scheme"] === "solanadappstore" &&
          data?.$?.["android:host"] === "details")));

    if (!hasDappStoreQuery) {
      queries.push({
        intent: [{
          action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
          category: [{ $: { "android:name": "android.intent.category.BROWSABLE" } }],
          data: [{ $: {
            "android:scheme": "solanadappstore",
            "android:host": "details",
          } }],
        }],
      });
    }

    manifest.queries = queries;
    return result;
  });
};
