'use strict'

// The only address the preview is ever sent to.
const PREVIEW_TO = 'wilson@neotree.org'

const fs = require('fs')
const os = require('os')
const path = require('path')

const APP_DIR = path.resolve(__dirname, '..')
require('dotenv').config({ path: process.env.ENV_FILE || path.join(APP_DIR, '.env') })

const sendEmail = require('../server/mailer')
const db = require('../server/queries')({}, {})

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}

function options() {
  if (!/^[^\s@,;]+@[^\s@,;]+$/.test(PREVIEW_TO)) throw new Error('Set PREVIEW_TO at the top of this script to one email address')

  const limit = arg('limit') === undefined ? 20 : Number(arg('limit'))
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('--limit must be a whole number from 1 to 1000')

  const out = path.resolve(arg('out') || path.join(os.tmpdir(), `ce-digest-preview-${new Date().toISOString().replace(/[:.]/g, '-')}.html`))
  const inside = path.relative(APP_DIR, out)
  if (!(inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside))) {
    throw new Error(`--out must be outside ${APP_DIR}: pm2 watches that folder and would restart the server`)
  }
  return { limit, out }
}

async function main() {
  const { limit, out } = options()

  let rows = await db.loadCeDigestRows()
  let source = `the ${rows.length} unsent CE report(s) the next digest would send`
  if (!rows.length) {
    rows = await db.loadRecentCeRows(limit)
    source = `the last ${rows.length} CE report(s), which were already sent, since none are unsent`
  }
  if (!rows.length) return console.log('No CE reports found, so there is nothing to preview.')

  const digest = await db.buildCeDigest(rows, { note: `Preview sent only to ${PREVIEW_TO}, built from ${source}. Nothing was marked as sent.` })
  fs.writeFileSync(out, digest.html, { flag: 'wx', mode: 0o600 })

  const configured = process.env.EDITOR_URL && process.env.EDITOR_API_KEY
  console.log(`Built from ${source}.`)
  console.log(`Subject:     ${digest.subject}`)
  console.log(`Daily digest goes to: ${process.env.CE_DIGEST_RECEIVERS || process.env.MAIL_RECEIVERS || '(no recipients set)'} (not emailed now)`)
  console.log(`Locations:   ${digest.located ? `from ${process.env.EDITOR_URL}` : configured ? 'unavailable, the web editor lookup failed (see the error above)' : 'off, EDITOR_URL / EDITOR_API_KEY not set'}`)
  console.log(`Saved:       ${out}`)

  await new Promise((resolve, reject) => sendEmail.raw({ to: PREVIEW_TO, subject: `[PREVIEW] ${digest.subject}`, html: digest.html }, (e) => (e ? reject(e) : resolve())))
  console.log(`Emailed the preview to ${PREVIEW_TO} only.`)
  console.log('Nothing was marked as sent.')
}

main()
  .then(() => 0, (e) => {
    console.error('Preview failed:', e.message)
    return 1
  })
  .then((code) => db.pool.end().catch((e) => console.error('Could not close the database connection:', e.message)).then(() => process.exit(code)))
