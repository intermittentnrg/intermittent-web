import echarts from "../vendor/echarts_client.bundle.js"
import {
  formatEnergy,
  formatPower,
  formatPrice,
  processEchartsFormatters,
} from "../vendor/echarts_formatters.js"
import { router, parsePath } from "../router.js"
import { calculateResolution, parseDateRange } from "../../src/shared/dateParsing.js"

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
  }

  connect() {
    this.abortController = null
    this.chart = echarts.init(this.chartTarget)
    this.connectDragZoom()
    this.fetchData()
    router.onChange(() => this.fetchData())
    this.boundHandleResize = this.handleResize.bind(this)
    window.addEventListener('resize', this.boundHandleResize)
  }

  handleResize() {
    if (this.chart) {
      this.chart.resize()
    }
  }

  fetchData() {
    if (this.abortController) {
      this.abortController.abort()
    }
    this.abortController = new AbortController()
    const currentAbortController = this.abortController

    this.chart.showLoading({ text: '', color: '#0077FF', textColor: '#0077FF', maskColor: 'rgba(255, 255, 255, 0.7)', zlevel: 100 })
    if (this.hasErrorTarget) {
      this.errorTarget.hidden = true
    }

    const resolution = this.chartResolution()
    const preloaded = window.__echartsJsonPreload
    if (preloaded) {
      delete window.__echartsJsonPreload
    }

    const responsePromise = preloaded
      ? preloaded
      : window.__fetchEchartsJson({ resolution, signal: currentAbortController.signal })

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
        this.chart.hideLoading({ zlevel: 100 })
      }
    })
  }

  chartResolution() {
    const pathParams = parsePath()
    if (!pathParams?.from || !pathParams?.to) return '15m'
    try {
      const range = parseDateRange(pathParams.from, pathParams.to)
      const width = window.innerWidth
      const minResolution = new URLSearchParams(window.location.search).get('min_resolution') || '15m'
      return calculateResolution(range.from, range.to, width, minResolution)
    } catch (error) {
      console.warn('Failed to calculate chart resolution:', error)
      return '15m'
    }
  }

  async renderChart(data) {
    if (data.frames) {
      this.renderChoroplethAnimation(data)
      return
    }

    if (data.options) {
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

  processTooltipFormatter(options) {
    if (!options.tooltip) return
    
    if (options.tooltip.formatter?.type) {
      const formatter = options.tooltip.formatter
      const seriesMap = this.buildSeriesUnitMap(options.series)
      
      options.tooltip.formatter = (params) => {
        const timestamp = params[0]?.value[0]
        const date = timestamp ? new Date(timestamp).toLocaleString() : ''
        
        let total = 0
        const parts = params.map(p => {
          let value = p.value[1]
          const unit = seriesMap[p.seriesIndex] || formatter.type
          
          if (unit === 'power') {
            value = formatPower(value)
            total += p.value[1] || 0
          } else if (unit === 'energy') {
            value = formatEnergy(value)
          } else if (unit === 'price') {
            value = formatPrice(value)
          } else if (unit === 'temperature') {
            value = value?.toFixed(0) + '°C'
          } else if (unit === 'percent') {
            value = (value * 100)?.toFixed(1) + '%'
          } else {
            value = value?.toFixed(0) || '-'
          }
          return `${p.marker} ${p.seriesName}: ${value}`
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
  
}
