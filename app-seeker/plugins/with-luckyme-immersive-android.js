const { createRunOncePlugin, withMainActivity } = require("@expo/config-plugins");

const PLUGIN_NAME = "with-luckyme-immersive-android";

function addImport(source, importLine) {
  if (source.includes(importLine)) {
    return source;
  }

  const packageMatch = source.match(/^package .+\n/m);
  if (!packageMatch) {
    return `${importLine}\n${source}`;
  }

  return source.replace(packageMatch[0], `${packageMatch[0]}\n${importLine}\n`);
}

function withLuckyMeImmersiveAndroid(config) {
  return withMainActivity(config, (mainActivityConfig) => {
    let { contents } = mainActivityConfig.modResults;

    contents = addImport(contents, "import android.graphics.Color");
    contents = addImport(contents, "import android.os.Build");
    contents = addImport(contents, "import android.view.View");
    contents = addImport(contents, "import android.view.WindowInsets");
    contents = addImport(contents, "import android.view.WindowInsetsController");

    if (!contents.includes("enableLuckyMeImmersiveMode()")) {
      contents = contents.replace(
        "super.onCreate(null)",
        "super.onCreate(null)\n    enableLuckyMeImmersiveMode()"
      );
    }

    if (!contents.includes("private fun enableLuckyMeImmersiveMode()")) {
      contents = contents.replace(
        "\n  /**\n   * Returns the name of the main component registered from JavaScript.",
        `
  private fun enableLuckyMeImmersiveMode() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      window.statusBarColor = Color.TRANSPARENT
      window.navigationBarColor = Color.TRANSPARENT
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      window.setDecorFitsSystemWindows(false)
      window.insetsController?.let { controller ->
        controller.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
        controller.systemBarsBehavior =
          WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      }
    } else {
      @Suppress("DEPRECATION")
      window.decorView.systemUiVisibility = (
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
          or View.SYSTEM_UI_FLAG_FULLSCREEN
          or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
          or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
          or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
          or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
      )
    }
  }

  override fun onResume() {
    super.onResume()
    enableLuckyMeImmersiveMode()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) {
      enableLuckyMeImmersiveMode()
    }
  }

  /**
   * Returns the name of the main component registered from JavaScript.`
      );
    }

    mainActivityConfig.modResults.contents = contents;
    return mainActivityConfig;
  });
}

module.exports = createRunOncePlugin(
  withLuckyMeImmersiveAndroid,
  PLUGIN_NAME,
  "1.0.0"
);
