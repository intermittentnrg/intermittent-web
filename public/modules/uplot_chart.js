import uplot from "../vendor/uplot_client.bundle.js"
import { formatPower, formatPrice, formatEnergy } from "../vendor/echarts_formatters.js"
import { divergentSeries } from "../../src/shared/series.js"
import { buildUplotPayload } from "../../src/shared/uplotPayload.js"
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
    result = buildUplotPayload(panel.title || data.title, timestamps, allSeries, panel.currencySymbol)
  } else {
    // Already server-built (opts/data)
    result = { ...panel }
  }

  applyPanelOverrides(panel, result)
  if (panel.currencySymbol) result.currencySymbol = panel.currencySymbol
  return result
}

function buildSharedLegend(plots, data, chartTarget) {
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

  // Insert legend before the chart container
  if (chartTarget && chartTarget.parentNode) {
    chartTarget.parentNode.insertBefore(legend, chartTarget)
  } else {
    plots[0].root.parentNode.appendChild(legend)
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

function renderSinglePanel(chartTarget, panel, data, { applyZoomDateRange }) {
  const processed = normalizePanel(panel, data)
  const { opts, data: plotData, rawData, seriesMeta, startTime, interval } = processed

  const count = (plotData[0]?.length ?? 0)
  const timestamps = new Array(count)
  for (let i = 0; i < count; i++) {
    timestamps[i] = startTime + i * interval
  }
  const plotDataWithX = [timestamps, ...plotData]
  const lastRawData = [timestamps, ...(rawData || plotData)]

  if (seriesMeta && opts.series) {
    for (let i = 0; i < seriesMeta.length; i++) {
      const meta = seriesMeta[i]
      const s = opts.series[i + 1]
      if (!s || !meta) continue
      if (meta.type === 'bar' && !s.paths) {
        s.paths = uplot.paths.bars({ gap: 4 })
      }
    }
  }

  const fixedHeight = data.height || 567
  chartTarget.style.height = fixedHeight + 'px'

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
  chartTarget.appendChild(tooltip)

  const width = chartTarget.clientWidth || 800
  const chartHeight = parseInt(chartTarget.style.height) || 400
  const heightPx = chartTarget.clientHeight || chartHeight

  const uplotOpts = {
    ...opts,
    width,
    height: heightPx,
    legend: {
      ...opts.legend,
      show: false,
    },
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
      setCursor: [makeTooltip(tooltip, lastRawData, data.timezone, processed.currencySymbol)],
    },
  }

  try {
    const plot = new uplot(uplotOpts, plotDataWithX, chartTarget)
    chartTarget._uplot = [plot]

    connectUplotDragZoom(plot, chartTarget, { applyZoomDateRange })

    // Build legend for single panel (or no sharedLegend)
    if (!data.sharedLegend) {
      buildSingleLegend(plot, opts.series, chartTarget)
    }
  } catch (error) {
    console.error('uPlot: Failed to render chart', error)
  }
}

function buildSingleLegend(plot, seriesOpts, chartTarget) {
  const oldLegend = chartTarget.querySelector('.uplot-custom-legend')
  if (oldLegend) oldLegend.remove()

  const groups = new Map()
  for (let si = 1; si < seriesOpts.length; si++) {
    const s = seriesOpts[si]
    if (!s) continue
    const label = s.label || `Series ${si}`
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label).push(si)
  }

  const legend = document.createElement('div')
  legend.className = 'uplot-custom-legend'
  legend.style.cssText = `
    display: flex; flex-wrap: wrap; gap: 8px 16px;
    padding: 8px 12px; font: 13px system-ui, sans-serif;
    justify-content: center;
  `

  for (const [label, indices] of groups) {
    const entry = document.createElement('span')
    entry.style.cssText = `
      display: inline-flex; align-items: center; gap: 4px;
      cursor: pointer; user-select: none;
    `

    const firstSeries = seriesOpts[indices[0]]
    const color = typeof firstSeries.stroke === 'function'
      ? firstSeries.stroke(plot, indices[0])
      : firstSeries.stroke || '#888'

    const marker = document.createElement('span')
    marker.style.cssText = `
      display: inline-block; width: 10px; height: 10px;
      border-radius: 2px; background: ${color}; flex-shrink: 0;
    `

    const text = document.createTextNode(label)
    entry.appendChild(marker)
    entry.appendChild(text)

    entry.addEventListener('click', () => {
      const visible = plot.series[indices[0]].show
      for (const idx of indices) {
        plot.setSeries(idx, { show: !visible })
      }
      entry.style.opacity = visible ? '0.4' : '1'
    })

    legend.appendChild(entry)
  }

  chartTarget.appendChild(legend)
}

/** Plugin that renders labels inside stacked vertical bar segments. */
// ── Multi-panel renderer ──

function renderMultiPanel(chartTarget, panels, data, { applyZoomDateRange }) {
  // Create CSS grid container
  const container = document.createElement('div')
  container.className = 'uplot-grid'
  container.style.cssText = `
    display: grid;
    gap: 4px;
    width: 100%;
    height: 100%;
  `

  const gridLayout = data.layout || {}
  container.style.gridTemplateColumns = gridLayout.columns || `repeat(${Math.min(panels.length, 2)}, 1fr)`
  container.style.gridTemplateRows = gridLayout.rows || ''

  chartTarget.appendChild(container)

  const tooltips = []
  const plots = []
  const lastRawDataList = []

  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i]
    const cell = document.createElement('div')
    cell.className = 'uplot-panel'
    cell.style.cssText = `
      position: relative;
      min-height: 100px;
    `
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
    lastRawDataList.push(rawDataWithX)

    if (seriesMeta && opts.series) {
      for (let j = 0; j < seriesMeta.length; j++) {
        const meta = seriesMeta[j]
        const s = opts.series[j + 1]
        if (!s || !meta) continue
        if (meta.type === 'bar') {
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
    tooltips.push(tooltip)

    // Estimate cell dimensions for initial uPlot size
    const cellWidth = cell.clientWidth || (chartTarget.clientWidth / Math.min(panels.length, 2))
    const rowSpan = (() => {
      const r = panel.layout?.gridRow || ''
      const m = r.match(/^(\d+)\s*\/\s*(\d+)$/)
      return m ? parseInt(m[2]) - parseInt(m[1]) : 1
    })()
    const cellHeight = cell.clientHeight || Math.max(100, (chartTarget.clientHeight || 567) / panels.length * rowSpan)

    const uplotOpts = {
      ...opts,
      width: cellWidth,
      height: cellHeight,
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
      },
    }

    try {
      const plot = new uplot(uplotOpts, plotDataWithX, cell)
      plots.push(plot)
      connectUplotDragZoom(plot, cell, { applyZoomDateRange })

      // Save per-panel reference so resize can find them
      cell._uplot = plot
    } catch (error) {
      console.error(`uPlot: Failed to render panel ${i}`, error)
    }
  }

  if (plots.length > 0) {
    buildSharedLegend(plots, data, chartTarget)
  }

  // Store for cleanup
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

  const isMultiPanel = panels.length > 1 || (data.layout?.columns != null)

  if (isMultiPanel) {
    chartTarget.style.height = (data.height || 567) + 'px'
    renderMultiPanel(chartTarget, panels, data, { applyZoomDateRange })
  } else {
    renderSinglePanel(chartTarget, panels[0], data, { applyZoomDateRange })
  }

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
    if (Array.isArray(plots)) {
      for (const p of plots) {
        if (p && p.destroy) try { p.destroy() } catch {}
      }
    } else if (plots.destroy) {
      try { plots.destroy() } catch {}
    }
    chartTarget._uplot = null
  }

  // Remove multi-panel grid if present
  const grid = chartTarget._uplotGrid
  if (grid) {
    grid.remove()
    chartTarget._uplotGrid = null
  }

  // Remove shared legend if present
  const legend = document.querySelector('.uplot-shared-legend')
  if (legend) legend.remove()
}

function resizeUplots(chartTarget) {
  const plots = chartTarget._uplot
  if (!plots) return

  if (Array.isArray(plots)) {
    for (const p of plots) {
      if (!p || !p.root) continue
      const parent = p.root.parentNode
      if (parent) {
        p.setSize({
          width: parent.clientWidth,
          height: parent.clientHeight,
        })
      }
    }
  } else if (plots.setSize) {
    plots.setSize({
      width: chartTarget.clientWidth,
      height: chartTarget.clientHeight,
    })
  }
}
