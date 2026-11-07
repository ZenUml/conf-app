import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createNodeSqliteAdapter, ingestRowsCore } from '../../scripts/lifecycle/ingestCore.mjs'
import { SUBJECTS } from '../../scripts/lifecycle/senderCore.mjs'
import { loadMarketplaceRows } from './extensionsLive'

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')
const HERE = dirname(fileURLToPath(import.meta.url))
const LOCAL_DIR = resolve(HERE, '..', '.local')
const DATABASE_PATH = join(LOCAL_DIR, 'lifecycle.sqlite')
const MIGRATION_PATH = resolve(HERE, '..', '..', 'functions', 'migrations', '0024_add_lifecycle_crm.sql')
const TEMPLATE_DIR = resolve(HERE, '..', '..', 'scripts', 'lifecycle', 'templates')
const APP_KEYS = /** @type {const} */ (['lite', 'full', 'dia', 'api'])
const TEMPLATE_APPS = { lite: 'lite', full: 'full', dia: 'diagramly', api: 'asyncapi' }
const CACHE_MS = 30_000
let cached = null

function openDatabase() {
  mkdirSync(LOCAL_DIR, { recursive: true })
  const db = new DatabaseSync(DATABASE_PATH)
  db.exec(readFileSync(MIGRATION_PATH, 'utf8'))
  return db
}

function previewFor(app) {
  const templateApp = TEMPLATE_APPS[app]
  return {
    app,
    subject: SUBJECTS[templateApp],
    html: readFileSync(join(TEMPLATE_DIR, `welcome-${templateApp}.html`), 'utf8')
  }
}

function contactId(email, app) {
  return `${app}:${email}`
}

function parseMeta(value) {
  if (typeof value !== 'string' || !value) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function loadLifecycleResponse({ fresh = false } = {}) {
  if (!fresh && cached?.expiresAt > Date.now()) return cached.value
  const value = (async () => {
    const rawRows = await loadMarketplaceRows({ fresh })
    const db = openDatabase()
    try {
      const now = new Date().toISOString()
      const { hostnameByCloudId } = ingestRowsCore(createNodeSqliteAdapter(db), rawRows, { bootstrap: true, now })
      const rows = db.prepare(`SELECT contact_email, app, cloud_id, seat_tier, license_type, eval_ends_at,
        step, suppressed, first_seen_at, last_seen_at
        FROM lifecycle_contact ORDER BY last_seen_at DESC, app, contact_email`).all()
      const contacts = rows.map(row => ({
        id: contactId(row.contact_email, row.app),
        email: row.contact_email,
        app: row.app,
        cloudId: row.cloud_id,
        domain: hostnameByCloudId.get(row.cloud_id) ?? null,
        licenseType: row.license_type,
        seatTier: row.seat_tier,
        evalEndsAt: row.eval_ends_at,
        step: row.step,
        suppressed: Boolean(row.suppressed),
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at
      }))
      const touchpoints = db.prepare(`SELECT id, app, kind, step, meta, created_at
        FROM lifecycle_touchpoint ORDER BY created_at DESC, id DESC`).all().map(row => ({
        id: Number(row.id),
        app: row.app,
        kind: row.kind,
        step: row.step ?? null,
        meta: parseMeta(row.meta),
        createdAt: row.created_at
      }))
      const byStep = Object.fromEntries([...new Set(contacts.map(contact => contact.step))].sort().map(step => [step, contacts.filter(contact => contact.step === step).length]))
      return {
        contractVersion: 1,
        generatedAt: now,
        source: {
          state: 'ok',
          marketplaceRows: rawRows.length,
          localDatabase: 'lifecycle.sqlite',
          detail: 'Local Marketplace ingest into bootstrap-suppressed SQLite contacts'
        },
        summary: {
          contacts: contacts.length,
          tenants: new Set(contacts.map(contact => contact.cloudId)).size,
          suppressed: contacts.filter(contact => contact.suppressed).length,
          byStep
        },
        contacts,
        touchpoints,
        previews: APP_KEYS.map(previewFor)
      }
    } finally {
      db.close()
    }
  })()
  cached = { expiresAt: Date.now() + CACHE_MS, value }
  value.catch(() => { if (cached?.value === value) cached = null })
  return value
}
