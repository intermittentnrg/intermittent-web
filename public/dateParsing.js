export const RESOLUTION_BUCKETS = [
  { label: "5m", seconds: 300 },
  { label: "15m", seconds: 900 },
  { label: "30m", seconds: 1800 },
  { label: "1h", seconds: 3600 },
  { label: "6h", seconds: 21600 },
  { label: "12h", seconds: 43200 },
  { label: "1d", seconds: 86400 },
  { label: "1w", seconds: 604800 },
  { label: "1M", seconds: 2592000 },
]

export function parseDateRange(fromValue, toValue, now = new Date()) {
  return {
    from: parseAppDate(fromValue, { end: false, now }),
    to: parseAppDate(toValue, { end: true, now }),
  }
}

export function parseAppDate(value, options = {}) {
  const now = options.now ? new Date(options.now) : new Date()
  const end = options.end ?? false
  const input = (value || "now").trim().toLowerCase()

  if (input === "now") return now
  if (input === "today") return dayBoundary(now, end)
  if (input === "yesterday") return dayBoundary(addCalendar(now, "day", -1), end)

  const previous = input.match(/^last\s+(week|month|year)$/i)
  if (previous) return previousPeriod(previous[1], now, end)

  const relative = input.match(/^(\d+)\s*(hour|day|week|month|year)s?(?:\s+ago)?$/i)
  if (relative) {
    const amount = Number(relative[1])
    const unit = relative[2].toLowerCase()
    if (unit === "hour") return new Date(now.getTime() - amount * 3_600_000)
    if (unit === "day") return new Date(now.getTime() - amount * 86_400_000)
    if (unit === "week") return new Date(now.getTime() - amount * 7 * 86_400_000)
    return addCalendar(now, unit, -amount)
  }

  const dateOnly = input.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/)
  if (dateOnly) {
    const year = Number(dateOnly[1])
    const month = dateOnly[2] ? Number(dateOnly[2]) - 1 : 0
    const day = dateOnly[3] ? Number(dateOnly[3]) : 1
    const start = new Date(Date.UTC(year, month, day, 0, 0, 0, 0))
    if (!end) return start
    if (!dateOnly[2]) return new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0) - 1)
    if (!dateOnly[3]) return new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0) - 1)
    return new Date(Date.UTC(year, month, day + 1, 0, 0, 0, 0) - 1)
  }

  const parsed = new Date(value || "")
  if (!Number.isNaN(parsed.getTime())) return parsed
  throw new Error(`Could not parse date value: ${value}`)
}

export function calculateResolution(from, to, widthValue, minResolution = "5m") {
  const width = Math.max(Number(widthValue || 1000), 1)
  const targetSeconds = Math.max(0, (to.getTime() - from.getTime()) / 1000 / width)
  const minBucket = RESOLUTION_BUCKETS.find(bucket => bucket.label === minResolution) || RESOLUTION_BUCKETS[0]
  return (RESOLUTION_BUCKETS.find(bucket => bucket.seconds >= targetSeconds && bucket.seconds >= minBucket.seconds) || RESOLUTION_BUCKETS.at(-1)).label
}

function dayBoundary(date, end) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + (end ? 1 : 0), 0, 0, 0, 0) - (end ? 1 : 0))
}

function addCalendar(date, unit, amount) {
  const d = new Date(date)
  if (unit === "month") d.setUTCMonth(d.getUTCMonth() + amount)
  if (unit === "year") d.setUTCFullYear(d.getUTCFullYear() + amount)
  if (unit === "day") d.setUTCDate(d.getUTCDate() + amount)
  return d
}

function previousPeriod(unit, now, end) {
  if (unit === "week") {
    const currentDay = now.getUTCDay() || 7
    const startThisWeek = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - currentDay + 1)
    return new Date(startThisWeek - (end ? 1 : 7 * 86_400_000))
  }
  if (unit === "month") {
    return end
      ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  }
  return end
    ? new Date(Date.UTC(now.getUTCFullYear(), 0, 1) - 1)
    : new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1))
}
