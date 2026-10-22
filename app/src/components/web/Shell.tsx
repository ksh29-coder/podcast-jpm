import type { ReactNode } from 'react';

// The website's frame (sidebar, now-playing bar) is Shell.web.tsx; the phone
// app has native tabs instead, so here it's just the page.
export function Shell({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
