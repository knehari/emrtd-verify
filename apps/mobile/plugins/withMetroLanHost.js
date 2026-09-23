// On a physical device launched via Xcode's own Run button (rather than `expo run:ios`, which
// this project's Expo CLI version can't use for device builds -- see SimulatorAppPrerequisite,
// which unconditionally requires Simulator.app even with --device), RCTBundleURLProvider's
// default jsLocation resolves to "localhost", which on a physical device means the device
// itself, not the Mac running Metro. That produced "No bundle URL present." on first real-device
// launch, confirmed by the crash log (RCTFatal from bundleURL returning nil / unreachable).
// Force jsLocation to the Mac's LAN IP so both the simulator and a physical device on the same
// Wi-Fi network can always reach Metro, regardless of how the build was launched.
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "Authentik: force LAN Metro host";
// Update this if it changes on your network -- find it via `ipconfig getifaddr en0` on the Mac,
// or read it straight from the "Metro waiting on exp://<IP>:8081" line Metro prints on start.
const METRO_LAN_HOST = "192.168.1.13";

const BUNDLE_URL_METHOD = `- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@".expo/.virtual-metro-entry"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}`;

const PATCHED_BUNDLE_URL_METHOD = `- (NSURL *)bundleURL
{
#if DEBUG
  // ${MARKER} (see apps/mobile/plugins/withMetroLanHost.js)
  [RCTBundleURLProvider sharedSettings].jsLocation = @"${METRO_LAN_HOST}";
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@".expo/.virtual-metro-entry"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}`;

function withMetroLanHost(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const appDelegatePath = path.join(
        config.modRequest.platformProjectRoot,
        config.modRequest.projectName,
        "AppDelegate.mm"
      );
      const contents = fs.readFileSync(appDelegatePath, "utf8");

      if (contents.includes(MARKER)) {
        return config;
      }

      if (!contents.includes(BUNDLE_URL_METHOD)) {
        throw new Error(
          "withMetroLanHost: could not find the expected bundleURL method in ios/*/AppDelegate.mm to patch"
        );
      }

      fs.writeFileSync(appDelegatePath, contents.replace(BUNDLE_URL_METHOD, PATCHED_BUNDLE_URL_METHOD));
      return config;
    },
  ]);
}

module.exports = withMetroLanHost;
