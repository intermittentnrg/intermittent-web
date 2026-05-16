import { Controller } from "@hotwired/stimulus"
import * as echarts from "echarts"
import { router } from "../router.js"

export default class extends Controller {
  static targets = ["chart", "error"]

  connect() {
    this.abortController = null
    this.chart = echarts.init(this.chartTarget)
    this.fetchData()
    this.routerUnsubscribe = router.onChange(() => this.fetchData())
    document.addEventListener('update-chart', () => this.fetchData())

    this.boundHandleResize = this.handleResize.bind(this)
    window.addEventListener('resize', this.boundHandleResize)
  }

  disconnect() {
    if (this.abortController) {
      this.abortController.abort()
    }
    if (this.routerUnsubscribe) {
      this.routerUnsubscribe()
    }
    if (this.chart) {
      this.chart.dispose()
      this.chart = null
    }
    window.removeEventListener('resize', this.boundHandleResize)
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
      this.errorTarget.style.display = 'none'
    }

    const params = this.buildParams()
    const url = `${window.location.pathname}/echarts.json${params}`

    fetch(url, {
      headers: { "Accept": "application/json" },
      signal: currentAbortController.signal
    })
    .then(response => {
      if (!response.ok) throw new Error('Network response was not ok')
      return response.json()
    })
    .then(data => {
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
          this.errorTarget.style.display = 'block'
        }
      }
    })
    .finally(() => {
      if (this.abortController === currentAbortController) {
        this.chart.hideLoading({ zlevel: 100 })
      }
    })
  }

  buildParams() {
    const chartWidth = this.chartTarget?.offsetWidth || 800
    const search = window.location.search
    return search ? `${search}&width=${chartWidth}` : `?width=${chartWidth}`
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
      
      this.processFormatters(data.options)
      this.processTooltipFormatter(data.options)
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
            value = this.formatPower(value)
            total += p.value[1] || 0
          } else if (unit === 'energy') {
            value = this.formatEnergy(value)
          } else if (unit === 'price') {
            value = this.formatPrice(value)
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
          ? `<b>Total: ${this.formatPower(total)}</b>` 
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
  
  processFormatters(options) {
    const yAxes = Array.isArray(options.yAxis) ? options.yAxis : [options.yAxis]
    
    yAxes.forEach(axis => {
      if (axis?.axisLabel?.formatter) {
        const formatter = axis.axisLabel.formatter
        if (typeof formatter === 'object' && formatter.type) {
          axis.axisLabel.formatter = this.getFormatter(formatter.type)
        } else if (typeof formatter === 'object' && formatter.unit) {
          axis.axisLabel.formatter = this.getFormatterByUnit(formatter.unit)
        }
      }
    })
    
    if (options.xAxis?.axisLabel?.formatter?.type === 'date') {
      options.xAxis.axisLabel.formatter = this.getFormatter('date')
    }
    
    const series = Array.isArray(options.series) ? options.series : [options.series]
    series.forEach(s => {
      if (s?.label?.formatter?.type) {
        const type = s.label.formatter.type
        s.label.formatter = (params) => this.formatByType(params.value, type)
      }
    })
  }
  
  formatByType(value, type) {
    if (type === 'energy') return this.formatEnergy(value)
    if (type === 'power') return this.formatPower(value)
    if (type === 'price') return this.formatPrice(value)
    return value?.toString() || '-'
  }
  
  getFormatter(type) {
    const formatters = {
      power: (value) => this.formatPower(value, 0),
      energy: (value) => this.formatEnergy(value, 0),
      price: (value) => this.formatPrice(value, 0),
      date: (value) => {
        const d = new Date(value)
        return `${d.getMonth() + 1}/${d.getDate()}`
      }
    }
    return formatters[type] || ((v) => v.toString())
  }
  
  getFormatterByUnit(unit) {
    if (unit.includes('€/MWh') || unit.includes('€')) {
      return (value) => this.formatPrice(value, 0)
    }
    if (unit === 'Wh' || unit.includes('Wh')) {
      return (value) => this.formatEnergy(value, 0)
    }
    if (unit === 'W' || unit.includes('W')) {
      return (value) => this.formatPower(value, 0)
    }
    return (value) => value.toFixed(0)
  }
  
  formatPower(value) {
    return this.formatMagnitude(value, ['W', 'kW', 'MW', 'GW', 'TW'])
  }
  
  formatEnergy(value) {
    return this.formatMagnitude(value, ['Wh', 'kWh', 'MWh', 'GWh', 'TWh'])
  }
  
  formatMagnitude(value, suffixes) {
    if (value === null || value === undefined || isNaN(value)) return '-'
    const absValue = Math.abs(value)
    for (let i = suffixes.length - 1; i >= 0; i--) {
      const threshold = Math.pow(1000, i)
      if (absValue >= threshold) {
        return (value / threshold).toFixed(0) + suffixes[i]
      }
    }
    return value.toFixed(0) + suffixes[0]
  }
  
  formatPrice(value) {
    if (value === null || value === undefined || isNaN(value)) return '-'
    return value.toFixed(0) + '€/MWh'
  }
}
