# AI Wave app

Expo (React Native) app for iPhone and Android: build step 2–4 of the project brief.

- **Episodes**: list with listening progress; episode page with play/pause, back 15s / forward 30s,
  speed, a scrub bar, tappable chapters, and an Audio/Video toggle that keeps your place.
- **Shorts**: vertical swipe feed of clips; "Play full episode from here" opens the episode at that clip.
- **＋ (New)**: anyone can post a Short. Record with the camera or choose a video (Upload, bottom left),
  trim it to 90 seconds, then add details while it uploads; AI suggests the title, description, tags
  and cover from what's said. It waits for a host to approve it (Host mode → Shorts to review).
- **Voice assistant** (mic in Search): a live spoken conversation about what's on AI Wave. It
  searches episodes, Shorts and transcripts, summarizes and recommends, and shows what it finds as
  cards. 3 minutes per conversation, 10 minutes a day. Needs app version 1.1.0 or later (native
  WebRTC; `plugins/withSpeakerAudio.js` sends its voice to the loudspeaker).
- **Host mode** (shield button on Episodes): review what people post (approve, or reject with a
  note) and take things down. Uploading episodes and editing is in the website's Host Studio.
- **Me**: your name, your Shorts and episodes with their review status (In review, Live with stats, Not approved
  with the host's note), and **Downloads**: an episode's audio saved for offline listening
  (not available in the web preview).
- One shared audio player: keeps playing while you browse, with the screen locked, with lock-screen
  controls, and saves your position to the backend so you can resume on another device.

## Try it on your iPhone

1. Install **Expo Go** from the App Store. The app uses Expo SDK 57, which Expo Go 57.x supports.
2. Get a backend the phone can reach: either a deployed URL, or run `backend/` on your computer
   (`npm install && npm run media && npm start`) and use `http://<your-computer's-Wi-Fi-IP>:3000`.
3. On your computer:
   ```sh
   cd app
   npm install
   echo "EXPO_PUBLIC_API_URL=<backend URL from step 2>" > .env.local
   npx expo start
   ```
4. Scan the QR code with the iPhone camera. The phone and computer must be on the same Wi-Fi
   (or use `npx expo start --tunnel`).

## Website

The same app on the web, laid out for a computer: a sidebar (Home, Shorts, Search, Me), a Home page
with the newest episode and grids, a centred Shorts player (arrow keys or the mouse wheel to move), a
two-column episode page, and **New**, where anyone can post a Short (trimmed to 90 seconds) or a
whole episode from a video file. `/host` is the **Host Studio**: Review, Episodes, Shorts, and
uploading. Narrow windows get a bottom bar instead of the sidebar.

`npx expo start --web` runs it locally, with the backend at `http://localhost:3000`
by default.

## Checks

```sh
npx tsc --noEmit
```
