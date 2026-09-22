// Declaring UIApplicationSceneManifest in Info.plist alone (Apple's documented
// "minimal adoption" path, which normally lets iOS auto-attach an app's
// existing UIWindow to an implicit default scene) was not enough on this
// user's iOS/Xcode toolchain: the app still fails to launch with "UIScene
// life cycle is required for apps built with this SDK". Neither
// EXAppDelegateWrapper (expo-modules-core) nor RCTAppDelegate (react-native)
// implement scene:willConnectToSession:options:, so nothing actually attaches
// the window RCTAppDelegate creates in application:didFinishLaunchingWithOptions
// to the incoming UIWindowScene once a full scene delegate is registered.
// This plugin makes AppDelegate serve as its own explicit scene delegate
// (Apple's supported pattern for single-window apps migrating off the legacy
// lifecycle) by injecting scene:willConnectToSession:options: into the
// generated AppDelegate.mm; app.json's ios.infoPlist registers "AppDelegate"
// as the UISceneDelegateClassName so UIKit calls it.
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "Authentik: explicit scene delegate";
const SCENE_METHOD = `
// ${MARKER} (see apps/mobile/plugins/withAppDelegateSceneSupport.js)
- (void)scene:(UIScene *)scene
    willConnectToSession:(UISceneSession *)session
                 options:(UISceneConnectionOptions *)connectionOptions API_AVAILABLE(ios(13.0))
{
  if ([scene isKindOfClass:[UIWindowScene class]] && self.window != nil) {
    self.window.windowScene = (UIWindowScene *)scene;
    [self.window makeKeyAndVisible];
  }
}

@end
`;

function withAppDelegateSceneSupport(config) {
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

      const lastEnd = contents.lastIndexOf("@end");
      if (lastEnd === -1) {
        throw new Error(
          "withAppDelegateSceneSupport: could not find a trailing @end in ios/*/AppDelegate.mm to patch"
        );
      }

      const patched = contents.slice(0, lastEnd) + SCENE_METHOD.trimStart();
      fs.writeFileSync(appDelegatePath, patched);
      return config;
    },
  ]);
}

module.exports = withAppDelegateSceneSupport;
