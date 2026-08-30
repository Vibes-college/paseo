// Polyfill crypto.randomUUID for React Native before any other imports
import { polyfillCrypto } from "./src/polyfills/crypto";
polyfillCrypto();

// Polyfill screen.orientation for WebKitGTK desktop runtimes that lack the API.
import { polyfillScreenOrientation } from "./src/polyfills/screen-orientation";
polyfillScreenOrientation();

// Configure Unistyles before Expo Router pulls in any components using StyleSheet.
import "./src/styles/unistyles";

if (typeof document !== "undefined" && process.env.EXPO_PUBLIC_COMPLETE_ROOT_MODULE === "true") {
  const moduleEntry = require("./src/embedded/module-entry");
  void moduleEntry;
} else if (
  typeof document !== "undefined" &&
  process.env.EXPO_PUBLIC_COMPLETE_ROOT_MOUNT === "true"
) {
  const embeddedEntry = require("./src/embedded/web-entry");
  void embeddedEntry;
} else {
  const routerEntry = require("expo-router/entry");
  void routerEntry;
}
