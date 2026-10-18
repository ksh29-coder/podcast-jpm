// Vercel entry point: every /api and /health request goes to the Express app.
// Media under public/ is served by Vercel's CDN directly (see vercel.json).
module.exports = require('../src/app').createApp();
