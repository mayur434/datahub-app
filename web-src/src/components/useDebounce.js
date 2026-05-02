import { useState, useEffect } from 'react'

/**
 * Debounce a value — returns the debounced value after `delay` ms of inactivity.
 */
export function useDebounce (value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debouncedValue
}
