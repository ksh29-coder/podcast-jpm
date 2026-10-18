// Auth placeholder. The brief has OIDC SSO as the last build step, so for now
// AUTH_MODE=none (the default) treats every request as one dev user. When OIDC
// lands, this middleware validates the bearer token and sets req.user from it.
function authMiddleware({ mode = process.env.AUTH_MODE || 'none' } = {}) {
  if (mode === 'none') {
    return (req, res, next) => {
      req.user = { id: 'dev-user' };
      next();
    };
  }
  throw new Error(`Unsupported AUTH_MODE: ${mode}`);
}

module.exports = { authMiddleware };
