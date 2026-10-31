// The website has no phone alerts; its Activity list has everything.

export type AlertsState = 'on' | 'off' | 'unasked';

export function useAlerts() {}

export async function offerAlerts(_reason: string) {}

export async function turnOn(): Promise<AlertsState> {
  return 'off';
}

export function useAlertsState() {
  return [null, () => {}] as const;
}
