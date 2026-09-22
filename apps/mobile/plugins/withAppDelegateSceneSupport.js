// Confirmed on the user's device: the minimal UIApplicationSceneManifest (no
// UISceneConfigurations at all) is NOT sufficient on this iOS/Xcode toolchain
// -- the app still fails to launch with "UIScene life cycle is required for
// apps built with this SDK" even after a full clean rebuild (node_modules +
// Pods wiped and reinstalled, not just a stale build). A real scene delegate
// is required.
//
// A first attempt named "AppDelegate" itself as the UISceneDelegateClassName
// (Apple's documented "reuse your app delegate as scene delegate" pattern),
// but that produced a black screen: JS booted fine (native modules
// registered, NfcManager created, appBecomesActive posted) yet nothing was
// visible. The likely cause: for an Objective-C class, UIKit does not
// necessarily reuse the existing app delegate *instance* just because the
// class name matches -- it can instantiate a second, separate AppDelegate
// object to serve as the scene delegate. That second instance's `self.window`
// is nil (it never went through application:didFinishLaunchingWithOptions),
// so the scene method's guard silently no-ops, and the REAL window (owned by
// the actual app delegate singleton) never gets attached to a visible scene.
//
// Fix: define a small, DEDICATED scene delegate class (not named
// "AppDelegate") that never relies on its own `self` for the window. It
// always fetches the real, singleton app delegate via
// `[UIApplication sharedApplication].delegate` and attaches *that* instance's
// `window` (a guaranteed-non-nil, strong property on RCTAppDelegate) to the
// incoming scene. Declared as a second class in the same AppDelegate.mm file
// (rather than a new file) so it needs no separate Xcode build-phase
// registration.
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "Authentik: dedicated scene delegate";
const SCENE_DELEGATE_CLASS = `
// ${MARKER} (see apps/mobile/plugins/withAppDelegateSceneSupport.js)
@interface AuthentikSceneDelegate : UIResponder <UIWindowSceneDelegate>
@end

@implementation AuthentikSceneDelegate

- (void)scene:(UIScene *)scene
    willConnectToSession:(UISceneSession *)session
                 options:(UISceneConnectionOptions *)connectionOptions API_AVAILABLE(ios(13.0))
{
  AppDelegate *appDelegate = (AppDelegate *)[UIApplication sharedApplication].delegate;
  if ([scene isKindOfClass:[UIWindowScene class]] && appDelegate.window != nil) {
    appDelegate.window.windowScene = (UIWindowScene *)scene;
    [appDelegate.window makeKeyAndVisible];
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

      fs.writeFileSync(appDelegatePath, contents + SCENE_DELEGATE_CLASS);
      return config;
    },
  ]);
}

module.exports = withAppDelegateSceneSupport;
