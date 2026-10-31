// Adopts iOS's scene life cycle, which apps built with the iOS 27 SDK must use:
// without it iOS 27 stops the app at launch. Expo's ExpoAppSceneDelegate does
// the work (creates the window and starts React Native in it); this registers
// it in Info.plist and lets the app delegate hand it the React Native factory
// instead of starting React Native in its own window.
//
// Under scenes, an alert that cold-starts the app comes in the scene's
// connection options rather than to the notification center's delegate, and
// ExpoAppSceneDelegate doesn't pass it on, so tapping an alert while the app
// was closed opened nothing. AppSceneDelegate hands it to expo-notifications.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const START = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

module.exports = function withSceneLifecycle(config) {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'AIWaveSceneDelegate' },
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
    src = src.replace(START, '\n    // The scene delegate starts React Native (plugins/withSceneLifecycle.js).\n');
    cfg.modResults.contents = `${src}
// The scene delegate (plugins/withSceneLifecycle.js): Expo's, plus the alert
// that opened the app, which UIKit puts in the connection options.
@objc(AIWaveSceneDelegate)
class AppSceneDelegate: ExpoAppSceneDelegate {
  override func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    super.scene(scene, willConnectTo: session, options: connectionOptions)
#if canImport(ExpoNotifications)
    if let response = connectionOptions.notificationResponse {
      NotificationCenterManager.shared.userNotificationCenter(UNUserNotificationCenter.current(), didReceive: response, withCompletionHandler: {})
    }
#endif
  }
}
`;
    if (!cfg.modResults.contents.includes('import UserNotifications')) {
      cfg.modResults.contents = cfg.modResults.contents.replace('import Expo\n', 'import Expo\nimport UserNotifications\n#if canImport(ExpoNotifications)\ninternal import ExpoNotifications\n#endif\n');
    }
    return cfg;
  });
};
