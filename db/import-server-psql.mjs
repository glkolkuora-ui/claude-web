import http from 'node:http'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const PORT = Number(process.env.PORT || 3000)
const SECRET = process.env.IMPORT_SECRET || ''
const SCHEMA_PATH = process.env.SCHEMA_PATH || '/tmp/schema.sql'
const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('DATABASE_URL missing')
  process.exit(1)
}

function runPsql(args, input) {
  return execFileSync('psql', ['--no-psqlrc', '-v', 'ON_ERROR_STOP=1', ...args], {
    env: { ...process.env, DATABASE_URL, PGPASSWORD: undefined },
    input,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })
}

function unauthorized(res) {
  res.writeHead(401, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error: 'unauthorized' }))
}

function isAuthed(req) {
  if (!SECRET) return false
  const header = String(req.headers['x-import-secret'] || '')
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  return header === SECRET || bearer === SECRET
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      const out = runPsql([DATABASE_URL, '-c', 'select 1 as ok'])
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, db: out.includes('1') }))
      return
    }

    if (!isAuthed(req)) return unauthorized(res)

    if (req.method === 'POST' && url.pathname === '/setup') {
      if (!fs.existsSync(SCHEMA_PATH)) throw new Error('schema file missing')
      runPsql([DATABASE_URL, '-f', SCHEMA_PATH])
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, applied: true }))
      return
    }

    if (req.method === 'POST' && url.pathname === '/sql') {
      const sql = await readBody(req)
      const out = runPsql([DATABASE_URL, '-c', sql])
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, out: out.slice(0, 2000) }))
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
  console.log(`import-server-psql listening on ${PORT}`)
})
