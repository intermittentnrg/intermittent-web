// Simple router for handling URL changes and navigation
const listeners = new Set()

export function navigate(path, options = {}) {
  const { replace = false, preserveQuery = true } = options

  let fullPath = path
  if (preserveQuery && typeof window !== 'undefined') {
    const currentQuery = window.location.search.slice(1)
    if (currentQuery) {
      fullPath = path + '?' + currentQuery
    }
  }

  const currentFullPath = window.location.pathname + window.location.search
  if (fullPath === currentFullPath) return

  if (replace) {
    history.replaceState({ path: fullPath }, '', fullPath)
  } else {
    history.pushState({ path: fullPath }, '', fullPath)
  }

  notifyListeners()
}

export function onChange(callback) {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

function notifyListeners() {
  const path = window.location.pathname
  const params = parsePath()
  listeners.forEach(callback => callback({ path, params }))
}

window.addEventListener('popstate', () => notifyListeners())

export function formatDatePath(dateStr) {
  if (!dateStr) return 'now'
  return dateStr.toLowerCase().replace(/\s+/g, '_')
}

export function buildPath(region, areaType, area, from, to, dashboard) {
  const dateRange = `${formatDatePath(from)}_to_${formatDatePath(to)}`
  return `/${region}/${areaType}/${area}/${dateRange}/${dashboard}`
}

export function parsePath() {
  const path = window.location.pathname
  const parts = path.split('/').filter(Boolean)
  if (parts.length >= 5) {
    // Format: /:region/:area_type/:area/:from_to_:to/:dashboard
    const dateRangeMatch = parts[3].match(/^(.+)_to_(.+)$/)
    if (dateRangeMatch) {
      return {
        region: parts[0],
        areaType: parts[1],
        area: parts[2],
        from: dateRangeMatch[1].replace(/_/g, ' '),
        to: dateRangeMatch[2].replace(/_/g, ' '),
        dashboard: parts[4]
      }
    }
  }
  return null
}

export function getQuery() {
  const params = new URLSearchParams(window.location.search)
  const result = {}
  for (const [key, value] of params) {
    result[key] = value
  }
  return result
}

export function updateQuery(updates) {
  const existing = getQuery()
  const merged = { ...existing, ...updates }
  Object.keys(merged).forEach(key => {
    if (merged[key] === null) delete merged[key]
  })
  const newSearch = Object.entries(merged)
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '')
  history.replaceState({ path: newUrl }, '', newUrl)
}

export function updatePath(updates) {
  const currentParams = parsePath()
  if (!currentParams) return

  const newParams = { ...currentParams, ...updates }
  const path = buildPath(
    newParams.region,
    newParams.areaType,
    newParams.area,
    newParams.from,
    newParams.to,
    newParams.dashboard
  )
  navigate(path)
}

export function init() {
  notifyListeners()
}

export const router = {
  init,
  navigate,
  onChange,
  formatDatePath,
  buildPath,
  parsePath,
  getQuery,
  updateQuery,
  updatePath
}
