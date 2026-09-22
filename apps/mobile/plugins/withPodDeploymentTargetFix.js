// Xcode 16's freshly generated Pods.xcodeproj leaves CocoaPods targets that
// don't declare their own deployment target (notably the Expo Swift modules —
// ExpoModulesCore, ExpoAsset, ExpoBlur, EXConstants, ExpoFileSystem, ExpoFont,
// ExpoKeepAwake, ExpoLinearGradient) inheriting Xcode's own new-project
// template default (iOS 17.0), instead of the target configured via
// expo-build-properties. The Podfile's `platform :ios, ...` line and
// react_native_post_install both read the right value, but neither forces it
// onto every individual pod target — so importing those modules from
// ExpoModulesProvider.swift (built at the configured target) fails with
// "Compiling for iOS 15.1, but module 'X' has a minimum deployment target of
// iOS 17.0". Reproduced with a real `expo prebuild` + inspection of the
// generated ios/Podfile, and confirmed by the user even after a full
// DerivedData + Pods wipe — not a stale-cache issue. This patches the
// generated Podfile so every `expo prebuild` forces every pod target
// explicitly, right after react-native's own post_install hook runs.
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const REACT_NATIVE_POST_INSTALL_CALL = /react_native_post_install\([\s\S]*?\n    \)\n/;
const MARKER = "Authentik: force pod deployment targets";

function withPodDeploymentTargetFix(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, "Podfile");
      const contents = fs.readFileSync(podfilePath, "utf8");

      if (contents.includes(MARKER)) {
        return config;
      }

      const match = contents.match(REACT_NATIVE_POST_INSTALL_CALL);
      if (!match) {
        throw new Error(
          "withPodDeploymentTargetFix: could not find the react_native_post_install(...) call in ios/Podfile to patch"
        );
      }

      const patched = `${match[0]}
    # ${MARKER} (see apps/mobile/plugins/withPodDeploymentTargetFix.js)
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = podfile_properties['ios.deploymentTarget'] || '13.4'
      end
    end
`;

      fs.writeFileSync(podfilePath, contents.replace(REACT_NATIVE_POST_INSTALL_CALL, patched));
      return config;
    },
  ]);
}

module.exports = withPodDeploymentTargetFix;
