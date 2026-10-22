// A live audio connection to the voice service (OpenAI Realtime over WebRTC):
// the microphone goes up, the voice comes back, and events (including tool
// calls) travel on a data channel. This is the browser version; the phone's
// is rtc.ts.

export type VoiceEvent = { type: string; [key: string]: unknown };
export type VoiceOptions = { token: string; connectUrl: string; onEvent: (event: VoiceEvent) => void };
export type VoiceConnection = { send: (event: object) => void; close: () => void };

export async function connectVoice({ token, connectUrl, onEvent }: VoiceOptions): Promise<VoiceConnection> {
  const pc = new RTCPeerConnection();
  const audio = document.createElement('audio');
  audio.autoplay = true;
  pc.ontrack = (e) => {
    audio.srcObject = e.streams[0];
  };
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  pc.addTrack(stream.getAudioTracks()[0], stream);
  const dc = pc.createDataChannel('oai-events');
  const opened = new Promise<void>((resolve) => dc.addEventListener('open', () => resolve()));
  dc.addEventListener('message', (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {
      // Not an event we understand.
    }
  });
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') onEvent({ type: 'connection.closed' });
  });

  const offer = await pc.createOffer();
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
      audio.srcObject = null;
    },
  };
}
