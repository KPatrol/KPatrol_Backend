// Single source of truth for auth-related secrets.
// Both AuthModule (signing) and JwtStrategy (verifying) must use the same value
// or tokens will silently fail to validate.

const DEV_FALLBACK = 'kpatrol-dev-only-secret-do-not-use-in-prod';

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length > 0) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET is required in production. Set it in the environment before starting the server.',
    );
  }

  // Dev/test only — log once so a missing prod secret can't hide.
  // eslint-disable-next-line no-console
  console.warn('[auth.config] JWT_SECRET not set — using dev fallback. DO NOT deploy like this.');
  return DEV_FALLBACK;
}

export const JWT_EXPIRES_IN = '7d';

const DEV_ROBOT_KEY = 'dev-robot-key';

/**
 * Shared symmetric key used by Pi/firmware to authenticate the Socket.IO
 * handshake (type=robot). Distinct from JWT — Pi devices are not "users" so
 * we don't issue them per-device JWTs; a long-lived API key matches reality
 * better and rotates by env change rather than token churn.
 */
/**
 * Short-TTL signing secret for MJPEG stream tokens. Distinct from JWT_SECRET so
 * it can rotate independently — leaking a 60s stream token is far less critical
 * than leaking a 7-day session token, but coupling the secrets means a rotation
 * forces every operator to re-login. Pi must hold the same value to verify.
 */
const DEV_STREAM_SECRET = 'kpatrol-dev-stream-secret-do-not-use-in-prod';

export function getStreamTokenSecret(): string {
  const secret = process.env.STREAM_TOKEN_SECRET;
  if (secret && secret.length > 0) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'STREAM_TOKEN_SECRET is required in production. Generate with `openssl rand -hex 32`.',
    );
  }

  // eslint-disable-next-line no-console
  console.warn(
    '[auth.config] STREAM_TOKEN_SECRET not set — using dev fallback. DO NOT deploy like this.',
  );
  return DEV_STREAM_SECRET;
}

export const STREAM_TOKEN_TTL_SECONDS = 60;

export function getRobotApiKey(): string {
  const key = process.env.ROBOT_API_KEY;
  if (key && key.length > 0) return key;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'ROBOT_API_KEY is required in production. Generate with `openssl rand -hex 32`.',
    );
  }

  // eslint-disable-next-line no-console
  console.warn(
    '[auth.config] ROBOT_API_KEY not set — using dev fallback. DO NOT deploy like this.',
  );
  return DEV_ROBOT_KEY;
}
