import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const generatedPath = new URL("../app-seeker/src/generatedWebViewThemeAssets.ts", import.meta.url);
const screenPath = new URL("../app-seeker/src/LuckyMeScreen.tsx", import.meta.url);
const mainAppPath = new URL("../app-seeker/App.tsx", import.meta.url);
const appPath = new URL("../app-seeker/src/LuckyMeReferralTestApp.tsx", import.meta.url);
const referralPath = new URL("../app-seeker/src/SeekerReferralScreen.tsx", import.meta.url);
const stitchPath = new URL("../app-seeker/src/stitchScreens.ts", import.meta.url);

test("all approved APK artwork is embedded for the offline WebView", () => {
  const result = spawnSync("node", ["scripts/generate-webview-theme-assets.mjs", "--check"], {
    cwd: new URL("../app-seeker/", import.meta.url),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const generated = readFileSync(generatedPath, "utf8");
  assert.equal((generated.match(/data:image\/webp;base64,/g) ?? []).length, 19);
  assert.ok(generated.length > 500_000, "embedded artwork payload is unexpectedly small");
  assert.ok(generated.length < 2_000_000, "embedded artwork payload is too large for fluid navigation");

  const screen = readFileSync(screenPath, "utf8");
  assert.match(screen, /WEBVIEW_THEME_ASSETS/);
  assert.doesNotMatch(screen, /Image\.resolveAssetSource/);
});

test("menu navigation uses one persistent WebView and swaps only ready in-page frames", () => {
  const screen = readFileSync(screenPath, "utf8");
  assert.doesNotMatch(screen, /key=\{screen\}/);
  assert.equal((screen.match(/<WebView\s/g) ?? []).length, 1);
  assert.doesNotMatch(screen, /webViewFrames/);
  assert.match(screen, /type: 'render-ready'/);
  assert.match(screen, /requestAnimationFrame/);
  assert.match(screen, /renderPersistentWebViewShell/);
  assert.match(screen, /window\.__luckymeNavigate/);
  assert.match(screen, /luckyme-screen-frame\.incoming/);
  assert.match(screen, /previousFrame\.remove\(\)/);
  assert.doesNotMatch(screen, /frameOpacity/);
  assert.doesNotMatch(screen, /Animated\.timing/);
  assert.doesNotMatch(screen, /image\.decode\(\)/);
  assert.doesNotMatch(screen, /imagesReady|fastReveal/);
  assert.match(screen, /transition: transform 120ms/);
  assert.match(screen, /translate3d\(-100%, 0, 0\)/);
  assert.match(screen, /translate3d\(100%, 0, 0\)/);
  assert.match(screen, /androidLayerType="none"/);
  assert.doesNotMatch(screen, /androidLayerType="hardware"/);
  assert.match(screen, /backgroundColor: "#00251B"/);
});

test("UI test pool BUY opens the real wallet flow while referral and NFT test lanes stay payment-disabled", () => {
  const mainApp = readFileSync(mainAppPath, "utf8");
  const screen = readFileSync(screenPath, "utf8");
  const referral = readFileSync(referralPath, "utf8");
  const stitch = readFileSync(stitchPath, "utf8");

  assert.match(mainApp, /disablePayments=\{isReferralTestBuild \|\| isSeekerPassTestBuild\}/);
  assert.doesNotMatch(mainApp, /disablePayments=\{isReferralTestBuild \|\| isSeekerPassTestBuild \|\| isUiTestBuild\}/);
  assert.match(screen, /wallet\.account \?\? await wallet\.connect\(\)/);
  assert.match(screen, /wallet\.signAndSendTransactions\(transaction, minContextSlot\)/);
  assert.doesNotMatch(screen, /Backend simulation failed/);
  assert.doesNotMatch(screen, /if \(payload\.simulation/);
  assert.match(screen, /setScreen\("review"\)/);
  assert.match(stitch, /\? "BUY"/);
  assert.doesNotMatch(stitch, /Sign in wallet/);
  assert.match(referral, /ActionButton label="VERIFY" onPress=\{verifySeeker\}/);
  assert.doesNotMatch(referral, /ActionButton label="Sign with wallet"/);
});

test("technical wallet and NFT errors stay out of the user interface", () => {
  const screen = readFileSync(screenPath, "utf8");
  const pass = readFileSync(new URL("../app-seeker/src/SeekerPassDrawScreen.tsx", import.meta.url), "utf8");
  const stitch = readFileSync(stitchPath, "utf8");

  assert.doesNotMatch(pass, /Verification not completed|CancellationException|errorCard|errorText/);
  assert.doesNotMatch(stitch, /Wallet request failed|Unsigned · built by backend|Backend simulation failed/);
  assert.doesNotMatch(screen, /message: errorMessage\(error\)/);
  assert.match(screen, /Wallet flow ended before a confirmed transaction/);
});

test("native feature pages stay immersive and return without remounting the redesigned home", () => {
  const app = readFileSync(appPath, "utf8");
  assert.match(app, /<StatusBar hidden translucent/);
  assert.match(app, /<LuckyMeScreen/);
  assert.match(app, /\{referralVisible \? \(/);
  assert.match(app, /\{seekerPassDrawVisible && seekerPassPromotionEnabled \? \(/);
  assert.match(app, /BackHandler\.addEventListener\("hardwareBackPress"/);
  assert.doesNotMatch(app, /if \(referralVisible\) \{\s*return/);
});

test("Android Back navigates inside the app and long press cannot select WebView copy", () => {
  const screen = readFileSync(screenPath, "utf8");
  const stitch = readFileSync(stitchPath, "utf8");
  assert.match(screen, /screenHistoryRef/);
  assert.match(screen, /BackHandler\.addEventListener\("hardwareBackPress"/);
  assert.match(screen, /document\.addEventListener\('contextmenu'/);
  assert.match(screen, /document\.addEventListener\('selectstart'/);
  assert.match(stitch, /-webkit-touch-callout: none/);
  assert.match(stitch, /-webkit-user-select: none/);
});

test("Latest Winners exposes only archive-backed Solscan settlement links", () => {
  const stitch = readFileSync(stitchPath, "utf8");
  assert.match(stitch, /settlementSignature\?: string \| null/);
  assert.match(stitch, /https:\/\/solscan\.io\/tx\/\$\{signature\}/);
  assert.match(stitch, /&& settlementSolscanUrl\(round\)/);
  assert.match(stitch, /data-route="external" data-url="\$\{escapeHtml\(solscanUrl\)\}"/);
  assert.match(stitch, /Tap any displayed round or winner to verify its settlement transaction directly on Solscan/);
});
