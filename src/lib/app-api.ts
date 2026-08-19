/** Fetch JSON da API do Claude Web, com cookie de sessão. */

export async function appApi<T = any>(url: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(url, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return res.json() as Promise<T>
}
