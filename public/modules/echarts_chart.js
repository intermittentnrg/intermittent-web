import echarts from "../vendor/echarts_client.bundle.js"
import {
  formatEnergy,
  formatPower,
  formatPrice,
  processEchartsFormatters,
} from "../vendor/echarts_formatters.js"

const DRAG_ZOOM_GRAPHIC_ID = 'drag-zoom-rect'
const DRAG_ZOOM_MIN_PIXELS = 8
const DRAG_ZOOM_MIN_MS = 60_000

// ── ECharts drag-zoom (reloads via router) ──

function startZoomDrag(event, state, chartTarget) {
  const point = [event.offsetX, event.offsetY]
  if (event.event?.button !== 0 || !isInMainGrid(state.chart, point)) return
  state.zoomDrag = { start: point, end: point, selecting: false }
}

function updateZoomDrag(event, state) {
  if (!state.zoomDrag) return
  state.zoomDrag.end = [event.offsetX, event.offsetY]

  const width = Math.abs(state.zoomDrag.end[0] - state.zoomDrag.start[0])
  if (width < DRAG_ZOOM_MIN_PIXELS && !state.zoomDrag.selecting) return

  state.zoomDrag.selecting = true
  renderZoomDragSelection(state.chart, state.zoomDrag, chartTarget)
}

function finishZoomDrag(state, chartTarget, applyZoomDateRange) {
  if (!state.zoomDrag) return

  const { start, end, selecting } = state.zoomDrag
  state.zoomDrag = null
  clearZoomDragSelection(state.chart)
  if (!selecting) return

  const from = pixelToTime(state.chart, start)
  const to = pixelToTime(state.chart, end)
  if (!Number.isFinite(from) || !Number.isFinite(to) || Math.abs(to - from) < DRAG_ZOOM_MIN_MS) return

  applyZoomDateRange(Math.min(from, to), Math.max(from, to))
}

function renderZoomDragSelection(chart, zoomDrag, chartTarget) {
  const [x1] = zoomDrag.start
  const [x2] = zoomDrag.end
  chart.setOption({
    graphic: [{
      id: DRAG_ZOOM_GRAPHIC_ID,
      type: 'rect',
      silent: true,
      z: 100,
      shape: {
        x: Math.min(x1, x2),
        y: 0,
        width: Math.abs(x2 - x1),
        height: chartTarget.clientHeight,
      },
      style: { fill: 'rgba(0, 119, 255, 0.18)', stroke: '#0077FF', lineWidth: 1 },
    }]
  }, false)
}

function clearZoomDragSelection(chart) {
  chart.setOption({ graphic: [{ id: DRAG_ZOOM_GRAPHIC_ID, $action: 'remove' }] }, false)
}

function isInMainGrid(chart, point) {
  try {
    return chart.containPixel({ gridIndex: 0 }, point)
  } catch (_error) {
    return false
  }
}

function pixelToTime(chart, point) {
  const value = chart.convertFromPixel({ gridIndex: 0 }, point)
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw === 'number' && !(raw instanceof Date)) {
    const xAxis = chart.getOption().xAxis
    const xData = Array.isArray(xAxis) ? xAxis[0]?.data : xAxis?.data
    if (xData && Number.isInteger(raw) && raw >= 0 && raw < xData.length) {
      return Number(xData[raw])
    }
  }
  return raw instanceof Date ? raw.getTime() : Number(raw)
}

function connectDragZoom(chart, chartTarget, applyZoomDateRange) {
  const zr = chart.getZr()
  const state = { chart, zoomDrag: null }

  zr.on('mousedown', event => startZoomDrag(event, state, chartTarget))
  zr.on('mousemove', event => updateZoomDrag(event, state))
  zr.on('mouseup', () => finishZoomDrag(state, chartTarget, applyZoomDateRange))
  zr.on('globalout', () => finishZoomDrag(state, chartTarget, applyZoomDateRange))
}

// ── Tooltip formatter ──

function buildSeriesUnitMap(series) {
  const map = {}
  const seriesArray = Array.isArray(series) ? series : [series]
  seriesArray.forEach((s, i) => {
    if (s.unit) map[i] = s.unit
  })
  return map
}

function processTooltipFormatter(options) {
  if (!options.tooltip) return

  if (options.tooltip.formatter?.type) {
    const formatter = options.tooltip.formatter
    const seriesMap = buildSeriesUnitMap(options.series)

    options.tooltip.formatter = (params) => {
      const val = p => p.encode?.y?.length != null ? Number(p.value[p.encode.y[0]]) : Number(p.value)

      const ts = params[0]?.value?.[0] ?? params[0]?.name
      const date = ts ? new Date(Number(ts)).toLocaleString('en-GB', { timeZone: 'UTC', hour12: false }) : ''

      const nonZero = params.filter(p => val(p) !== 0)
      if (nonZero.length === 0) return date || '-'

      let total = 0
      const parts = nonZero.map(p => {
        const num = val(p)
        const unit = seriesMap[p.seriesIndex] || formatter.type

        let display
        if (unit === 'power') {
          display = formatPower(num)
          total += num
        } else if (unit === 'energy') {
          display = formatEnergy(num)
        } else if (unit === 'price') {
          display = formatPrice(num)
        } else if (unit === 'temperature') {
          display = (num.toFixed(0) || '-') + '°C'
        } else if (unit === 'percent') {
          display = ((num * 100).toFixed(1) || '-') + '%'
        } else {
          display = num.toFixed(0) || '-'
        }
        return `${p.marker} ${p.seriesName}: ${display}`
      })

      const totalStr = (formatter.type === 'power' || formatter.type === 'dual')
        ? `<b>Total: ${formatPower(total)}</b>`
        : ''
      return date + '<br/>' + (totalStr ? totalStr + '<br/>' : '') + parts.join('<br/>')
    }
  }
}

// ── Choropleth animation ──

async function renderChoroplethAnimation(chart, chartTarget, data) {
  const frames = data.frames
  if (!frames || frames.length === 0) return

  chartTarget._frames = frames
  chartTarget.style.height = '800px'
  chart.resize()

  if (data.geoJsonUrl) {
    await loadMapGeoJSON(data.geoJsonUrl, data.mapName || 'world')
  }

  data.options = processEchartsFormatters(data.options)

  if (data.options?.baseOption?.visualMap) {
    const chartHeight = chartTarget.clientHeight || 800
    const top = data.options.baseOption.visualMap.top || 50
    const bottom = data.options.baseOption.visualMap.bottom || 60
    const itemHeight = chartHeight - top - bottom
    data.options.baseOption.visualMap.itemHeight = itemHeight

    if (data.options.baseOption.graphic) {
      for (const g of data.options.baseOption.graphic) {
        if (g.type === 'text' && g.$value != null) {
          g.top = top + ((500 - g.$value) / 500) * itemHeight
        }
      }
    }
  }

  chart.setOption(data.options, true)
  window.nextPriceMap = () => nextPriceMap(chart, chartTarget)
}

function nextPriceMap(chart, chartTarget) {
  if (!chartTarget._frames) return false

  const currentIndex = chart.getOption().timeline?.[0]?.currentIndex || 0
  if (currentIndex >= chartTarget._frames.length - 1) return false

  chart.dispatchAction({ type: 'timelineChange', currentIndex: currentIndex + 1 })
  return true
}

async function loadMapGeoJSON(url, mapName) {
  if (!url || echarts.getMap(mapName)) return
  try {
    const response = await fetch(url)
    const geoJson = await response.json()
    echarts.registerMap(mapName, geoJson)
  } catch (error) {
    console.warn('Failed to load map GeoJSON, map may not render:', error)
  }
}

// ── Public API ──

export function initEcharts(chartTarget, { applyZoomDateRange }) {
  if (chartTarget._echarts) {
    chartTarget._echarts.dispose()
  }
  const chart = echarts.init(chartTarget)
  chartTarget._echarts = chart
  connectDragZoom(chart, chartTarget, applyZoomDateRange)
}

export function renderEcharts(chartTarget, data, { applyZoomDateRange }) {
  // Clean up uPlot if switching
  if (chartTarget._uplot) {
    chartTarget._uplot.destroy()
    chartTarget._uplot = null
  }

  // Handle choropleth animation
  if (data.frames) {
    renderChoroplethAnimation(chartTarget._echarts, chartTarget, data)
    return
  }

  if (!data.options) return

  // Ensure ECharts instance exists (may have been destroyed by uPlot)
  if (!chartTarget._echarts) {
    initEcharts(chartTarget, { applyZoomDateRange })
  }

  const chart = chartTarget._echarts

  const mapSeries = data.options.series?.find(s => s.type === 'map') ||
                   data.options.baseOption?.series?.find(s => s.type === 'map')
  if (mapSeries && data.geoJsonUrl) {
    // Use a then since loadMapGeoJSON is async but we don't want to block rendering
    loadMapGeoJSON(data.geoJsonUrl, mapSeries.map)
  }

  data.options = processEchartsFormatters(data.options)
  processTooltipFormatter(data.options)
  delete data.options.dataZoom
  delete data.options.toolbox
  data.options.animation = false

  if (data.height) {
    chartTarget.style.height = data.height + 'px'
  }

  chart.resize()
  chart.setOption(data.options, true)
}

export function disposeEcharts(chartTarget) {
  if (chartTarget._echarts) {
    chartTarget._echarts.dispose()
    chartTarget._echarts = null
  }
}
