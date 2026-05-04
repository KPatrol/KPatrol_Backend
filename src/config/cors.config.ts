// Shared allowlist for HTTP CORS (main.ts) and WebSocket CORS (socket.gateway.ts).
// Single source of truth so a new origin only needs to be added in one place.

const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:8001',
  'http://localhost:8002',
  'https://kpatrol.khoavd.online',
  'https://monitor.khoavd.online',
];

export function getAllowedOrigins(): string[] {
  const extra = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...DEFAULT_ORIGINS, ...extra];
}
