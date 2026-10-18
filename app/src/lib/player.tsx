import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, type AudioStatus } from 'expo-audio';
import { api, type Episode, type Progress } from './api';
import { localAudioUri } from './downloads';

const SAVE_EVERY_SEC = 10;

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
        player.seekTo(startSec);
        player.play();
        return;
      }
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
    setRate: (rate) => player.setPlaybackRate(rate),
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside PlayerProvider');
  return ctx;
}
