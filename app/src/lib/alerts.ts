import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router, useRootNavigationState } from 'expo-router';
import { refreshActivity } from './activity';
import { api } from './api';
import { getItem, setItem } from './storage';

// Phone alerts (Expo push): replies, comments on your posts, hosts' reviews
// and new episodes. The app asks once, right after someone posts a Short or a
// comment, when it's clear why; Me has the switches. The website has none.

export type AlertsState = 'on' | 'off' | 'unasked';

// Shown while the app is open too, as a banner; Activity updates with it.
Notifications.setNotificationHandler({
  handleNotification: async () => {
    refreshActivity();
    return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false };
  },
});

async function state(): Promise<AlertsState> {
  const p = await Notifications.getPermissionsAsync();
  if (p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'on';
  return p.canAskAgain ? 'unasked' : 'off';
}

// Sends this phone's token to the server, so alerts reach it. Tokens can
// change (e.g. after restoring a backup), so this runs at every start.
async function register() {
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.savePushToken(data);
  } catch (e) {
    console.warn('alerts', e instanceof Error ? e.message : e);
  }
}

// At start: sign this phone up if alerts are on. Used once, by the root layout.
export function useAlerts() {
  useEffect(() => {
    state().then((s) => {
      if (s === 'on') register();
    });
  }, []);
  // Tapping an alert opens what it's about: the one that opened the app, then
  // any tapped while it runs. Each once, even if the launch one also reaches
  // the listener; and only once navigation is ready, which at launch it
  // isn't yet.
  const [tapped, setTapped] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    const open = (r: Notifications.NotificationResponse | null) => {
      const url = r?.notification.request.content.data?.url;
      if (r && typeof url === 'string' && url.startsWith('/')) setTapped({ id: r.notification.request.identifier, url });
    };
    Notifications.getLastNotificationResponseAsync().then(open);
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, []);
  const ready = !!useRootNavigationState()?.key;
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !tapped || opened.current === tapped.id) return;
    opened.current = tapped.id;
    router.push(tapped.url as never);
  }, [ready, tapped]);
}

// After posting a Short or a comment: offer alerts once, saying why.
export async function offerAlerts(reason: string) {
  if ((await state()) !== 'unasked' || (await getItem('alerts-offered'))) return;
  await setItem('alerts-offered', '1');
  Alert.alert('Get told when there’s news?', reason, [
    { text: 'Not now', style: 'cancel' },
    { text: 'Turn on', onPress: () => turnOn() },
  ]);
}

// Asks iOS (once; after that only Settings can change it).
export async function turnOn(): Promise<AlertsState> {
  const now = await state();
  if (now === 'off') {
    Linking.openSettings();
    return now;
  }
  if (now === 'unasked') await Notifications.requestPermissionsAsync();
  const after = await state();
  if (after === 'on') await register();
  return after;
}

// Whether alerts are on, kept fresh when coming back from Settings.
export function useAlertsState() {
  const [s, setS] = useState<AlertsState | null>(null);
  useEffect(() => {
    state().then(setS);
    const sub = AppState.addEventListener('change', (a) => {
      if (a !== 'active') return;
      state().then((next) => {
        setS(next);
        if (next === 'on') register();
      });
    });
    return () => sub.remove();
  }, []);
  return [s, setS] as const;
}
