import { defineConfig } from "mygo-cli";
import { appVersion } from "./app/version.ts";

export default defineConfig({
  name: "WiseWave",
  publisher: "Friston",
  bindings: "src/app/mygo.ts",
  identifier: "com.wisewave.app",
  version: appVersion,
  icon: "resources/images/icon.png",
  devUrl: "http://localhost:5173",
  devCommand: "npm run dev:web",
  buildCommand: "npm run build:web",
  frontendDist: "dist",
  windows: {
    installerInclude: "resources/installer.nsh",
  },
});
