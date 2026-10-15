import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { suggestPlaces, type PlaceSuggestion } from '../api/places'

interface PlaceAutocompleteProps {
  id?: string
  label: string
  value: string
  onChange: (value: string) => void
  /** Called when the user picks a suggestion — includes lat/lon so analyze can skip geocode. */
  onSelectPlace?: (place: PlaceSuggestion) => void
  placeholder?: string
  disabled?: boolean
  required?: boolean
  /** When true, never query place suggestions (e.g. GPS lat,lon origin). */
  suppressSuggest?: boolean
}

function looksLikeCoordinates(value: string): boolean {
  return /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(value.trim())
}

export function PlaceAutocomplete({
  id,
  label,
  value,
  onChange,
  onSelectPlace,
  placeholder = 'Start typing a city or country…',
  disabled,
  required,
  suppressSuggest = false,
}: PlaceAutocompleteProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const listId = `${inputId}-list`
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const skipFetchRef = useRef(false)

  useEffect(() => {
    if (skipFetchRef.current) {
      skipFetchRef.current = false
      return
    }

    const q = value.trim()
    if (disabled || suppressSuggest || looksLikeCoordinates(q) || q.length < 2) {
      setSuggestions([])
      setOpen(false)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    // Longer debounce — Nominatim bans clients that type-ahead too aggressively.
    const timer = window.setTimeout(() => {
      suggestPlaces(q, 5)
        .then((res) => {
          if (cancelled) return
          setSuggestions(res.suggestions)
          setOpen(res.suggestions.length > 0)
          setActiveIndex(-1)
        })
        .catch(() => {
          if (cancelled) return
          setSuggestions([])
          setOpen(false)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 550)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [value, disabled, suppressSuggest])

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
    skipFetchRef.current = true
    onChange(item.label)
    onSelectPlace?.(item)
    setSuggestions([])
    setOpen(false)
    setActiveIndex(-1)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
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
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <label className="field-label" htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        className="field-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true)
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      {loading && (
        <span className="pointer-events-none absolute right-3 top-[2.15rem] text-[11px] text-slate-400 dark:text-slate-500">
          Searching…
        </span>
      )}
      {open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800 dark:shadow-black/40"
        >
          {suggestions.map((item, index) => (
            <li key={`${item.label}-${item.lat}-${item.lon}`}>
              <button
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
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
