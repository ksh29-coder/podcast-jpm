# AI Dev Podcast app

Expo (React Native) app for iPhone and Android: build step 2–4 of the project brief.

- **Episodes**: list with listening progress; episode page with play/pause, back 15s / forward 30s,
  speed, a scrub bar, tappable chapters, and an Audio/Video toggle that keeps your place.
- **Shorts**: vertical swipe feed of clips; "Play full episode from here" opens the episode at that clip.
- **Downloads**: save an episode's audio to the phone and play it offline (not available in the web preview).
- One shared audio player: keeps playing while you browse, with the screen locked, with lock-screen
  controls, and saves your position to the backend so you can resume on another device.

## Try it on your iPhone

1. Install **Expo Go** from the App Store.
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

## Web preview

`npx expo start --web` runs the same app in a browser, with the backend at `http://localhost:3000`
by default.

## Checks

```sh
npx tsc --noEmit
```
