/**
 * Lightweight Stale-While-Revalidate (SWR) cache for admin pages.
 *
 * Shows cached data instantly while fetching fresh data in the background.
 * Cache is stored in sessionStorage so it persists across page navigations
 * within the same browser tab but clears on tab close.
 *
 * Usage:
 *   const { data, loading, stale, error, refresh } = useSwrCache('dashboard', fetchFn, { ttl: 60000 })
 */

import { useState, useEffect, useCallback, useRef } from 'react'

const CACHE_PREFIX = 'mdm_swr_'

function readCache (key) {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed
  } catch (e) {
    return null
  }
}

function writeCache (key, data) {
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({
      data,
      timestamp: Date.now()
    }))
  } catch (e) {
    // sessionStorage full or unavailable — ignore
  }
}

export function clearSwrCache (key) {
  if (key) {
    sessionStorage.removeItem(CACHE_PREFIX + key)
  } else {
    // Clear all SWR entries
    const keys = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (k && k.startsWith(CACHE_PREFIX)) keys.push(k)
    }
    keys.forEach(k => sessionStorage.removeItem(k))
  }
}

/**
 * @param {string} key - Unique cache key
 * @param {Function} fetcher - Async function that returns data
 * @param {object} opts
 * @param {number} [opts.ttl=120000] - Time-to-live in ms before data is considered stale (default 2 min)
 * @param {boolean} [opts.revalidateOnMount=true] - Always revalidate on component mount
 */
export default function useSwrCache (key, fetcher, opts = {}) {
  const { ttl = 2 * 60 * 1000, revalidateOnMount = true } = opts
  const cached = readCache(key)
  const isFresh = cached && (Date.now() - cached.timestamp) < ttl

  const [data, setData] = useState(cached ? cached.data : null)
  const [loading, setLoading] = useState(!cached)
  const [stale, setStale] = useState(cached ? !isFresh : false)
  const [error, setError] = useState(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const revalidate = useCallback(async () => {
    try {
      setStale(!!data)
      if (!data) setLoading(true)
      const fresh = await fetcherRef.current()
      setData(fresh)
      setStale(false)
      setError(null)
      writeCache(key, fresh)
    } catch (e) {
      setError(e.message)
      // Keep showing stale data on error
    } finally {
      setLoading(false)
    }
  }, [key, data])

  // Force refresh — bypasses cache, shows loading state
  const refresh = useCallback(async () => {
    setLoading(true)
    setStale(false)
    try {
      const fresh = await fetcherRef.current()
      setData(fresh)
      setError(null)
      writeCache(key, fresh)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [key])

  useEffect(() => {
    if (!cached) {
      // No cache — fetch immediately
      revalidate()
    } else if (!isFresh && revalidateOnMount) {
      // Stale cache — show it but revalidate in background
      revalidate()
    }
    // Fresh cache — skip revalidation, serve from cache
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, stale, error, refresh, revalidate }
}
