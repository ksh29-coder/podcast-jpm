// Adopts iOS's scene life cycle, which apps built with the iOS 27 SDK must use:
// without it iOS 27 stops the app at launch. Expo's ExpoAppSceneDelegate does
// the work (creates the window and starts React Native in it); this registers
// it in Info.plist and lets the app delegate hand it the React Native factory
// instead of starting React Native in its own window.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const START = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

module.exports = function withSceneLifecycle(config) {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'EXExpoAppSceneDelegate' },
        ],
      },
    };
    return cfg;
  });
  return withAppDelegate(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (cfg.modResults.language !== 'swift') throw new Error('withSceneLifecycle: expected a Swift AppDelegate');
    if (src.includes('ExpoReactNativeFactoryProvider')) return cfg;
    if (!START.test(src)) throw new Error('withSceneLifecycle: startReactNative block not found');
    src = src.replace('class AppDelegate: ExpoAppDelegate {', 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
    if (!src.includes('ExpoReactNativeFactoryProvider')) throw new Error('withSceneLifecycle: AppDelegate class not found');
    cfg.modResults.contents = src.replace(START, '\n    // The scene delegate starts React Native (plugins/withSceneLifecycle.js).\n');
    return cfg;
  });
};
