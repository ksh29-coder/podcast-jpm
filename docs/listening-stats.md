# Listening stats: requirements

What AI Wave records about listening and watching, and what hosts see. Based on what Spotify,
Apple Podcasts, YouTube and Microsoft Stream measure (research, November 2026), and decisions
made with the product owner.

## Decisions

| Question | Decision |
| --- | --- |
| Can hosts see who listened? | **No.** Hosts see totals and charts only, never names or per-person lists. |
| Who sees the stats? | **Hosts**, in the Host Studio. |
| Metric definitions | **Industry defaults** below (Spotify's play, Apple's engaged listener), kept in one place so they can be changed later. |
| Does watching a Short count as listening to its episode? | **Yes** (see "Shorts and their episode"). |
| A listening history for listeners | **Later.** |
| Exports (CSV, other systems) | **No.** |

## What exists today

- `progress`: per person and episode, the last position (resume on another device) and the furthest point.
- `views`, `likes`, comments: one view per person, whatever they watched.
- "How far people got" on the host's episode page, from the furthest points.

These stay. Resume keeps working as it does.

## 1. What the app records

On the iPhone and Android apps and the website.

**Listening sessions (episodes).** A session starts when an episode starts playing and ends after
it stops (paused or closed for 30 minutes, or another episode starts). For each session:

- **The parts played**, as ranges in the episode's own time (for example 0:00–12:30 and
  18:00–25:10), so skipping and replaying can be told apart.
- **Time listened**: seconds of the episode heard. At 2× speed, ten minutes of episode heard in
  five minutes counts as ten.
- **Where it stopped**: the last position when the session ended.
- **Mode**: audio or video. **Platform**: iOS, Android or web. **Speed** (most used).
  **Downloaded**: played from a download, offline.
- **Where it was started from**: Home, Search, the episode page, a Short ("play full episode"),
  a notification, a shared link, or "continue listening".
- The episode's video version (see "Edited episodes").

**Shorts.** For each time a Short is shown in the feed:

- **Seconds watched**, and whether it **looped**.
- **Swiped away** within its first 3 seconds.
- Whether the viewer tapped **"Play full episode"**.

**How it's sent.**

- Updates about every 30 seconds while playing, and straight away on pause, seek, closing the app
  or going to the background. No per-second events.
- Kept on the device when offline (downloads, no signal) and sent later; a session is never
  counted twice.
- Uses the same identity as everything else: a device until company sign-in, then the person.

## 2. Definitions

Kept together in one settings file, each shown to hosts as a hint next to the number. The
defaults:

| Metric | Definition |
| --- | --- |
| **Play** | A session that heard at least **30 seconds** (Spotify's rule; ignores accidental starts). |
| **Listener** | A distinct person (a device, before sign-in) with at least one play. |
| **Engaged listener** | A listener who heard at least **40% or 20 minutes** of the episode, in total (Apple's rule). |
| **Time listened** | Seconds of the episode heard, added up over everyone. |
| **Average consumption** | Time listened ÷ (listeners × episode length), as a percentage. Above 100% means replays. |
| **Completed** | A listener who heard at least **90%** of the episode. |
| **Retention at a point** | The share of listeners who heard that point of the episode. |
| **Where people stopped** | Where sessions ended, for listeners who didn't complete it. |
| **Shorts: viewed** | Shown and watched past its first 3 seconds (the rest: **swiped away**). |
| **First 7 days** | The same figures for the 7 days after the episode went live, to compare episodes fairly. |

## 3. What hosts see (Host Studio)

**Per episode** (on the episode's page):

- Plays, listeners, engaged listeners, time listened, average consumption, completion rate:
  all time and first 7 days.
- **Retention chart** across the episode, with the **chapters** marked and the **transcript**
  at any point on hover, so a drop shows what was being said when people left.
- **Where people stopped**: the points where most listeners stopped, with what was being said.
- **Key moments**, found automatically: the intro (how many stay past the first minute), parts
  people **skip**, parts people **replay**, and the **biggest drops**.
- Split by **audio / video**, **platform**, **where it was started from**, and **new / returning**
  listeners (first episode they played, or not).
- **From its Shorts**: how many listeners and how much time came from the episode's Shorts.

**Across the show** (a Stats section in the Host Studio):

- Total time listened, listeners per week, plays, and engaged listeners over time.
- Episodes ranked by listeners, engaged listeners and completion (all time and first 7 days).
- **Shorts**: views, viewed vs swiped away, average % watched, loops, and how many went on to the
  full episode.

## 4. Shorts and their episode

Watching a Short **counts as listening to its episode**:

- A Short cut from an episode (it knows where it sits in the episode) adds its watched seconds to
  the episode's **time listened**, and a person who watched at least 30 seconds of the episode
  this way counts as one of its **listeners**.
- The episode's **retention chart** shows the episode's own plays, with the part heard through
  Shorts as a separate layer, so a popular Short doesn't look like a part of the episode people
  replayed.
- An uploaded Short linked to an episode but not cut from it has no place in the episode, so it
  counts in the Shorts stats only.

## 5. Privacy

- Hosts see **totals and charts only**: no names, no per-person lists, no searches by person,
  in the app or the API.
- **At least 5 people**: any figure or split based on fewer than 5 listeners shows "Fewer than 5"
  instead, so nobody can be singled out (for example, "the only Android listener").
- Per-person records are used only to resume playback, to count each person once, and (later)
  for the listener's own history.
- **How long it's kept**: listening sessions for 13 months, then only the totals; deleted with
  the episode or Short.
- The app's privacy page says what's recorded, and why.
- To be checked with the firm's compliance and privacy teams before launch.

## 6. Edited episodes

An episode's video can only be edited while it isn't live, so the stats of a published episode
always refer to one version. Sessions record the version, so if editing live episodes is
allowed later, older stats can be kept apart or moved to the new times.

## 7. How it's built

- One row per listening session, updated as it goes (its played ranges, time listened, where it
  stopped), not one row per update. Shorts views the same way. For about 1,000 people listening to
  two 30-minute episodes a week, that's about 2,000 rows a week.
- Figures for the dashboard are worked out every 15 minutes and stored, not on every page load.
- The Host Studio's dashboard reads only those stored figures, which have the 5-person rule
  applied already.
- Mux Data (the video service's own analytics) can be switched on separately for video
  quality (start-up time, buffering); it isn't part of these stats.

## Not now

- A listening history and "your listening this month" for listeners.
- Exports (CSV) and sending stats to other systems.
- Stats for episode authors who aren't hosts.

## Plan

| Phase | What | Rough effort |
| --- | --- | --- |
| 1 | Recording: listening sessions and Shorts views on iOS, Android and the web, with offline sending | 1–1.5 weeks |
| 2 | Figures and the per-episode stats: numbers, retention with chapters and transcript, where people stopped, key moments | 1.5–2 weeks |
| 3 | Show-wide stats and the Shorts table; the privacy page; deleting old sessions | about 1 week |
