import http from 'node:http'
import fs from 'node:fs'
import pg from 'pg'

const PORT = Number(process.env.PORT || 3000)
const SECRET = process.env.IMPORT_SECRET || ''
const SCHEMA_PATH = process.env.SCHEMA_PATH || '/tmp/schema.sql'
const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('DATABASE_URL missing')
  process.exit(1)
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('railway.internal') ? false : { rejectUnauthorized: false },
  max: 4,
})

function unauthorized(res) {
  res.writeHead(401, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error: 'unauthorized' }))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

function isAuthed(req) {
  if (!SECRET) return false
  const header = String(req.headers['x-import-secret'] || '')
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  return header === SECRET || bearer === SECRET
}

function quoteIdent(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) && !/^(auth|public)\.[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`invalid ident ${name}`)
  }
  return name
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      const r = await pool.query('select 1 as ok')
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, db: r.rows[0].ok === 1 }))
      return
    }

    if (!isAuthed(req)) return unauthorized(res)

    if (req.method === 'POST' && url.pathname === '/setup') {
      const sql = fs.readFileSync(SCHEMA_PATH, 'utf8')
      await pool.query(sql)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, applied: true }))
      return
    }

    if (req.method === 'GET' && url.pathname === '/counts') {
      const tables = [
        'auth.users',
        'public.profiles',
        'public.user_sessions',
        'public.bot_runs',
        'public.trades',
        'public.telemetry_events',
        'public.notifications',
        'public.license_checks',
        'public.license_email_whitelist',
        'public.modules',
        'public.lessons',
        'public.lesson_materials',
        'public.lesson_progress',
        'public.app_versions',
        'public.cronograma_operations',
        'public.rate_limits',
      ]
      const out = {}
      for (const t of tables) {
        const r = await pool.query(`select count(*)::int as n from ${t}`)
        out[t] = r.rows[0].n
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, counts: out }))
      return
    }

    if (req.method === 'POST' && url.pathname === '/rows') {
      const body = await readBody(req)
      const table = quoteIdent(String(body.table || ''))
      const conflict = quoteIdent(String(body.conflict || 'id'))
      const rows = Array.isArray(body.rows) ? body.rows : []
      if (rows.length === 0) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, inserted: 0 }))
        return
      }
      const cols = Object.keys(rows[0]).filter((c) => c !== 'confirmed_at')
      for (const c of cols) quoteIdent(c)
      const client = await pool.connect()
      try {
        await client.query('begin')
        let inserted = 0
        for (const row of rows) {
          const values = cols.map((c) => row[c] ?? null)
          const placeholders = cols.map((_, i) => `$${i + 1}`).join(',')
          const updates = cols.filter((c) => c !== conflict).map((c) => `${c} = excluded.${c}`).join(',')
          const sql = updates
            ? `insert into ${table} (${cols.join(',')}) values (${placeholders}) on conflict (${conflict}) do update set ${updates}`
            : `insert into ${table} (${cols.join(',')}) values (${placeholders}) on conflict (${conflict}) do nothing`
          await client.query(sql, values)
          inserted += 1
        }
        await client.query('commit')
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, inserted }))
      } catch (e) {
        await client.query('rollback')
        throw e
      } finally {
        client.release()
      }
      return
    }

    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'not_found' }))
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : 'error' }))
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`import-server listening on ${PORT}`)
})
