/**
 * Fetch wrapper with timeout support.
 * Throws if the request takes longer than `ms` milliseconds.
 */
export async function fetchWithTimeout(url, options = {}, ms = 30000) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), ms)

  try {
    const response = await fetch(url, {
      ...options,
      signal: options.signal || controller.signal
    })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}
