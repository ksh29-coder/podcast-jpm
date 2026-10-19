// Auth placeholder. The brief has OIDC SSO as the last build step, so for now
// AUTH_MODE=none (the default) identifies each device by the random id the app
// sends as X-Device-Id (so likes and views count once per device), falling
// back to one dev user. When OIDC lands, this middleware validates the bearer
// token and sets req.user from it.
const DEVICE_ID = /^[A-Za-z0-9-]{16,64}$/;

function authMiddleware({ mode = process.env.AUTH_MODE || 'none' } = {}) {
  if (mode === 'none') {
    return (req, res, next) => {
      const device = req.get('X-Device-Id');
      req.user = { id: device && DEVICE_ID.test(device) ? `device:${device}` : 'dev-user' };
      next();
    };
  }
  throw new Error(`Unsupported AUTH_MODE: ${mode}`);
}

module.exports = { authMiddleware };
