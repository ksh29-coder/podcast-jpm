const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = path.join(__dirname, '..', 'data', 'episodes.json');

function loadCatalogue(filePath = DEFAULT_PATH) {
  const episodes = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  // Newest first, so the app can render the list as-is.
  return episodes.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

// Catalogue stores media as server-relative paths; clients need absolute URLs.
function absolutize(url, baseUrl) {
  return url && url.startsWith('/') ? baseUrl + url : url;
}

function withAbsoluteUrls(episode, baseUrl) {
  return {
    ...episode,
    artworkUrl: absolutize(episode.artworkUrl, baseUrl),
    audioUrl: absolutize(episode.audioUrl, baseUrl),
    videoUrl: absolutize(episode.videoUrl, baseUrl),
    clips: episode.clips.map((clip) => ({
      ...clip,
      videoUrl: absolutize(clip.videoUrl, baseUrl),
    })),
  };
}

// Flatten every episode's clips into one feed, newest episode first,
// each clip carrying enough to jump into the full episode.
function shortsFeed(episodes, baseUrl) {
  return episodes.flatMap((ep) =>
    ep.clips.map((clip) => ({
      ...clip,
      videoUrl: absolutize(clip.videoUrl, baseUrl),
      episodeId: ep.id,
      episodeTitle: ep.title,
      artworkUrl: absolutize(ep.artworkUrl, baseUrl),
    }))
  );
}

module.exports = { loadCatalogue, withAbsoluteUrls, shortsFeed };
