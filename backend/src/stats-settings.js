// The definitions behind the listening stats hosts see (docs/listening-stats.md),
// in one place so they can be changed. The defaults follow Spotify (what
// counts as a play) and Apple Podcasts (an engaged listener).

module.exports = {
  // A play: a session that heard at least this many seconds.
  PLAY_SEC: 30,
  // An engaged listener heard at least this share of the episode, or at
  // least this many seconds of it, in total.
  ENGAGED_SHARE: 0.4,
  ENGAGED_SEC: 20 * 60,
  // A listener who heard at least this share of the episode completed it.
  COMPLETED_SHARE: 0.9,
  // A Short watched for less than this many seconds was swiped away.
  SWIPED_SEC: 3,
  // Figures for an episode's first days live.
  FIRST_DAYS: 7,
  // Nothing based on fewer people than this is shown, so nobody can be
  // singled out ("fewer than 5" instead).
  MIN_PEOPLE: 5,
  // Stats are worked out at most this often and kept in between.
  REFRESH_MIN: 15,
  // Listening sessions and Shorts views are kept this long, then only their
  // totals (plays and time).
  KEEP_MONTHS: 13,
};
