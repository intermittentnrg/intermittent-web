import { router, parsePath } from "/assets/router.js"
import { calculateResolution, parseDateRange } from "../../src/shared/dateParsing.js"
import { dashboardChartLibrary } from "../../src/shared/dashboardCatalog.js"

export function initChart({ onDataLoaded } = {}) {
  const chartTarget = document.getElementById('main-chart')
  if (!chartTarget) return

  new ChartModule(chartTarget, document.getElementById('chart-error')).init(onDataLoaded)
}

class ChartModule {
  constructor(chartTarget, errorTarget) {
    this.chartTarget = chartTarget
    this.errorTarget = errorTarget
    this.hasErrorTarget = !!errorTarget
  }

  getChartLibrary() {
    const pathParams = parsePath()
    if (!pathParams?.dashboard) return 'echarts'
    return dashboardChartLibrary(pathParams.dashboard) || 'echarts'
  }

  async init(onDataLoaded) {
    this.abortController = null
    this._renderToken = 0
    this.chartLibrary = this.getChartLibrary()
    this.onDataLoaded = onDataLoaded

    // Eagerly initialize the renderer so showLoading etc. work before data arrives
    if (this.chartLibrary === 'echarts') {
      const { initEcharts } = await import('../vendor/echarts_client.bundle.js')
      initEcharts(this.chartTarget, {
        applyZoomDateRange: (fromMs, toMs) => this.applyZoomDateRange(fromMs, toMs),
      })
    }

    this.fetchData()
    router.onChange(() => this.fetchData())
  }

  showLoading() {
    this.chartTarget.style.opacity = '0.5'
    let spinner = this.chartTarget.querySelector('.chart-loading-spinner')
    if (!spinner) {
      spinner = document.createElement('div')
      spinner.className = 'chart-loading-spinner'
      spinner.innerHTML = `<div class="spinner"></div>`
      spinner.style.cssText = `
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 500;
        pointer-events: none;
      `
      const ring = spinner.firstElementChild
      ring.style.cssText = `
        width: 32px;
        height: 32px;
        border: 3px solid #e5e7eb;
        border-top-color: #0077FF;
        border-radius: 50%;
        animation: chart-spin 0.7s linear infinite;
      `
      this.chartTarget.appendChild(spinner)

      if (!document.getElementById('chart-spinner-style')) {
        const style = document.createElement('style')
        style.id = 'chart-spinner-style'
        style.textContent = `@keyframes chart-spin { to { transform: rotate(360deg); } }`
        document.head.appendChild(style)
      }
    }
    spinner.style.display = 'flex'
  }

  hideLoading() {
    this.chartTarget.style.opacity = '1'
    const spinner = this.chartTarget.querySelector('.chart-loading-spinner')
    if (spinner) spinner.style.display = 'none'
  }

  fetchData() {
    if (this.abortController) {
      this.abortController.abort()
    }

    this.chartLibrary = this.getChartLibrary()

    this.abortController = new AbortController()
    const currentAbortController = this.abortController
    const renderToken = ++this._renderToken

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
    const responsePromise = fetch(url, {
      headers: { Accept: 'application/json' },
      signal: currentAbortController.signal,
    })

    this.showLoading()
    if (this.hasErrorTarget) {
      this.errorTarget.hidden = true
    }

    responsePromise
      .then(response => {
        if (!response.ok) throw new Error('Network response was not ok')
        return response.json()
      })
      .then(data => {
        if (currentAbortController.signal.aborted || this.abortController !== currentAbortController) return
        if (renderToken !== this._renderToken) return
        this.renderChart(data)
        if (this.onDataLoaded) {
          this.onDataLoaded(data)
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
    // Show message for empty data instead of a blank chart
    if (data.panels?.every(p => !p.stackedSeries?.length && !p.extraSeries?.length && !p.data?.length && !p.heatmapMeta)) {
      this.chartTarget.innerHTML = ''
      document.querySelector('.uplot-shared-legend')?.remove()
      if (this.hasErrorTarget) {
        this.errorTarget.textContent = 'No data available for this area'
        this.errorTarget.hidden = false
      }
      return
    }

    if (this.hasErrorTarget) this.errorTarget.hidden = true

    if (data.chartLibrary === 'uplot') {
      if (this.chartTarget._echarts) {
        const { disposeEcharts } = await import('../vendor/echarts_client.bundle.js')
        disposeEcharts(this.chartTarget)
      }
      const { renderUplot } = await import('../vendor/uplot_client.bundle.js')
      renderUplot(this.chartTarget, data, {
        applyZoomDateRange: (fromMs, toMs) => this.applyZoomDateRange(fromMs, toMs),
      })
      return
    }

    // ECharts path (default)
    const { renderEcharts } = await import('../vendor/echarts_client.bundle.js')
    renderEcharts(this.chartTarget, data, {
      applyZoomDateRange: (fromMs, toMs) => this.applyZoomDateRange(fromMs, toMs),
    })
  }

  applyZoomDateRange(fromTimestamp, toTimestamp) {
    const from = this.formatZoomDate(fromTimestamp)
    const to = this.formatZoomDate(toTimestamp)
    const fromInput = document.getElementById('date-from')
    const toInput = document.getElementById('date-to')

    fromInput?.classList.remove('date-range-selector__input--preset')
    toInput?.classList.remove('date-range-selector__input--preset')
    if (fromInput) fromInput.value = from
    if (toInput) toInput.value = to
    router.updatePath({ from, to })
  }

  formatZoomDate(timestamp) {
    return new Date(timestamp).toISOString().slice(0, 16)
  }
}
