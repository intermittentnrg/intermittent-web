import uplot from "../vendor/uplot_client.bundle.js"
import { formatPower, formatPrice } from "../vendor/echarts_formatters.js"
import { divergentSeries } from "../../src/shared/series.js"
import { buildUplotPayload } from "../../src/shared/uplotPayload.js"

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

function buildUplotLegend(plot, seriesOpts, chartTarget) {
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

  const colors = ['#FFFFB2', '#FECC5C', '#FD8D3C', '#F03B20', '#BD0026']

  function heatmapPlugin() {
    return {
      hooks: {
        draw: (u) => {
          const { ctx } = u
          const interval = timestamps.length > 1 ? timestamps[1] - timestamps[0] : 0
          if (interval === 0) return

          const rawCellH = Math.floor(u.bbox.height / unitCount)
          const minCellH = 16
          const cellH = Math.max(minCellH, rawCellH)
          const gap = rawCellH >= minCellH + 2 ? 2 : (rawCellH >= minCellH + 1 ? 1 : 0)
          const drawH = cellH - gap

          ctx.save()
          ctx.beginPath()
          ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height)
          ctx.clip()

          for (let xi = 0; xi < count; xi++) {
            const colStart = u.valToPos(timestamps[xi], 'x', true)
            const colEnd = xi < count - 1
              ? u.valToPos(timestamps[xi + 1], 'x', true)
              : colStart + (timestamps.length > 1 ? timestamps[1] - timestamps[0] : 0)

            const xPos = Math.round(colStart)
            const xEnd = Math.round(colEnd)
            const drawW = Math.max(1, xEnd - xPos)

            const row = values[xi]
            if (!row) continue

            if (xPos + drawW < u.bbox.left || xPos > u.bbox.left + u.bbox.width) continue

            for (let yi = 0; yi < unitCount; yi++) {
              const val = row[yi]
              if (val == null) continue
              const yPos = Math.round(u.valToPos(yi, 'y', true) - cellH / 2)

              if (yPos + drawH < u.bbox.top || yPos > u.bbox.top + u.bbox.height) continue

              const ci = Math.min(colors.length - 1, Math.floor(val / 100 * colors.length))
              ctx.fillStyle = colors[ci]
              ctx.fillRect(xPos, yPos, drawW, drawH)
            }
          }

          ctx.restore()
        }
      }
    }
  }

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
    plugins: [heatmapPlugin()],
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
    chartTarget._uplot = plot

    // Set up resize handler (once)
    if (!chartTarget._uplotResizeHandler) {
      chartTarget._uplotResizeHandler = () => {
        if (chartTarget._uplot) {
          chartTarget._uplot.setSize({
            width: chartTarget.clientWidth,
            height: chartTarget.clientHeight,
          })
        }
      }
      window.addEventListener('resize', chartTarget._uplotResizeHandler)
    }
  } catch (error) {
    console.error('uPlot: Failed to render heatmap', error)
  }
}

// ── Main render function (exported) ──

export function renderUplot(chartTarget, data, { applyZoomDateRange }) {
  // Dispose any previous uPlot instance
  if (chartTarget._uplot) {
    chartTarget._uplot.destroy()
    chartTarget._uplot = null
  }

  // Delegate to heatmap renderer when heatmap data is present
  if (data.heatmapMeta) {
    renderHeatmap(chartTarget, data)
    return
  }

  // Remove old custom elements
  const oldTip = chartTarget.querySelector('.uplot-tooltip')
  if (oldTip) oldTip.remove()

  chartTarget.style.width = '100%'
  chartTarget.style.minWidth = '0'
  chartTarget.style.position = 'relative'

  // ── Handle client-side payload format (raw series) ──
  if (data.mainSeries) {
    const timestamps = rebuildTimestamps(data.startTime, data.interval, data.mainSeries)
    const allSeries = [
      ...divergentSeries(data.mainSeries),
      ...(data.extraSeries || []),
    ]
    const processed = buildUplotPayload(data.title, timestamps, allSeries)
    data.opts = processed.opts
    data.data = processed.data
    data.rawData = processed.rawData
    data.seriesMeta = processed.seriesMeta
    data.startTime = processed.startTime
    data.interval = processed.interval
  }

  const { opts, data: plotData, rawData, seriesMeta, startTime, interval } = data

  const count = (plotData[0]?.length ?? 0)
  const timestamps = new Array(count)
  for (let i = 0; i < count; i++) {
    timestamps[i] = startTime + i * interval
  }
  const plotDataWithX = [timestamps, ...plotData]
  const rawDataWithX = [timestamps, ...(rawData || plotData)]
  const lastRawData = rawDataWithX

  if (seriesMeta && opts.series) {
    for (let i = 0; i < seriesMeta.length; i++) {
      const meta = seriesMeta[i]
      const s = opts.series[i + 1]
      if (!s || !meta) continue
      if (meta.type === 'bar') {
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
      if (axis.scale === 'y') {
        return { ...axis, values: (u, ticks) => ticks.map(v => formatPower(v)) }
      }
      if (axis.scale === '%') {
        return { ...axis, values: (u, ticks) => ticks.map(v => formatPrice(v)) }
      }
      return axis
    }),
    // Disable built-in drag-zoom; we use custom that reloads via router
    select: { show: false },
    cursor: {
      ...(opts.cursor || {}),
      drag: { x: false, y: false },
    },
    ...(data.timezone ? { tzDate: (ts) => uplot.tzDate(new Date(ts * 1e3), data.timezone) } : {}),
    hooks: {
      setCursor: [
        (u) => {
          const idx = u.cursor.idx
          if (idx == null) {
            tooltip.style.display = 'none'
            return
          }

          const series = u.series
          const rawData = lastRawData
          if (!rawData) return

          const ts = rawData[0][idx]
          const date = new Date(Number(ts) * 1e3).toLocaleString('en-GB', {
            timeZone: data.timezone || 'UTC',
            hour12: false,
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })

          let html = `<div style="font-weight:600;margin-bottom:4px;border-bottom:1px solid #e5e7eb;padding-bottom:4px;">${date}</div>`

          const groups = new Map()
          for (let si = 1; si < series.length; si++) {
            const s = series[si]
            if (!s.show) continue
            const raw = rawData[si]?.[idx]
            if (raw == null) continue
            const label = s.label || ''
            if (!groups.has(label)) {
              groups.set(label, {
                color: s.stroke(u, si),
                scale: s.scale,
                rawTotal: 0,
              })
            }
            groups.get(label).rawTotal += raw
          }

          const groupEntries = Array.from(groups.entries()).reverse()
          for (const [label, g] of groupEntries) {
            const isSecondary = g.scale === '%'
            const val = isSecondary ? formatPrice(g.rawTotal) : formatPower(g.rawTotal)
            html += `<div style="display:flex;align-items:center;gap:6px;">`
            html += `<span style="width:10px;height:10px;border-radius:2px;background:${g.color};flex-shrink:0;"></span>`
            html += `<span>${label}</span>`
            html += `<span style="margin-left:auto;font-weight:500;">${val}</span>`
            html += `</div>`
          }

          let total = 0
          let hasTotal = false
          for (const [, g] of groups) {
            if (g.scale === '%') continue
            total += g.rawTotal
            hasTotal = true
          }
          if (hasTotal) {
            html += `<div style="display:flex;align-items:center;gap:6px;margin-top:4px;padding-top:4px;border-top:1px solid #e5e7eb;">`
            html += `<span style="font-weight:600;">Total</span>`
            html += `<span style="margin-left:auto;font-weight:600;">${formatPower(total)}</span>`
            html += `</div>`
          }

          tooltip.innerHTML = html

          const cx = u.cursor.left
          const cy = u.cursor.top
          const tw = 260

          let left = cx + 8 + tw < width
            ? cx + 8
            : cx - tw - 8

          left = Math.max(4, Math.min(left, width - tw - 4))

          tooltip.style.left = left + 'px'
          tooltip.style.top = (cy - 10) + 'px'
          tooltip.style.display = 'block'
        },
      ],
    },
  }

  try {
    const plot = new uplot(uplotOpts, plotDataWithX, chartTarget)
    chartTarget._uplot = plot

    connectUplotDragZoom(plot, chartTarget, { applyZoomDateRange })
    buildUplotLegend(plot, opts.series, chartTarget)

    // Set up resize handler (once per chartTarget)
    if (!chartTarget._uplotResizeHandler) {
      chartTarget._uplotResizeHandler = () => {
        if (chartTarget._uplot) {
          chartTarget._uplot.setSize({
            width: chartTarget.clientWidth,
            height: chartTarget.clientHeight,
          })
        }
      }
      window.addEventListener('resize', chartTarget._uplotResizeHandler)
    }
  } catch (error) {
    console.error('uPlot: Failed to render chart', error)
  }
}
