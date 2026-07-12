import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outfile = path.join(root, "site/lucky-me.app/assets/vendor/walletconnect-bundle.js");

await build({
  stdin: {
    contents: `
      import { UniversalProvider } from "@walletconnect/universal-provider";
      import QRCode from "qrcode";

      export { UniversalProvider };
      export function createWalletConnectQrDataUrl(uri) {
        return QRCode.toDataURL(uri, {
          errorCorrectionLevel: "M",
          margin: 2,
          width: 320,
          color: { dark: "#05070d", light: "#ffffff" },
        });
      }
    `,
    loader: "js",
    resolveDir: root,
    sourcefile: "walletconnect-browser-entry.js",
  },
  outfile,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  sourcemap: false,
  legalComments: "none",
  define: {
    global: "globalThis",
    "process.env": "{}",
  },
});

console.log(path.relative(root, outfile));
