import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { suggestPlaces, type PlaceSuggestion } from '../api/places'
import { searchErrorMessage } from '../lib/userMessages'

interface PlaceAutocompleteProps {
  id?: string
  label: string
  value: string
  onChange: (value: string) => void
  /** Called when the user picks a provider result (carries id + real lat/lon). */
  onSelectPlace?: (place: PlaceSuggestion) => void
  /** True once a provider result has been chosen for the current text. */
  selected?: boolean
  placeholder?: string
  disabled?: boolean
  required?: boolean
}

type SearchStatus = 'idle' | 'loading' | 'results' | 'empty' | 'error'

const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 300

export function PlaceAutocomplete({
  id,
  label,
  value,
  onChange,
  onSelectPlace,
  selected = false,
  placeholder = 'Start typing a city, address or place…',
  disabled,
  required,
}: PlaceAutocompleteProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const listId = `${inputId}-list`
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [errorText, setErrorText] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  /** Monotonic id — only the newest request may update state (stale-response guard). */
  const reqIdRef = useRef(0)

  useEffect(() => {
    const q = value.trim()
    // While a provider result is selected for this text there is nothing to search;
    // editing the text clears the selection (see TripForm) and search resumes.
    if (disabled || selected || q.length < MIN_QUERY_LENGTH) {
      reqIdRef.current += 1
      setSuggestions([])
      setOpen(false)
      setStatus('idle')
      setErrorText(null)
      return
    }

    const reqId = ++reqIdRef.current
    const controller = new AbortController()
    setStatus('loading')
    setErrorText(null)
    setOpen(true)

    const timer = window.setTimeout(() => {
      suggestPlaces(q, 6, { signal: controller.signal })
        .then((res) => {
          if (reqId !== reqIdRef.current) return
          setSuggestions(res.suggestions)
          setActiveIndex(-1)
          setStatus(res.suggestions.length === 0 ? 'empty' : 'results')
          setOpen(true)
        })
        .catch((err) => {
          if (reqId !== reqIdRef.current) return
          if (err instanceof DOMException && err.name === 'AbortError') return
          // Never show stale or fabricated results after a failure.
          setSuggestions([])
          setErrorText(searchErrorMessage(err))
          setStatus('error')
          setOpen(true)
        })
    }, DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [value, disabled, selected])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const pick = (item: PlaceSuggestion) => {
    reqIdRef.current += 1
    onChange(item.label)
    onSelectPlace?.(item)
    setSuggestions([])
    setOpen(false)
    setActiveIndex(-1)
    setStatus('idle')
    setErrorText(null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      const item = suggestions[activeIndex]
      if (item) pick(item)
    }
  }

  const showPanel = open && status !== 'idle'

  return (
    <div ref={rootRef} className="relative">
      <label className="field-label" htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        className="field-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (status !== 'idle') setOpen(true)
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-busy={status === 'loading'}
      />
      {status === 'loading' && (
        <span
          className="pointer-events-none absolute right-3 top-[2.15rem] text-[11px] text-slate-400 dark:text-slate-500"
          role="status"
        >
          Searching…
        </span>
      )}
      {selected && status !== 'loading' && (
        <span
          className="pointer-events-none absolute right-3 top-[2.15rem] text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
          title="Location confirmed from the search provider"
        >
          ✓ Selected
        </span>
      )}
      {showPanel && (
        <div
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800 dark:shadow-black/40"
        >
          {status === 'loading' && (
            <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">Searching places…</p>
          )}
          {status === 'empty' && (
            <p className="px-3 py-2 text-sm text-slate-600 dark:text-slate-300">
              No places found for “{value.trim()}”. Check the spelling or try a nearby city.
            </p>
          )}
          {status === 'error' && errorText && (
            <p className="px-3 py-2 text-sm text-red-700 dark:text-red-300" role="alert">
              {errorText}
            </p>
          )}
          {status === 'results' &&
            suggestions.map((item, index) => (
              <button
                key={`${item.id ?? item.label}-${item.lat}-${item.lon}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`block w-full px-3 py-2 text-left text-sm ${
                  index === activeIndex
                    ? 'bg-sky-50 text-sky-900 dark:bg-sky-950/60 dark:text-sky-100'
                    : 'text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-700'
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(item)}
              >
                <span className="block font-medium leading-snug">{item.label}</span>
                {(item.country || item.type) && (
                  <span className="mt-0.5 block text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {[item.type, item.country].filter(Boolean).join(' · ')}
                  </span>
                )}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
