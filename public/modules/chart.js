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

    const pathParams = parsePath()

    // About page — no chart, just static content
    if (pathParams?.dashboard === 'about') {
      this.renderAbout()
      return
    }

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
      .then(async response => {
        if (!response.ok) {
          let detail = `HTTP ${response.status}`
          try {
            const body = await response.json()
            if (body.message) detail = body.message
          } catch {}
          throw new Error(detail)
        }
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
            this.errorTarget.textContent = error.message
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

  renderAbout() {
    this.showLoading()
    if (this.hasErrorTarget) this.errorTarget.hidden = true
    this.chartTarget.innerHTML = ''
    document.querySelector('.uplot-shared-legend')?.remove()
    if (this.chartTarget._echarts) {
      import('../vendor/echarts_client.bundle.js').then(m => m.disposeEcharts(this.chartTarget))
    }
    this.hideLoading()

    this.chartTarget.innerHTML = `
      <div style="max-width: 600px; margin: 40px auto; padding: 0 20px; line-height: 1.7;">
        <h2 style="margin-top: 0;">About</h2>
        <p>
          High resolution graphs of electricity grid data — because monthly
          averages hide the intra-day and intra-month intermittency that
          matters. Full visibility into the real behaviour of the grid.
        </p>
        <p>
          Built with public grid data feeds and
          <a href="https://www.timescale.com/" target="_blank" rel="noopener"
             style="color: #0077FF;">TimescaleDB</a>.
        </p>
        <p>
          Feedback, questions, feature requests? DMs are open.
        </p>
        <div style="display: flex; gap: 12px; margin-top: 24px;">
          <a href="https://x.com/IntermittentNRG" target="_blank" rel="noopener"
             style="display: inline-flex; align-items: center; gap: 6px; padding: 10px 18px;
                    background: #000; color: #fff; border-radius: 6px; text-decoration: none;
                    font-size: 14px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            @IntermittentNRG
          </a>
          <a href="https://bsky.app/profile/intermittent.energy" target="_blank" rel="noopener"
             style="display: inline-flex; align-items: center; gap: 6px; padding: 10px 18px;
                    background: #1185fe; color: #fff; border-radius: 6px; text-decoration: none;
                    font-size: 14px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm3.75 14.25a.75.75 0 01-.75.75h-6a.75.75 0 01-.75-.75v-8.5a.75.75 0 01.75-.75h6a.75.75 0 01.75.75v8.5z"/></svg>
            @intermittent.energy
          </a>
        </div>
      </div>
    `
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
