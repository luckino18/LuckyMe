const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withAppBuildGradle,
} = require("@expo/config-plugins");

const PLUGIN_NAME = "with-seeker-referral-test-android";

function withSecureManifest(config) {
  return withAndroidManifest(config, (manifestConfig) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifestConfig.modResults);
    application.$["android:usesCleartextTraffic"] = "false";
    application.$["android:allowBackup"] = "false";
    application.$["android:fullBackupContent"] = "false";
    return manifestConfig;
  });
}

function withTestSigning(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== "groovy") {
      throw new Error(`${PLUGIN_NAME} requires a Groovy app/build.gradle`);
    }
    let contents = gradleConfig.modResults.contents;
    const marker = "// LuckyMe Seeker Referral Test signing (local environment only)";
    if (!contents.includes(marker)) {
      const signingBlock = `    signingConfigs {
        ${marker}
        seekerReferralTest {
            def keyPath = System.getenv("LM_TEST_KEYSTORE_PATH")
            def storePass = System.getenv("LM_TEST_KEYSTORE_PASSWORD")
            def aliasName = System.getenv("LM_TEST_KEY_ALIAS")
            def keyPass = System.getenv("LM_TEST_KEY_PASSWORD")
            if (!keyPath || !storePass || !aliasName || !keyPass) {
                throw new GradleException("LM_TEST_KEYSTORE_PATH, LM_TEST_KEYSTORE_PASSWORD, LM_TEST_KEY_ALIAS and LM_TEST_KEY_PASSWORD are required")
            }
            storeFile file(keyPath)
            storePassword storePass
            keyAlias aliasName
            keyPassword keyPass
            enableV1Signing false
            enableV2Signing true
            enableV3Signing true
            enableV4Signing false
        }
        debug {`;
      if (!contents.includes("    signingConfigs {\n        debug {")) {
        throw new Error(`${PLUGIN_NAME} could not locate the Android signingConfigs block`);
      }
      contents = contents.replace("    signingConfigs {\n        debug {", signingBlock);
      const releaseSigning = /(\n\s*release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
      if (!releaseSigning.test(contents)) {
        throw new Error(`${PLUGIN_NAME} could not locate the Android release signing config`);
      }
      contents = contents.replace(releaseSigning, "$1signingConfig signingConfigs.seekerReferralTest");
    }
    gradleConfig.modResults.contents = contents;
    return gradleConfig;
  });
}

function withSeekerReferralTestAndroid(config) {
  config = withSecureManifest(config);
  config = withTestSigning(config);
  return config;
}

module.exports = createRunOncePlugin(
  withSeekerReferralTestAndroid,
  PLUGIN_NAME,
  "1.0.0",
);
