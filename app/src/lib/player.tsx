import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, type AudioStatus } from 'expo-audio';
import { api, type Episode, type Progress } from './api';
import { localAudioUri } from './downloads';
import { getItem, setItem } from './storage';

const SAVE_EVERY_SEC = 10;

// Listening preferences, kept on the device and applied to every episode.
export type PlaybackPrefs = { rate: number; skipBack: number; skipForward: number };
const DEFAULT_PREFS: PlaybackPrefs = { rate: 1, skipBack: 15, skipForward: 30 };
// expo-audio plays at most 2× on phones.
export const MIN_RATE = 0.5;
export const MAX_RATE = 2;

// Sleep timer: pause after some minutes, or when the current chapter ends.
export type Sleep = { kind: 'time'; endsAt: number } | { kind: 'chapter'; atSec: number; title: string } | null;

type PlayerContextValue = {
  episode: Episode | null;
  status: AudioStatus;
  progress: Progress;
  playEpisode: (episode: Episode, startSec?: number) => void;
  togglePlay: () => void;
  pause: () => void;
  seekTo: (sec: number) => void;
  seekBy: (deltaSec: number) => void;
  setRate: (rate: number) => void;
  prefs: PlaybackPrefs;
  setSkip: (back: number, forward: number) => void;
  sleep: Sleep;
  // Seconds until a timed sleep pauses playback (null when not timed).
  sleepLeftSec: number | null;
  // Minutes, 'chapter' for the end of the current chapter, or null to cancel.
  setSleep: (option: number | 'chapter' | null) => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

// One app-wide audio player, so playback carries on while you browse other
// screens, keeps going with the screen locked, and shows lock-screen controls.
export function PlayerProvider({ children }: { children: ReactNode }) {
  const player = useAudioPlayer(null, { updateInterval: 500 });
  const status = useAudioPlayerStatus(player);
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [progress, setProgress] = useState<Progress>({});
  const pendingSeek = useRef<number | null>(null);
  const seekAttempts = useRef(0);
  const lastSaved = useRef(0);
  const [prefs, setPrefs] = useState<PlaybackPrefs>(DEFAULT_PREFS);
  const [sleep, setSleepState] = useState<Sleep>(null);
  const [sleepLeftSec, setSleepLeftSec] = useState<number | null>(null);
  const statusRef = useRef(status);

  useEffect(() => {
    statusRef.current = status;
  });

  useEffect(() => {
    getItem('playback-prefs').then((saved) => {
      if (!saved) return;
      try {
        setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(saved) });
      } catch {
        // Unreadable: keep the defaults.
      }
    });
  }, []);

  const updatePrefs = useCallback((patch: Partial<PlaybackPrefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      setItem('playback-prefs', JSON.stringify(next));
      return next;
    });
  }, []);

  // Each new episode starts at normal speed in expo-audio; bring it back to
  // the chosen speed once it has loaded.
  useEffect(() => {
    if (status.isLoaded && Math.abs(status.playbackRate - prefs.rate) > 0.01) player.setPlaybackRate(prefs.rate);
  }, [status.isLoaded, status.playbackRate, prefs.rate, player]);

  // While a sleep timer is set, check once a second whether it's time to pause.
  useEffect(() => {
    if (!sleep) return;
    const tick = () => {
      const s = statusRef.current;
      if (sleep.kind === 'time') setSleepLeftSec(Math.max(0, Math.round((sleep.endsAt - Date.now()) / 1000)));
      const due = sleep.kind === 'time' ? Date.now() >= sleep.endsAt : s.currentTime >= sleep.atSec;
      if (!due) return;
      player.pause();
      setSleepState(null);
      setSleepLeftSec(null);
    };
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [sleep, player]);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      // Lock-screen controls require exclusive audio.
      interruptionMode: 'doNotMix',
    }).catch(() => {});
    api.progress().then(setProgress).catch(() => {});
  }, []);

  const save = useCallback((ep: Episode, positionSec: number) => {
    const sec = Math.min(Math.max(0, Math.floor(positionSec)), ep.durationSec);
    lastSaved.current = sec;
    setProgress((p) => ({ ...p, [ep.id]: { positionSec: sec, updatedAt: new Date().toISOString() } }));
    api.saveProgress(ep.id, sec).catch(() => {});
  }, []);

  // Seeking before the new source has loaded is ignored on some platforms, so
  // playEpisode parks the start position here and we retry on each status
  // update until playback is actually there.
  useEffect(() => {
    const target = pendingSeek.current;
    if (target === null || !status.isLoaded || status.duration <= 0) return;
    if (Math.abs(status.currentTime - target) < 2 || seekAttempts.current >= 10) {
      pendingSeek.current = null;
      return;
    }
    seekAttempts.current += 1;
    player.seekTo(target);
  }, [status, player]);

  useEffect(() => {
    if (!episode || pendingSeek.current !== null) return;
    if (status.playing && Math.abs(status.currentTime - lastSaved.current) >= SAVE_EVERY_SEC) {
      save(episode, status.currentTime);
    }
  }, [status.currentTime, status.playing, episode, save]);

  // Save on pause too, so resuming elsewhere is exact.
  useEffect(() => {
    if (episode && pendingSeek.current === null && !status.playing && status.isLoaded && status.currentTime > 0) {
      save(episode, status.currentTime);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.playing]);

  const playEpisode = useCallback(
    (ep: Episode, startSec?: number) => {
      if (episode?.id === ep.id && startSec === undefined) {
        player.play();
        return;
      }
      if (episode?.id === ep.id && startSec !== undefined) {
        // After the episode has finished, play() sent before the seek lands is dropped.
        player.seekTo(startSec).then(() => player.play(), () => player.play());
        return;
      }
      // Video-only episodes have nothing for the audio player to play.
      if (!ep.audioUrl) return;
      const resumeAt = startSec ?? progress[ep.id]?.positionSec ?? 0;
      // Start over if they'd already reached the end.
      pendingSeek.current = resumeAt >= ep.durationSec - 5 ? 0 : resumeAt;
      seekAttempts.current = 0;
      lastSaved.current = pendingSeek.current;
      player.replace({ uri: localAudioUri(ep.id) ?? ep.audioUrl });
      player.play();
      player.setActiveForLockScreen(
        true,
        { title: ep.title, artist: 'AI Dev Podcast', artworkUrl: ep.artworkUrl },
        { showSeekBackward: true, showSeekForward: true }
      );
      setEpisode(ep);
    },
    [episode, player, progress]
  );

  const value: PlayerContextValue = {
    episode,
    status,
    progress,
    playEpisode,
    togglePlay: () => (status.playing ? player.pause() : player.play()),
    pause: () => player.pause(),
    seekTo: (sec) => player.seekTo(sec),
    seekBy: (delta) =>
      player.seekTo(Math.min(Math.max(0, status.currentTime + delta), status.duration || Infinity)),
    setRate: (rate) => {
      const r = Math.round(Math.min(MAX_RATE, Math.max(MIN_RATE, rate)) * 100) / 100;
      updatePrefs({ rate: r });
      player.setPlaybackRate(r);
    },
    prefs,
    setSkip: (back, forward) => updatePrefs({ skipBack: back, skipForward: forward }),
    sleep,
    sleepLeftSec: sleep?.kind === 'time' ? sleepLeftSec : null,
    setSleep: (option) => {
      setSleepLeftSec(typeof option === 'number' ? option * 60 : null);
      if (option === null) return setSleepState(null);
      if (option === 'chapter') {
        const t = status.currentTime;
        const next = episode?.chapters.find((c) => c.startSec > t + 1);
        const current = [...(episode?.chapters ?? [])].reverse().find((c) => c.startSec <= t);
        // No later chapter: stop at the end of the episode.
        return setSleepState({ kind: 'chapter', atSec: next ? next.startSec : status.duration - 0.5, title: current?.title ?? 'this chapter' });
      }
      setSleepState({ kind: 'time', endsAt: Date.now() + option * 60_000 });
    },
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside PlayerProvider');
  return ctx;
}
