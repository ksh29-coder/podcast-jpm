const { createApp } = require('./app');

const port = Number(process.env.PORT) || 3000;

createApp().listen(port, () => {
  console.log(`Podcast backend listening on http://localhost:${port}`);
});
