import echarts from "../vendor/echarts_client.bundle.js"
import uplot from "../vendor/uplot_client.bundle.js"
import {
  formatEnergy,
  formatPower,
  formatPrice,
  processEchartsFormatters,
} from "../vendor/echarts_formatters.js"
import { router, parsePath } from "../router.js"
import { calculateResolution, parseDateRange } from "../../src/shared/dateParsing.js"
import { dashboardChartLibrary } from "../../src/shared/dashboardCatalog.js"
import { divergentSeries } from "../../src/shared/series.js"
import { buildUplotPayload } from "../../src/shared/uplotPayload.js"

const DRAG_ZOOM_GRAPHIC_ID = 'drag-zoom-rect'
const DRAG_ZOOM_MIN_PIXELS = 8
const DRAG_ZOOM_MIN_MS = 60_000

export function initChart() {
  const chartTarget = document.getElementById('main-chart')
  if (!chartTarget) return

  new ChartModule(chartTarget, document.getElementById('chart-error')).connect()
}

class ChartModule {
  constructor(chartTarget, errorTarget) {
    this.chartTarget = chartTarget
    this.errorTarget = errorTarget
    this.hasErrorTarget = !!errorTarget
    this.uplotLib = null
  }

  /**
   * Determine which chart library to use based on the current dashboard type.
   */
  getChartLibrary() {
    const pathParams = parsePath()
    if (!pathParams?.dashboard) return 'echarts'
    return dashboardChartLibrary(pathParams.dashboard) || 'echarts'
  }

  connect() {
    this.abortController = null
    this.chart = null
    this.chartLibrary = this.getChartLibrary()

    // For uPlot, defer initialization; for ECharts, init immediately
    if (this.chartLibrary === 'echarts') {
      this.chart = echarts.init(this.chartTarget)
      this.connectDragZoom()
    }

    this.fetchData()
    router.onChange(() => this.fetchData())
    this.boundHandleResize = this.handleResize.bind(this)
    window.addEventListener('resize', this.boundHandleResize)
  }

  destroyChart() {
    if (this.chartLibrary === 'echarts' && this.chart) {
      this.chart.dispose()
      this.chart = null
    } else if (this.chartLibrary === 'uplot' && this.chartTarget._uplot) {
      this.chartTarget._uplot.destroy()
      this.chartTarget._uplot = null
    }
  }

  handleResize() {
    if (this.chartLibrary === 'echarts' && this.chart) {
      this.chart.resize()
    } else if (this.chartLibrary === 'uplot' && this.chartTarget._uplot) {
      this.chartTarget._uplot.setSize({
        width: this.chartTarget.clientWidth,
        height: this.chartTarget.clientHeight,
      })
    }
  }

  showLoading() {
    if (this.chartLibrary === 'echarts' && this.chart) {
      this.chart.showLoading({ text: '', color: '#0077FF', textColor: '#0077FF', maskColor: 'rgba(255, 255, 255, 0.7)', zlevel: 100 })
    } else {
      // Simple CSS loading indicator for uPlot
      this.chartTarget.style.opacity = '0.5'
    }
  }

  hideLoading() {
    if (this.chartLibrary === 'echarts' && this.chart) {
      this.chart.hideLoading({ zlevel: 100 })
    } else {
      this.chartTarget.style.opacity = '1'
    }
  }

  fetchData() {
    if (this.abortController) {
      this.abortController.abort()
    }

    // Re-evaluate chart library (dashboard may have changed via router)
    this.chartLibrary = this.getChartLibrary()

    this.abortController = new AbortController()
    const currentAbortController = this.abortController

    // Both echarts and uplot are loaded statically at page load (earlier than AJAX).

    const resolution = this.chartResolution()
    const params = {}
    window.location.search.replace(/^\?/, '').split('&').filter(Boolean).forEach(pair => {
      const [k, v] = pair.split('=', 2)
      if (k) params[k] = v
    })
    delete params.min_resolution
    if (resolution) params.resolution = resolution
    const query = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&')
    const url = window.location.pathname + '.json' + (query ? '?' + query : '')
    const responsePromise = fetch(url, { headers: { Accept: 'application/json' }, signal: currentAbortController.signal })

    this.showLoading()
    if (this.hasErrorTarget) {
      this.errorTarget.hidden = true
    }

    // Libraries are already loaded — just fetch data
    responsePromise
    .then(response => {
      if (!response.ok) throw new Error('Network response was not ok')
      return response.json()
    })
    .then(data => {
      if (currentAbortController.signal.aborted || this.abortController !== currentAbortController) return
      this.renderChart(data)
      if (data.timezone) {
        document.dispatchEvent(new CustomEvent('timezone-loaded', { detail: { timezone: data.timezone } }))
      }
      if (data.production_types) {
        document.dispatchEvent(new CustomEvent('production-types-loaded', { detail: { production_types: data.production_types } }))
      }
      if (data.units) {
        document.dispatchEvent(new CustomEvent('units-loaded', { detail: { units: data.units } }))
      }
      if (data.transmission_lines) {
        document.dispatchEvent(new CustomEvent('transmission-lines-loaded', { detail: { transmission_lines: data.transmission_lines } }))
      }
    })
    .catch(error => {
      if (error.name !== 'AbortError') {
        console.error('Error fetching chart data:', error)
        if (this.hasErrorTarget) {
          this.errorTarget.textContent = 'Failed to load data. Please try again.'
          this.errorTarget.hidden = false
        }
      }
    })
    .finally(() => {
      if (this.abortController === currentAbortController) {
        this.hideLoading()
      }
    })
  }

  chartResolution() {
    const pathParams = parsePath()
    if (!pathParams?.from || !pathParams?.to) return '15m'
    try {
      // YoY dashboards always return 1 year of data regardless of the URL's from/to.
      // Override the duration so the resolution is appropriate for a year-long span.
      const isYoy = ['demand_yoy', 'generation_yoy'].includes(pathParams.dashboard)
      const range = isYoy
        ? { from: new Date(Date.now() - 365 * 86400 * 1000), to: new Date() }
        : parseDateRange(pathParams.from, pathParams.to)
      const width = window.innerWidth
      const minResolution = new URLSearchParams(window.location.search).get('min_resolution') || '15m'
      return calculateResolution(range.from, range.to, width, minResolution)
    } catch (error) {
      console.warn('Failed to calculate chart resolution:', error)
      return '15m'
    }
  }

  async renderChart(data) {
    // Handle data that comes with a chartLibrary indicator
    if (data.chartLibrary === 'uplot') {
      this.renderUplot(data)
      return
    }

    if (data.frames) {
      this.renderChoroplethAnimation(data)
      return
    }

    if (data.options) {
      // Destroy any existing uPlot instance before rendering ECharts
      if (this.chartTarget._uplot) {
        this.chartTarget._uplot.destroy()
        this.chartTarget._uplot = null
      }
      // Ensure ECharts instance exists (may have been destroyed by uPlot rendering)
      if (!this.chart) {
        this.chart = echarts.init(this.chartTarget)
        this.connectDragZoom()
      }
      const mapSeries = data.options.series?.find(s => s.type === 'map') || 
                       data.options.baseOption?.series?.find(s => s.type === 'map')
      if (mapSeries && data.geoJsonUrl) {
        await this.loadMapGeoJSON(data.geoJsonUrl, mapSeries.map)
      }
      
      data.options = processEchartsFormatters(data.options)
      this.processTooltipFormatter(data.options)
      delete data.options.dataZoom
      delete data.options.toolbox
      data.options.animation = false

      if (data.height) {
        this.chartTarget.style.height = data.height + 'px'
      }
      
      this.chart.resize()
      this.chart.setOption(data.options, true)
    }
  }

  renderUplot(data) {
    // Dispose any previous chart instance first
    if (this.chart) {
      this.chart.dispose()
      this.chart = null
    }
    if (this.chartTarget._uplot) {
      this.chartTarget._uplot.destroy()
      this.chartTarget._uplot = null
    }

    // Delegate to heatmap renderer when heatmap data is present
    if (data.heatmapMeta) {
      this._renderUplotHeatmap(data)
      return
    }

    // Remove old custom elements
    const oldTip = this.chartTarget.querySelector('.uplot-tooltip')
    if (oldTip) oldTip.remove()
    // (Built-in uPlot legend replaces the old custom one)

    // Override uPlot's default width:min-content so chart fills the container
    this.chartTarget.style.width = '100%'
    this.chartTarget.style.minWidth = '0'
    this.chartTarget.style.position = 'relative'

    // ── Handle new client-side payload format (raw series) ──
    if (data.mainSeries) {
      const timestamps = this._rebuildTimestamps(data.startTime, data.interval, data.mainSeries)
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

    // Rebuild timestamps from startTime + interval * index (avoids sending full array over wire).
    const count = (plotData[0]?.length ?? 0)
    const timestamps = new Array(count)
    for (let i = 0; i < count; i++) {
      timestamps[i] = startTime + i * interval
    }
    const plotDataWithX = [timestamps, ...plotData]
    const rawDataWithX = [timestamps, ...(rawData || plotData)]
    this._lastRawData = rawDataWithX

    // Apply per-series rendering hints (e.g. bars, scatter) before creating the chart.
    // seriesMeta runs parallel to opts.series[1..] (skipping the time entry at [0]).
    if (seriesMeta && opts.series) {
      for (let i = 0; i < seriesMeta.length; i++) {
        const meta = seriesMeta[i]
        const s = opts.series[i + 1]
        if (!s || !meta) continue
        if (meta.type === 'bar') {
          // uPlot's built-in bars path builder reads bands to determine per-bar
          // baseline (the previous series' cumulative value). Bands between
          // consecutive cumulative series produce correct stacking.
          s.paths = uplot.paths.bars({ gap: 4 })
        }
      }
    }

    // Fixed chart height from server payload
    const fixedHeight = data.height || 567
    this.chartTarget.style.height = fixedHeight + 'px'

    // Build custom tooltip element
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
    this.chartTarget.appendChild(tooltip)

    const width = this.chartTarget.clientWidth || 800
    const chartHeight = parseInt(this.chartTarget.style.height) || 400
    const heightPx = this.chartTarget.clientHeight || chartHeight

    // Add axis value formatting and make legend static (no live values)
    // to prevent `--` placeholders and layout shifts on hover.
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
      ...(data.timezone ? { tzDate: (ts) => uplot.tzDate(new Date(ts * 1e3), data.timezone) } : {}),
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx
            if (idx == null) {
              tooltip.style.display = 'none'
              return
            }

            // Build tooltip content: time + each visible series
            // Use rawData (non-cumulative values) for tooltips so each
            // series shows its own contribution, not the cumulative total.
            const series = u.series
            const rawData = this._lastRawData
            if (!rawData) return

            // Format the timestamp
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

            // Group visible series by label (de-duplicate, e.g. "Transmission" split into pos/neg)
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

            // Build tooltip rows from groups, reverse order so tooltip lists
            // from top downwards (matching stack bottom-up).
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

            // Add total for primary-axis groups (de-duplicated)
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
      const plot = new uplot(uplotOpts, plotDataWithX, this.chartTarget)
      this.chartTarget._uplot = plot

      // Build custom legend that merges entries with the same label
      this.buildUplotLegend(plot, opts.series)

      // Watch for resize
      if (!this._uplotResizeHandler) {
        this._uplotResizeHandler = () => {
          if (this.chartTarget._uplot) {
            this.chartTarget._uplot.setSize({
              width: this.chartTarget.clientWidth,
              height: this.chartTarget.clientHeight,
            })
          }
        }
        window.addEventListener('resize', this._uplotResizeHandler)
      }
    } catch (error) {
      console.error('uPlot: Failed to render chart', error)
    }
  }

  /**
   * Render a heatmap using uPlot with a custom plugin.
   * Receives heatmapMeta from the server: { timestamps, unitNames, values }
   */
  _renderUplotHeatmap(data) {
    const { heatmapMeta, timezone } = data
    const { timestamps, unitNames, values } = heatmapMeta

    const unitCount = unitNames.length
    const count = timestamps.length
    if (count === 0 || unitCount === 0) return

    // Override uPlot's default width:min-content so chart fills the container
    this.chartTarget.style.width = '100%'
    this.chartTarget.style.minWidth = '0'
    this.chartTarget.style.position = 'relative'
    const fixedHeight = data.height || 567
    this.chartTarget.style.height = fixedHeight + 'px'

    const width = this.chartTarget.clientWidth || 800

    // Build tooltip element
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
    this.chartTarget.appendChild(tooltip)

    // Color gradient matching the ECharts heatmap version
    const colors = ['#FFFFB2', '#FECC5C', '#FD8D3C', '#F03B20', '#BD0026']

    // Heatmap plugin — paints colored rectangles at each (timestamp, unit) cell
    function heatmapPlugin() {
      return {
        hooks: {
          draw: (u) => {
            const { ctx } = u
            const interval = timestamps.length > 1 ? timestamps[1] - timestamps[0] : 0
            if (interval === 0) return

            // Divide plot area equally among units, ensuring a minimum track height
            const rawCellH = Math.floor(u.bbox.height / unitCount)
            const minCellH = 16
            const cellH = Math.max(minCellH, rawCellH)
            // Add a small gap between rows when tracks are roomy enough
            const gap = rawCellH >= minCellH + 2 ? 2 : (rawCellH >= minCellH + 1 ? 1 : 0)
            const drawH = cellH - gap

            ctx.save()
            ctx.beginPath()
            ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height)
            ctx.clip()

            for (let xi = 0; xi < count; xi++) {
              // Tile each column from this timestamp's pixel position
              // to the next timestamp's — guarantees no gaps between columns
              const colStart = u.valToPos(timestamps[xi], 'x', true)
              const colEnd = xi < count - 1
                ? u.valToPos(timestamps[xi + 1], 'x', true)
                : colStart + (timestamps.length > 1 ? timestamps[1] - timestamps[0] : 0)

              const xPos = Math.round(colStart)
              const xEnd = Math.round(colEnd)
              const drawW = Math.max(1, xEnd - xPos)

              const row = values[xi]
              if (!row) continue

              // Skip columns that are entirely off-screen
              if (xPos + drawW < u.bbox.left || xPos > u.bbox.left + u.bbox.width) continue

              for (let yi = 0; yi < unitCount; yi++) {
                const val = row[yi]
                if (val == null) continue
                // Center cell at the unit's y-position (aligns with tooltip posToVal)
                const yPos = Math.round(u.valToPos(yi, 'y', true) - cellH / 2)

                // Skip rows off-screen
                if (yPos + drawH < u.bbox.top || yPos > u.bbox.top + u.bbox.height) continue

                // Map 0–100 % to 0–4 color index
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

    // Heatmap tooltip — shows on hover
    function makeHeatmapTooltip() {
      return (u) => {
        const idx = u.cursor.idx
        if (idx == null || idx >= count) {
          tooltip.style.display = 'none'
          return
        }

        // Find the closest unit index from cursor y-position
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

        // Position tooltip near cursor, staying within chart bounds
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

    // Y-axis splits: one tick per unit at integer positions
    const ySplits = []
    for (let i = 0; i < unitCount; i++) ySplits.push(i)

    // Estimate y-axis width needed for the longest unit name
    const maxLabelChars = unitNames.reduce((max, n) => Math.max(max, n.length), 0)
    // ~7px per char at 12px font, plus padding for tick/gap
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

    // Dummy series data to establish y-scale range
    const yMin = new Array(count).fill(0)
    const yMax = new Array(count).fill(unitCount - 1)
    const plotData = [timestamps, yMin, yMax]

    try {
      const plot = new uplot(opts, plotData, this.chartTarget)
      this.chartTarget._uplot = plot

      // Watch for resize
      if (!this._uplotResizeHandler) {
        this._uplotResizeHandler = () => {
          if (this.chartTarget._uplot) {
            this.chartTarget._uplot.setSize({
              width: this.chartTarget.clientWidth,
              height: this.chartTarget.clientHeight,
            })
          }
        }
        window.addEventListener('resize', this._uplotResizeHandler)
      }
    } catch (error) {
      console.error('uPlot: Failed to render heatmap', error)
    }
  }

  processTooltipFormatter(options) {
    if (!options.tooltip) return
    
    if (options.tooltip.formatter?.type) {
      const formatter = options.tooltip.formatter
      const seriesMap = this.buildSeriesUnitMap(options.series)
      
      options.tooltip.formatter = (params) => {
        // With dataset+encode, p.value is the row [t, v1, v2, ...].
        // Extract the y-value via encode mapping; fall back to p.value for legacy flat data.
        const val = p => p.encode?.y?.length != null ? Number(p.value[p.encode.y[0]]) : Number(p.value)

        // Timestamp from row column 0 (dataset) or p.name (legacy category axis)
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
  
  buildSeriesUnitMap(series) {
    const map = {}
    const seriesArray = Array.isArray(series) ? series : [series]
    seriesArray.forEach((s, i) => {
      if (s.unit) map[i] = s.unit
    })
    return map
  }

  connectDragZoom() {
    const zr = this.chart.getZr()
    this.zoomDrag = null
    zr.on('mousedown', event => this.startZoomDrag(event))
    zr.on('mousemove', event => this.updateZoomDrag(event))
    zr.on('mouseup', () => this.finishZoomDrag())
    zr.on('globalout', () => this.finishZoomDrag())
  }

  startZoomDrag(event) {
    const point = [event.offsetX, event.offsetY]
    if (event.event?.button !== 0 || !this.isInMainGrid(point)) return
    this.zoomDrag = { start: point, end: point, selecting: false }
  }

  updateZoomDrag(event) {
    if (!this.zoomDrag) return
    this.zoomDrag.end = [event.offsetX, event.offsetY]

    const width = Math.abs(this.zoomDrag.end[0] - this.zoomDrag.start[0])
    if (width < DRAG_ZOOM_MIN_PIXELS && !this.zoomDrag.selecting) return

    this.zoomDrag.selecting = true
    this.renderZoomDragSelection()
  }

  finishZoomDrag() {
    if (!this.zoomDrag) return

    const { start, end, selecting } = this.zoomDrag
    this.zoomDrag = null
    this.clearZoomDragSelection()
    if (!selecting) return

    const from = this.pixelToTime(start)
    const to = this.pixelToTime(end)
    if (!Number.isFinite(from) || !Number.isFinite(to) || Math.abs(to - from) < DRAG_ZOOM_MIN_MS) return

    this.applyZoomDateRange(Math.min(from, to), Math.max(from, to))
  }

  renderZoomDragSelection() {
    const [x1] = this.zoomDrag.start
    const [x2] = this.zoomDrag.end
    this.chart.setOption({
      graphic: [{
        id: DRAG_ZOOM_GRAPHIC_ID,
        type: 'rect',
        silent: true,
        z: 100,
        shape: {
          x: Math.min(x1, x2),
          y: 0,
          width: Math.abs(x2 - x1),
          height: this.chartTarget.clientHeight,
        },
        style: { fill: 'rgba(0, 119, 255, 0.18)', stroke: '#0077FF', lineWidth: 1 },
      }]
    }, false)
  }

  clearZoomDragSelection() {
    this.chart.setOption({ graphic: [{ id: DRAG_ZOOM_GRAPHIC_ID, $action: 'remove' }] }, false)
  }

  isInMainGrid(point) {
    try {
      return this.chart.containPixel({ gridIndex: 0 }, point)
    } catch (_error) {
      return false
    }
  }

  pixelToTime(point) {
    const value = this.chart.convertFromPixel({ gridIndex: 0 }, point)
    const raw = Array.isArray(value) ? value[0] : value
    // For category axis, raw is the category index; look up the timestamp from xAxis.data.
    if (typeof raw === 'number' && !(raw instanceof Date)) {
      const xAxis = this.chart.getOption().xAxis
      const xData = Array.isArray(xAxis) ? xAxis[0]?.data : xAxis?.data
      if (xData && Number.isInteger(raw) && raw >= 0 && raw < xData.length) {
        return Number(xData[raw])
      }
    }
    return raw instanceof Date ? raw.getTime() : Number(raw)
  }

  applyZoomDateRange(fromTimestamp, toTimestamp) {
    const from = this.formatZoomDate(fromTimestamp)
    const to = this.formatZoomDate(toTimestamp)
    const fromInput = document.getElementById('date-from')
    const toInput = document.getElementById('date-to')

    fromInput?.classList.remove('preset-mode')
    toInput?.classList.remove('preset-mode')
    if (fromInput) fromInput.value = from
    if (toInput) toInput.value = to
    router.updatePath({ from, to })
  }

  formatZoomDate(timestamp) {
    return new Date(timestamp).toISOString().slice(0, 16)
  }

  async renderChoroplethAnimation(data) {
    const frames = data.frames
    if (!frames || frames.length === 0) return

    this.frames = frames
    this.chartTarget.style.height = '800px'
    this.chart && this.chart.resize()

    if (data.geoJsonUrl) {
      await this.loadMapGeoJSON(data.geoJsonUrl, data.mapName || 'world')
    }

    data.options = processEchartsFormatters(data.options)

    // Size visualMap to fill available chart height
    if (data.options?.baseOption?.visualMap) {
      const chartHeight = this.chartTarget.clientHeight || 800
      const top = data.options.baseOption.visualMap.top || 50
      const bottom = data.options.baseOption.visualMap.bottom || 60
      const itemHeight = chartHeight - top - bottom
      data.options.baseOption.visualMap.itemHeight = itemHeight

      // Reposition graphics text to match the visualMap height
      if (data.options.baseOption.graphic) {
        for (const g of data.options.baseOption.graphic) {
          if (g.type === 'text' && g.$value != null) {
            g.top = top + ((500 - g.$value) / 500) * itemHeight
          }
        }
      }
    }

    this.chart.setOption(data.options, true)
    window.nextPriceMap = () => this.nextPriceMap()
  }

  nextPriceMap() {
    if (!this.frames) return false
    
    const currentIndex = this.chart.getOption().timeline?.[0]?.currentIndex || 0
    if (currentIndex >= this.frames.length - 1) return false
    
    this.chart.dispatchAction({ type: 'timelineChange', currentIndex: currentIndex + 1 })
    return true
  }

  async loadMapGeoJSON(url, mapName) {
    if (!url || echarts.getMap(mapName)) {
      return
    }
    try {
      const response = await fetch(url)
      const geoJson = await response.json()
      echarts.registerMap(mapName, geoJson)
    } catch (error) {
      console.warn('Failed to load map GeoJSON, map may not render:', error)
    }
  }

  /**
   * Build a custom legend that merges entries with the same label (e.g.,
   * "Transmission" split by divergentSeries into pos/neg).
   */
  buildUplotLegend(plot, seriesOpts) {
    // Remove any previous custom legend
    const oldLegend = this.chartTarget.querySelector('.uplot-custom-legend')
    if (oldLegend) oldLegend.remove()

    // Group series by label
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

      // Use the stroke of the first series in the group for the marker
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

      // Toggle all series in the group on click
      entry.addEventListener('click', () => {
        const visible = plot.series[indices[0]].show
        for (const idx of indices) {
          plot.setSeries(idx, { show: !visible })
        }
        entry.style.opacity = visible ? '0.4' : '1'
      })

      legend.appendChild(entry)
    }

    this.chartTarget.appendChild(legend)
  }

  /**
   * Rebuild timestamps array from startTime + interval * index,
   * determining count from the longest series data array.
   */
  _rebuildTimestamps(startTime, interval, seriesList) {
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
  
}
