// Plays the voice assistant through the iPhone's loudspeaker. WebRTC's audio
// session otherwise defaults to the earpiece, like a phone call, and
// react-native-webrtc has no JavaScript setting for it. This adds Apple's
// defaultToSpeaker option to the configuration WebRTC applies, before React
// Native starts (the approach in OpenAI's React Native Realtime example).
const fs = require('fs');
const path = require('path');
const { IOSConfig, withAppDelegate, withDangerousMod } = require('expo/config-plugins');

const IMPORT = '#import <WebRTC/RTCAudioSessionConfiguration.h>';
const CODE = `    // Voice assistant: loudspeaker, not the earpiece (plugins/withSpeakerAudio.js).
    let webRTCAudio = RTCAudioSessionConfiguration.webRTC()
    webRTCAudio.categoryOptions.insert(.defaultToSpeaker)
    RTCAudioSessionConfiguration.setWebRTC(webRTCAudio)
`;

module.exports = function withSpeakerAudio(config) {
  // Swift sees the WebRTC class through the bridging header.
  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      const root = IOSConfig.Paths.getSourceRoot(cfg.modRequest.projectRoot);
      const header = fs.readdirSync(root).find((f) => f.endsWith('-Bridging-Header.h'));
      if (!header) throw new Error('withSpeakerAudio: no bridging header found');
      const file = path.join(root, header);
      const text = fs.readFileSync(file, 'utf8');
      if (!text.includes(IMPORT)) fs.writeFileSync(file, `${text.trimEnd()}\n${IMPORT}\n`);
      return cfg;
    },
  ]);
  return withAppDelegate(config, (cfg) => {
    const src = cfg.modResults.contents;
    if (cfg.modResults.language !== 'swift') throw new Error('withSpeakerAudio: expected a Swift AppDelegate');
    if (src.includes('defaultToSpeaker')) return cfg;
    const start = src.indexOf('didFinishLaunchingWithOptions');
    const brace = start < 0 ? -1 : src.indexOf('{', src.indexOf('-> Bool', start));
    if (brace < 0) throw new Error('withSpeakerAudio: didFinishLaunching not found');
    cfg.modResults.contents = `${src.slice(0, brace + 1)}\n${CODE}${src.slice(brace + 1)}`;
    return cfg;
  });
};
