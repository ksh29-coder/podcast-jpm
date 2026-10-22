import { Slot } from 'expo-router';

// On the website each tab is just a page: the sidebar or bottom bar around
// them is the Shell in the root layout. The phone app uses native tabs
// (_layout.tsx).
export default function WebTabsLayout() {
  return <Slot />;
}
