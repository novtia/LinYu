const KEY = 'lingxia_guest_email'

export function getGuestEmail(): string {
  try {
    return (sessionStorage.getItem(KEY) || '').trim().toLowerCase()
  } catch {
    return ''
  }
}

export function setGuestEmail(email: string) {
  try {
    const value = email.trim().toLowerCase()
    if (value) sessionStorage.setItem(KEY, value)
    else sessionStorage.removeItem(KEY)
  } catch {
    /* private mode / disabled storage */
  }
}

export function withGuestEmailQuery(path: string): string {
  const email = getGuestEmail()
  if (!email) return path
  try {
    const url = new URL(path, window.location.origin)
    if (url.searchParams.has('email')) return `${url.pathname}${url.search}`
    if (!url.pathname.startsWith('/api/orders/') && !url.pathname.startsWith('/api/downloads/')) {
      return path
    }
    url.searchParams.set('email', email)
    return `${url.pathname}${url.search}`
  } catch {
    const sep = path.includes('?') ? '&' : '?'
    return `${path}${sep}email=${encodeURIComponent(email)}`
  }
}

export function orderPath(orderId: string): string {
  return withGuestEmailQuery(`/api/orders/${orderId}`)
}
