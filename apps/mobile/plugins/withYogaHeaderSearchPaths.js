// Build failure: 'yoga/numeric/Comparison.h' file not found, compiling YGValue.cpp inside the
// Yoga pod itself. Traced to react-native's own Yoga.podspec (ReactCommon/yoga/Yoga.podspec):
// it only adds HEADER_SEARCH_PATHS = "$(PODS_TARGET_SRCROOT)" to its pod_target_xcconfig when
// ENV['USE_FRAMEWORKS'] is set --
//   spec.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
//     .merge!(ENV['USE_FRAMEWORKS'] != nil ? { 'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)"' } : {})
// This project doesn't set ios.useFrameworks (default static-library CocoaPods mode), so Yoga
// never gets this explicit search path and has to rely on Xcode's header-map mechanism to
// resolve its own <yoga/...> includes -- a mechanism known to stop working reliably for a pod's
// private/internal headers on recent CocoaPods/Xcode combinations.
// Replicate exactly what the podspec itself does for use_frameworks builds, via a Podfile
// post_install hook, without switching the whole project to use_frameworks!.
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const REACT_NATIVE_POST_INSTALL_CALL = /react_native_post_install\([\s\S]*?\n    \)\n/;
const MARKER = "Authentik: Yoga header search paths";

function withYogaHeaderSearchPaths(config) {
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
          "withYogaHeaderSearchPaths: could not find the react_native_post_install(...) call in ios/Podfile to patch"
        );
      }

      const patched = `${match[0]}
    # ${MARKER} (see apps/mobile/plugins/withYogaHeaderSearchPaths.js)
    installer.pods_project.targets.each do |target|
      next unless target.name == 'Yoga'
      target.build_configurations.each do |build_config|
        search_paths = build_config.build_settings['HEADER_SEARCH_PATHS'] || '$(inherited)'
        search_paths = [search_paths] unless search_paths.is_a?(Array)
        search_paths << '"$(PODS_TARGET_SRCROOT)"' unless search_paths.include?('"$(PODS_TARGET_SRCROOT)"')
        build_config.build_settings['HEADER_SEARCH_PATHS'] = search_paths
      end
    end
`;

      fs.writeFileSync(podfilePath, contents.replace(REACT_NATIVE_POST_INSTALL_CALL, patched));
      return config;
    },
  ]);
}

module.exports = withYogaHeaderSearchPaths;
