import uplot from "../vendor/uplot_client.bundle.js"
import { formatPower, formatPrice, formatEnergy } from "../vendor/chart_formatters.js"
import { divergentSeries } from "../../src/shared/series.js"
import { buildUplotOpts, stackGroup } from "../../src/shared/uplotOpts.js"
import { HEATMAP_COLORS, heatmapPlugin } from "../../src/shared/uplotHeatmap.js"

const DRAG_ZOOM_MIN_PIXELS = 8
const DRAG_ZOOM_MIN_MS = 60_000

// ── Helpers ──

function rebuildTimestamps(startTime, interval, seriesList) {
  const count = seriesList.reduce(
    (max, s) => Math.max(max, s.data?.length ?? 0),
    0,
  )
  const timestamps = new Array(count)
  for (let i = 0; i < count; i++) {
    timestamps[i] = startTime + i * interval
  }
  return timestamps
}

/**
 * Re-stack raw data based on series visibility, for client-side legend toggle.
 *
 * When a stacked series is hidden via the legend, this function re-accumulates
 * the raw data using only the visible series, preventing empty gaps in the stack.
 *
 * @param rawData - [timestamps, rawSeries1, rawSeries2, ...] — non-cumulative values
 * @param uSeries - uPlot series options array (u.series)
 * @param meta - per-series metadata [{stack, fill, type}] (1-indexed, meta[0] = null)
 * @returns {{ data, bands, fillUpdates }} new cumulative data, bands, and
 *   Map<seriesIdx, () => color|null> for uPlot series.fill (must be a function
 *   because uPlot wraps fill via fnOrSelf during init; direct mutation must
 *   also be a function to avoid "s.fill is not a function" errors).
 */
function restack(rawData, uSeries, meta) {
  const count = rawData[0].length
  const data2 = []
  const bands = []
  const fillUpdates = new Map() // si -> () => color | () => null

  // Build stack groups from original series descriptors
  const groups = new Map()
  for (let si = 1; si < meta.length; si++) {
    const m = meta[si]
    if (!m) continue
    const key = m.stack !== undefined ? m.stack : `__ns_${si}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push({ si, visible: uSeries[si].show !== false })
  }

  for (const [key, members] of groups) {
    const isStacked = !key.startsWith('__ns_')

    if (isStacked) {
      // ── Stacked group: accumulate only visible series via shared stackGroup ──
      const visibleMembers = members.filter(m => m.visible)

      if (visibleMembers.length > 0) {
        // Build the group for the shared stackGroup function
        const group = visibleMembers.map(m => ({
          data: rawData[m.si],
          fill: meta[m.si]?.fill,
        }))
        const firstSi = visibleMembers[0].si
        const result = stackGroup(group, count, firstSi)
        bands.push(...result.bands)

        // Interleave cumulative columns (visible) with raw slices (hidden)
        let vi = 0
        for (const m of members) {
          if (m.visible) {
            data2.push(result.cols[vi])
            const isFirst = vi === 0
            const isBar = meta[m.si]?.type === 'bar'
            const fillColor = meta[m.si]?.fill
            if (isFirst || isBar) {
              fillUpdates.set(m.si, () => fillColor ?? null)
            } else {
              fillUpdates.set(m.si, () => null)
            }
            vi++
          } else {
            data2.push(rawData[m.si].slice())
            fillUpdates.set(m.si, () => null)
          }
        }
      } else {
        // All members hidden — pass through raw
        for (const m of members) {
          data2.push(rawData[m.si].slice())
          fillUpdates.set(m.si, () => null)
        }
      }
    } else {
      // ── Non-stacked series: pass through raw, keep existing fill ──
      for (const m of members) {
        data2.push(rawData[m.si].slice())
      }
    }
  }

  return {
    data: [rawData[0]].concat(data2),
    bands,
    fillUpdates,
  }
}

/** Draw labels inside each segment of a vertical stacked bar. */
function drawStackedBarLabels(u, labels) {
  const { ctx } = u
  const n = u.data[0]?.length || 0
  if (n === 0) return

  ctx.save()
  ctx.font = 'bold 13px system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'

  for (let di = 0; di < n; di++) {
    const xPos = u.valToPos(u.data[0][di], 'x', true)
    if (xPos == null) continue

    let prev = 0
    for (let si = 1; si < u.data.length; si++) {
      const cum = u.data[si]?.[di]
      if (cum == null) continue
      const seg = cum - prev
      if (seg === 0) { prev = cum; continue }

      const yStart = u.valToPos(prev, 'y', true)
      const yEnd = u.valToPos(cum, 'y', true)
      if (yStart == null || yEnd == null) { prev = cum; continue }

      const yMid = (yStart + yEnd) / 2
      const info = labels[si - 1]
      if (!info) { prev = cum; continue }

      ctx.fillStyle = '#111827'
      const lines = [info, formatEnergy(seg)]
      const lineH = 15
      const startY = yMid - ((lines.length - 1) * lineH) / 2
      for (let li = 0; li < lines.length; li++) {
        ctx.fillText(lines[li], xPos, startY + li * lineH)
      }

      prev = cum
    }
  }

  ctx.restore()
}

/** Draw name+value labels on top of each bar for single-series or multi-series bar charts. */
function drawBarValueLabels(u) {
  const { ctx } = u
  const n = u.data[0]?.length || 0
  if (n < 2) return

  ctx.save()
  ctx.font = '11px system-ui, sans-serif'
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'center'

  for (let si = 1; si < u.data.length; si++) {
    for (let di = 0; di < n; di++) {
      const yVal = u.data[si]?.[di]
      if (yVal == null) continue

      const xPos = u.valToPos(u.data[0][di], 'x', true)
      // Use the series' actual scale to determine formatting
      const scaleKey = u.series[si]?.scale || 'y'
      const yPos = u.valToPos(yVal, scaleKey, true)
      if (xPos == null || yPos == null) continue

      const name = u.series[si]?.label || ''
      let val
      if (scaleKey === 'percent') val = Number(yVal).toFixed(0) + '%'
      else if (scaleKey === 'price-l' || scaleKey === 'price-r') val = Number(yVal).toFixed(0)
      else val = formatEnergy(yVal)

      ctx.fillStyle = '#111827'
      const lines = [name, val].filter(Boolean)
      const lineH = 13
      const startY = yPos - 4
      for (let li = 0; li < lines.length; li++) {
        ctx.fillText(lines[li], xPos, startY - (lines.length - 1 - li) * lineH)
      }
    }
  }

  ctx.restore()
}

/** Apply all per-panel style/layout overrides to a normalized result. */
function applyPanelOverrides(panel, result) {
  if (!result.opts) return

  // Scale range overrides (e.g. y-axis starting at 0)
  if (panel.scales) result.opts.scales = { ...result.opts.scales, ...panel.scales }

  // Axis side (move secondary axis to left) and enable grid
  if (panel.axisSide != null && result.opts.axes) {
    for (const ax of result.opts.axes) {
      if (ax.side != null) { ax.side = panel.axisSide; ax.grid = { stroke: 'rgba(0,0,0,0.06)' } }
    }
  }

  // Axis value formatting and labels
  if (panel.axisScale === 'energy' && result.opts.axes?.[1]) {
    result.opts.axes[1].values = (u, ticks) => ticks.map(v => formatEnergy(v))
  }

  // X-axis visibility
  if (panel.xAxisSize != null && result.opts.axes?.[0]) {
    result.opts.axes[0].size = panel.xAxisSize
    if (panel.xAxisSize === 0) result.opts.axes[0].show = false
  }

  // Canvas padding
  if (panel.padding) result.opts.padding = panel.padding

  // Draw hooks — bar labels
  if (panel.barCenter) {
    if (result.opts.axes?.[0]) result.opts.axes[0].show = false
    if (result.startTime != null && result.data?.[0]?.length === 1) {
      const half = Math.max(result.interval || 3600, 3600)
      result.opts.scales = result.opts.scales || {}
      result.opts.scales.x = { range: [result.startTime - half, result.startTime + half] }
    }
    const labels = (panel.mainSeries || []).filter(s => s.label).map(s => s.label)
    if (labels.length > 0) {
      if (!result.opts.hooks) result.opts.hooks = {}
      if (!result.opts.hooks.draw) result.opts.hooks.draw = []
      result.opts.hooks.draw.push((u) => drawStackedBarLabels(u, labels))
    }
  } else if (panel.mainSeries?.some(s => s.type === 'bar')) {
    result._noTooltip = true
    if (!result.opts.hooks) result.opts.hooks = {}
    if (!result.opts.hooks.draw) result.opts.hooks.draw = []
    result.opts.hooks.draw.push((u) => drawBarValueLabels(u))
  }
}

/** Pad a values array to a given length with nulls. */
function padTo(values, length) {
  const out = []
  for (let i = 0; i < length; i++) {
    out.push(i < values.length ? (values[i] ?? null) : null)
  }
  return out
}

/** Normalize a panel entry from client-build (mainSeries) to server-build (opts/data). */
function normalizePanel(panel, data) {
  let result

  if (panel.mainSeries) {
    const timestamps = rebuildTimestamps(data.startTime, data.interval, panel.mainSeries)
    const series = panel.mainSeries.some(s => s.fill) ? divergentSeries(panel.mainSeries) : panel.mainSeries
    const allSeries = [
      ...series,
      ...(panel.extraSeries || []),
    ]
    const length = timestamps.length

    // Separate into stack groups and non-stacked
    const stackGroups = new Map()
    const nonStacked = []
    for (const s of allSeries) {
      if (s.stack) {
        if (!stackGroups.has(s.stack)) stackGroups.set(s.stack, [])
        stackGroups.get(s.stack).push(s)
      } else {
        nonStacked.push(s)
      }
    }

    // Build cumulative data, raw data, and uPlot series descriptors
    const dataCols = []
    const rawData = []
    const bands = []
    const uplotSeries = [{ label: "Time" }]
    const _meta = [null]

    // Process each stack group
    for (const group of stackGroups.values()) {
      const startUplotIdx = uplotSeries.length
      const stacked = stackGroup(group, length, startUplotIdx)
      dataCols.push(...stacked.cols)
      rawData.push(...stacked.rawCols)
      bands.push(...stacked.bands)

      for (let gi = 0; gi < group.length; gi++) {
        const s = group[gi]
        const uS = {
          label: s.label,
          stroke: s.stroke,
          width: s.width ?? 1,
          points: { show: false },
        }
        if (s.scale) uS.scale = s.scale
        if (s.type === "bar" ? s.fill : (gi === 0 && s.fill)) uS.fill = s.fill
        uplotSeries.push(uS)
        _meta.push({ stack: s.stack, fill: s.fill, type: s.type })
      }
    }

    // Non-stacked series
    for (const s of nonStacked) {
      const vals = padTo(s.data, length)
      dataCols.push(vals)
      rawData.push(vals)

      const uS = {
        label: s.label,
        stroke: s.stroke,
        width: s.width ?? 1,
        points: { show: false },
      }
      if (s.scale) uS.scale = s.scale
      if (s.fill) uS.fill = s.fill
      uplotSeries.push(uS)
      _meta.push({ stack: s.stack, fill: s.fill, type: s.type })
    }

    const built = buildUplotOpts(
      panel.title || data.title,
      timestamps,
      uplotSeries,
      bands,
      panel.currencySymbol,
    )

    result = {
      ...built,
      data: dataCols,
      rawData,
      seriesMeta: _meta.slice(1).map(m => ({ type: m.type })),
      _meta,
    }
  } else {
    // Already server-built (opts/data)
    result = { ...panel }
  }

  applyPanelOverrides(panel, result)
  if (panel.currencySymbol) result.currencySymbol = panel.currencySymbol
  return result
}

function buildLegend(plots, data, chartTarget) {
  const oldLegend = document.querySelector('.uplot-shared-legend')
  if (oldLegend) oldLegend.remove()

  // Collect all unique labels across panels, with their (plotIndex, seriesIndex) pairs
  const legendMap = new Map() // label -> { color, indices: [[plotIdx, seriesIdx], ...] }

  for (let pi = 0; pi < plots.length; pi++) {
    const plot = plots[pi]
    if (!plot) continue
    for (let si = 1; si < plot.series.length; si++) {
      const s = plot.series[si]
      if (!s) continue
      const label = s.label || `Series ${si}`
      if (!legendMap.has(label)) {
        const color = typeof s.stroke === 'function'
          ? s.stroke(plot, si)
          : s.stroke || '#888'
        legendMap.set(label, { color, indices: [] })
      }
      legendMap.get(label).indices.push([pi, si])
    }
  }

  // If data.sharedLegend.groups is provided, use that order/color instead
  if (data.sharedLegend?.groups) {
    for (const group of data.sharedLegend.groups) {
      if (!legendMap.has(group.label)) continue
      legendMap.get(group.label).color = group.color
    }
  }

  const legend = document.createElement('div')
  legend.className = 'uplot-shared-legend'
  legend.style.cssText = `
    display: flex; flex-wrap: wrap; gap: 8px 16px;
    padding: 8px 12px; font: 13px system-ui, sans-serif;
    justify-content: center;
  `

  for (const [label, info] of legendMap) {
    const entry = document.createElement('span')
    entry.style.cssText = `
      display: inline-flex; align-items: center; gap: 4px;
      cursor: pointer; user-select: none;
    `

    const marker = document.createElement('span')
    marker.style.cssText = `
      display: inline-block; width: 10px; height: 10px;
      border-radius: 2px; background: ${info.color}; flex-shrink: 0;
    `

    const text = document.createTextNode(label)
    entry.appendChild(marker)
    entry.appendChild(text)

    entry.addEventListener('click', () => {
      const firstIdx = info.indices[0]
      const firstPlot = plots[firstIdx[0]]
      const visible = firstPlot ? firstPlot.series[firstIdx[1]]?.show !== false : true
      for (const [pi, si] of info.indices) {
        const p = plots[pi]
        if (p && p.series[si]) {
          p.setSeries(si, { show: !visible })
        }
      }
      entry.style.opacity = visible ? '0.4' : '1'
    })

    legend.appendChild(entry)
  }

  // Insert legend: above chartTarget for multi-panel, below for single panel
  if (plots.length > 1 && chartTarget.parentNode) {
    chartTarget.parentNode.insertBefore(legend, chartTarget)
  } else if (chartTarget.parentNode) {
    chartTarget.parentNode.appendChild(legend)
  }
}

function connectUplotDragZoom(plot, chartTarget, { applyZoomDateRange }) {
  const overlay = document.createElement('div')
  overlay.className = 'uplot-drag-overlay'
  overlay.style.cssText = `
    position: absolute;
    top: 0;
    height: 100%;
    pointer-events: none;
    z-index: 999;
    background: rgba(0, 119, 255, 0.18);
    display: none;
  `
  chartTarget.appendChild(overlay)

  let dragState = null

  function onMouseDown(e) {
    if (e.button !== 0) return
    const rect = plot.over.getBoundingClientRect()
    const startX = e.clientX - rect.left
    dragState = { startX, currentX: startX }
    overlay.style.left = startX + 'px'
    overlay.style.width = '0px'
    overlay.style.display = 'block'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  function onMouseMove(e) {
    if (!dragState) return
    const rect = plot.over.getBoundingClientRect()
    dragState.currentX = e.clientX - rect.left
    const left = Math.min(dragState.startX, dragState.currentX)
    const right = Math.max(dragState.startX, dragState.currentX)
    overlay.style.left = left + 'px'
    overlay.style.width = (right - left) + 'px'
  }

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    if (!dragState) return
    overlay.style.display = 'none'

    const { startX, currentX } = dragState
    dragState = null

    const dx = Math.abs(currentX - startX)
    if (dx < DRAG_ZOOM_MIN_PIXELS) return

    const fromSec = plot.posToVal(Math.min(startX, currentX), 'x')
    const toSec = plot.posToVal(Math.max(startX, currentX), 'x')

    if (!Number.isFinite(fromSec) || !Number.isFinite(toSec)) return

    const fromMs = fromSec * 1000
    const toMs = toSec * 1000

    if (Math.abs(toMs - fromMs) < DRAG_ZOOM_MIN_MS) return

    applyZoomDateRange(fromMs, toMs)
  }

  plot.over.addEventListener('mousedown', onMouseDown)
}

function positionTooltip(tooltipEl, u, width) {
  const cx = u.cursor.left
  const cy = u.cursor.top
  const tw = width || 260
  const vw = u.root?.clientWidth || 800
  let left = cx + 8 + tw < vw ? cx + 8 : cx - tw - 8
  left = Math.max(4, Math.min(left, vw - tw - 4))
  tooltipEl.style.left = left + 'px'
  tooltipEl.style.top = (cy - 10) + 'px'
  tooltipEl.style.display = 'block'
}

function makeTooltip(tooltipEl, rawData, timezone, currencySymbol) {
  return (u) => {
    const idx = u.cursor.idx
    if (idx == null) { tooltipEl.style.display = 'none'; return }
    const series = u.series
    if (!rawData) return

    // Time-series: date header + grouped values + optional total
    const ts = rawData[0][idx]
    const date = new Date(Number(ts) * 1e3).toLocaleString('en-GB', { timeZone: timezone || 'UTC', hour12: false, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    let html = `<div style="font-weight:600;margin-bottom:4px;border-bottom:1px solid #e5e7eb;padding-bottom:4px;">${date}</div>`

    const groups = new Map()
    for (let si = 1; si < series.length; si++) {
      const s = series[si]
      if (!s.show) continue
      const raw = rawData[si]?.[idx]
      if (raw == null) continue
      if (!groups.has(s.label)) groups.set(s.label, { color: typeof s.stroke === 'function' ? s.stroke(u, si) : s.stroke || '#888', scale: s.scale, rawTotal: 0 })
      groups.get(s.label).rawTotal += raw
    }

    const sym = currencySymbol
    for (const [label, g] of Array.from(groups.entries()).reverse()) {
      let display
      if (g.scale === 'price-l' || g.scale === 'price-r') {
        display = `${formatPrice(g.rawTotal)} ${sym}/MWh`
      } else if (g.scale === 'percent') {
        display = Number(g.rawTotal).toFixed(0) + '%'
      } else if (g.scale === 'energy') {
        display = formatEnergy(g.rawTotal)
      } else {
        display = formatPower(g.rawTotal)
      }
      html += `<div style="display:flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;border-radius:2px;background:${g.color};flex-shrink:0;"></span><span>${label}</span><span style="margin-left:auto;font-weight:500;">${display}</span></div>`
    }

    let total = 0
    let hasTotal = false
    for (const [, g] of groups) {
      if (g.scale === 'price-l' || g.scale === 'price-r' || g.scale === 'percent' || g.scale === 'energy') continue
      total += g.rawTotal; hasTotal = true
    }
    if (hasTotal) {
      html += `<div style="display:flex;align-items:center;gap:6px;margin-top:4px;padding-top:4px;border-top:1px solid #e5e7eb;"><span style="font-weight:600;">Total</span><span style="margin-left:auto;font-weight:600;">${formatPower(total)}</span></div>`
    }

    tooltipEl.innerHTML = html
    positionTooltip(tooltipEl, u, 260)
  }
}

// ── Single panel renderer ──

/** Render all panels into chartTarget (single or multi-panel grid). */
function renderPanel(chartTarget, panels, data, { applyZoomDateRange }) {
  const cols = data.layout?.columns || (panels.length > 1 ? Math.min(panels.length, 2) : 1)
  const gridLayout = data.layout || {}

  // Always create a grid container — a single panel is just a 1-column grid.
  const container = document.createElement('div')
  container.className = 'uplot-grid'
  container.style.cssText = `
    display: grid;
    gap: 4px;
    width: 100%;
  `
  container.style.gridTemplateColumns = gridLayout.columns || `repeat(${cols}, 1fr)`
  container.style.gridTemplateRows = gridLayout.rows || ''
  chartTarget.appendChild(container)

  const plots = []

  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i]

    const cell = document.createElement('div')
    cell.className = 'uplot-panel'
    cell.style.cssText = `position:relative;min-height:100px;min-width:0`
    if (panel.layout) {
      if (panel.layout.gridColumn) cell.style.gridColumn = panel.layout.gridColumn
      if (panel.layout.gridRow) cell.style.gridRow = panel.layout.gridRow
    }
    container.appendChild(cell)

    const processed = normalizePanel(panel, data)
    const { opts, data: plotData, rawData, seriesMeta, startTime, interval } = processed

    const count = (plotData[0]?.length ?? 0)
    const timestamps = new Array(count)
    for (let j = 0; j < count; j++) {
      timestamps[j] = startTime + j * interval
    }
    const plotDataWithX = [timestamps, ...plotData]
    const rawDataWithX = [timestamps, ...(rawData || plotData)]

    if (seriesMeta && opts.series) {
      for (let j = 0; j < seriesMeta.length; j++) {
        const meta = seriesMeta[j]
        const s = opts.series[j + 1]
        if (!s || !meta) continue
        if (meta.type === 'bar' && !s.paths) {
          s.paths = uplot.paths.bars({ gap: 4 })
        }
      }
    }

    const tooltip = document.createElement('div')
    tooltip.className = 'uplot-tooltip'
    tooltip.style.cssText = `
      position: absolute;
      pointer-events: none;
      z-index: 1000;
      background: rgba(255,255,255,0.95);
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 8px 12px;
      font: 13px system-ui, sans-serif;
      line-height: 1.6;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      display: none;
      max-width: 260px;
    `
    cell.appendChild(tooltip)

    const cellWidth = cell.clientWidth || (chartTarget.clientWidth / Math.min(panels.length, cols))
    const wholeHeight = data.height || 567
    const heightPx = Math.round(wholeHeight / panels.length)

    const rawDataForRestack = rawDataWithX
    const metaForRestack = processed._meta || []

    const uplotOpts = {
      ...opts,
      width: cellWidth,
      height: heightPx,
      legend: { show: false },
      axes: (opts.axes || []).map((axis) => {
        if (axis.values) return axis
        if (axis.scale === 'y' || axis.scale === 'power' || axis.scale === 'energy') {
          const fmt = axis.scale === 'energy' ? formatEnergy : formatPower
          return { ...axis, values: (u, ticks) => ticks.map(v => fmt(v)) }
        }
        if (axis.scale === 'price-l' || axis.scale === 'price-r' || axis.scale === 'percent') {
          return { ...axis, values: (u, ticks) => ticks.map(v => formatPrice(v)) }
        }
        return axis
      }),
      select: { show: false },
      cursor: {
        ...(opts.cursor || {}),
        drag: { x: false, y: false },
      },
      ...(data.timezone ? { tzDate: (ts) => uplot.tzDate(new Date(ts * 1e3), data.timezone) } : {}),
      hooks: {
        ...opts.hooks,
        ...(processed._noTooltip ? {} : { setCursor: [makeTooltip(tooltip, rawDataWithX, data.timezone, processed.currencySymbol)] }),
        setSeries: [(u) => {
          const result = restack(rawDataForRestack, u.series, metaForRestack)
          for (const [si, fn] of result.fillUpdates) {
            u.series[si].fill = fn
          }
          u.delBand(null)
          for (const band of result.bands) {
            u.addBand(band)
          }
          u.setData(result.data)
        }],
      },
    }

    try {
      const plot = new uplot(uplotOpts, plotDataWithX, cell)
      plots.push(plot)
      connectUplotDragZoom(plot, cell, { applyZoomDateRange })
      cell._uplot = plot
    } catch (error) {
      console.error(`uPlot: Failed to render panel ${i}`, error)
    }
  }

  if (plots.length > 0) {
    buildLegend(plots, data, chartTarget)
  }

  chartTarget._uplot = plots
  chartTarget._uplotGrid = container
}

// ── Heatmap renderer ──

function renderHeatmap(chartTarget, data) {
  const { heatmapMeta, timezone } = data
  const { timestamps, unitNames, values } = heatmapMeta

  const unitCount = unitNames.length
  const count = timestamps.length
  if (count === 0 || unitCount === 0) return

  chartTarget.style.width = '100%'
  chartTarget.style.minWidth = '0'
  chartTarget.style.position = 'relative'
  const fixedHeight = data.height || 567
  chartTarget.style.height = fixedHeight + 'px'

  const width = chartTarget.clientWidth || 800

  const tooltip = document.createElement('div')
  tooltip.className = 'uplot-heatmap-tooltip'
  tooltip.style.cssText = `
    position: absolute;
    pointer-events: none;
    z-index: 1000;
    background: rgba(255,255,255,0.95);
    border: 1px solid #d1d5db;
    border-radius: 6px;
    padding: 8px 12px;
    font: 13px system-ui, sans-serif;
    line-height: 1.6;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    display: none;
    max-width: 260px;
  `
  chartTarget.appendChild(tooltip)

  function makeHeatmapTooltip() {
    return (u) => {
      const idx = u.cursor.idx
      if (idx == null || idx >= count) {
        tooltip.style.display = 'none'
        return
      }

      const yVal = u.posToVal(u.cursor.top, 'y')
      const yi = Math.round(yVal)

      if (yi < 0 || yi >= unitCount) {
        tooltip.style.display = 'none'
        return
      }

      const val = values[idx]?.[yi]
      if (val == null) {
        tooltip.style.display = 'none'
        return
      }

      const date = new Date(timestamps[idx] * 1e3).toLocaleString('en-GB', {
        timeZone: timezone || 'UTC',
        hour12: false,
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })

      tooltip.innerHTML = `
        <div style="font-weight:600;border-bottom:1px solid #e5e7eb;padding-bottom:3px;margin-bottom:3px;">${date}</div>
        <div>${unitNames[yi]}</div>
        <div style="font-weight:500;">${val.toFixed(1)}% of peak</div>
      `

      const cx = u.cursor.left
      const cy = u.cursor.top
      const tw = 260
      let left = cx + 8 + tw < width ? cx + 8 : cx - tw - 8
      left = Math.max(4, Math.min(left, width - tw - 4))
      tooltip.style.left = left + 'px'
      tooltip.style.top = Math.max(0, cy - 50) + 'px'
      tooltip.style.display = 'block'
    }
  }

  const ySplits = []
  for (let i = 0; i < unitCount; i++) ySplits.push(i)

  const maxLabelChars = unitNames.reduce((max, n) => Math.max(max, n.length), 0)
  const yAxisSize = Math.min(Math.max(maxLabelChars * 7 + 24, 80), 300)

  const opts = {
    title: data.title || 'Unit % of Peak Output',
    width,
    height: fixedHeight,
    padding: [0, 0, 0, 0],
    scales: {
      x: { time: true },
      y: { range: [-0.5, Math.max(0.5, unitCount - 0.5)] },
    },
    cursor: {
      show: true,
      drag: { y: true },
      points: { show: false },
    },
    select: { show: true, left: 0, top: 0, width: 0, height: 0 },
    legend: { show: false },
    series: [
      { label: 'Time' },
      { show: false },
      { show: false },
    ],
    axes: [
      {
        stroke: '#888',
        grid: { stroke: 'rgba(0,0,0,0.06)' },
        font: '12px system-ui, sans-serif',
      },
      {
        stroke: '#888',
        grid: { stroke: 'rgba(0,0,0,0.06)' },
        font: '12px system-ui, sans-serif',
        size: yAxisSize,
        values: (_u, ticks) => ticks.map(v => unitNames[Math.round(v)] ?? ''),
        splits: () => ySplits,
      },
    ],
    plugins: [heatmapPlugin(timestamps, unitNames, values)],
    ...(timezone ? { tzDate: (ts) => uplot.tzDate(new Date(ts * 1e3), timezone) } : {}),
    hooks: {
      setCursor: [makeHeatmapTooltip()],
    },
  }

  const yMin = new Array(count).fill(0)
  const yMax = new Array(count).fill(unitCount - 1)
  const plotData = [timestamps, yMin, yMax]

  try {
    const plot = new uplot(opts, plotData, chartTarget)
    chartTarget._uplot = [plot]
  } catch (error) {
    console.error('uPlot: Failed to render heatmap', error)
  }
}

// ── Main render function (exported) ──

export function renderUplot(chartTarget, data, { applyZoomDateRange }) {
  // Dispose any previous uPlot instances
  destroyUplots(chartTarget)

  // Remove old custom elements
  const oldTip = chartTarget.querySelector('.uplot-tooltip')
  if (oldTip) oldTip.remove()

  chartTarget.style.width = '100%'
  chartTarget.style.minWidth = '0'
  chartTarget.style.position = 'relative'

  const panels = data.panels

  // Check for heatmap
  if (panels[0]?.heatmapMeta) {
    renderHeatmap(chartTarget, {
      heatmapMeta: panels[0].heatmapMeta,
      timezone: data.timezone,
      title: data.title,
      height: data.height,
    })
    return
  }

  renderPanel(chartTarget, panels, data, { applyZoomDateRange })

  // Set up resize handler (only once)
  if (!chartTarget._uplotResizeHandler) {
    chartTarget._uplotResizeHandler = () => {
      resizeUplots(chartTarget)
    }
    window.addEventListener('resize', chartTarget._uplotResizeHandler)
  }
}

function destroyUplots(chartTarget) {
  // Destroy all managed uPlot instances
  const plots = chartTarget._uplot
  if (plots) {
    for (const p of plots) {
      if (p && p.destroy) try { p.destroy() } catch {}
    }
    chartTarget._uplot = null
  }

  // Remove multi-panel grid if present
  const grid = chartTarget._uplotGrid
  if (grid) {
    grid.remove()
    chartTarget._uplotGrid = null
  }

  // Remove any old legends
  const oldShared = document.querySelector('.uplot-shared-legend')
  if (oldShared) oldShared.remove()
  const oldCustom = document.querySelector('.uplot-custom-legend')
  if (oldCustom) oldCustom.remove()
}

function resizeUplots(chartTarget) {
  const plots = chartTarget._uplot
  if (!plots) return

  for (const p of plots) {
    if (!p || !p.root) continue
    const parent = p.root.parentNode
    if (parent) {
      p.setSize({
        width: parent.clientWidth,
        height: p.height,
      })
    }
  }
}
