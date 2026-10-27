const rateLimit = require('express-rate-limit')

// An unset or empty variable takes the default; 0 turns that limit off.
const envNumber = (name, fallback) => (process.env[name] === undefined || process.env[name] === '' ? fallback : Number(process.env[name]))
const windowMs = envNumber('RATE_LIMIT_WINDOW_MINUTES', 5) * 60 * 1000

// The tablet a POST comes from: its device id, else the session uid's prefix. Session uploads carry
// no device id, and the prefix is the tablet that admitted the baby, so several tablets can share it.
const tabletKey = (req) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const device = body.deviceId || body.device || req.query.deviceId
  if (device) return `device:${device}`
  const uid = `${req.query.uid || body.uid || ''}`
  const prefix = uid.split('-')[0]
  return uid.includes('-') && prefix ? `uid:${prefix}` : `ip:${req.ip}`
}

// Uploads, mounted after the API key check so that only requests with a valid key count. The default,
// about 100 a second per tablet, covers many tablets clearing an offline backlog of one admitting
// tablet's patients at once; the app retries anything refused with 429.
const tabletLimiter = rateLimit({
  windowMs,
  max: envNumber('RATE_LIMIT_MAX', 30000),
  skip: (req) => req.method !== 'POST',
  keyGenerator: tabletKey,
  standardHeaders: true,
  legacyHeaders: false,
})

// Everything else (reads, health checks, dashboards), by IP. Behind the TLS proxy every request has the
// proxy's IP, so this is one allowance shared by all of them.
const readLimiter = rateLimit({
  windowMs,
  max: envNumber('RATE_LIMIT_READ_MAX', 6000),
  skip: (req) => req.method === 'POST',
  standardHeaders: true,
  legacyHeaders: false,
})

module.exports = { tabletLimiter, readLimiter, tabletKey }
