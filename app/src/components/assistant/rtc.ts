import type { VoiceConnection, VoiceEvent, VoiceOptions } from './rtc.web';

export type { VoiceConnection, VoiceEvent, VoiceOptions };

// Phone: a live audio connection to the voice service with react-native-webrtc.
// The service's voice plays by itself (on the loudspeaker, see
// plugins/withSpeakerAudio.js). The browser version is rtc.web.ts.
export async function connectVoice({ token, connectUrl, onEvent }: VoiceOptions): Promise<VoiceConnection> {
  // Loaded only now: app builds from before the assistant (and Expo Go)
  // don't have this native module, and shouldn't fail on start.
  let webrtc: typeof import('react-native-webrtc');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    webrtc = require('react-native-webrtc');
  } catch {
    throw new Error('This version of the app can’t talk yet. Update AI Dev Wave from TestFlight.');
  }
  const pc = new webrtc.RTCPeerConnection();
  const stream = await webrtc.mediaDevices.getUserMedia({ audio: true, video: false });
  const track = stream.getAudioTracks()[0];
  if (!track) throw new Error('No microphone available');
  pc.addTrack(track, stream);
  const dc = pc.createDataChannel('oai-events');
  // react-native-webrtc's types only list the on… handlers.
  const opened = new Promise<void>((resolve) => {
    dc.onopen = () => resolve();
  });
  dc.onmessage = (e: unknown) => {
    try {
      onEvent(JSON.parse(String((e as { data: string }).data)));
    } catch {
      // Not an event we understand.
    }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') onEvent({ type: 'connection.closed' });
  };

  const offer = await pc.createOffer({});
  await pc.setLocalDescription(offer);
  const res = await fetch(connectUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/sdp' }, body: offer.sdp });
  if (!res.ok) {
    // 429: the service's credit or rate limit ran out; nothing the person can fix.
    throw new Error(res.status === 429 ? 'The voice assistant is busy or unavailable right now. Please try again later.' : `Couldn’t reach the voice service (${res.status})`);
  }
  await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
  await opened;

  return {
    send: (event) => dc.readyState === 'open' && dc.send(JSON.stringify(event)),
    close: () => {
      stream.getTracks().forEach((t) => t.stop());
      dc.close();
      pc.close();
    },
  };
}
