import { Controller } from "@hotwired/stimulus"
import { router, parsePath, getQuery, updateQuery } from "../router.js"
import { closeAllDropdowns, toggleMenu, triggerChartUpdate } from "../dropdown_utils.js"

export default class extends Controller {
  static targets = ["fromInput", "toInput", "menu", "preset", "intervalMenu", "intervalSelectedText", "timezone"]

  preset = null
  previousFrom = null
  previousTo = null

  connect() {
    this.initializeFromUrl()
    this.updateUI()
    this.updateIntervalUI()
    this.updateIntervalSelectedState()

    this.routerUnsubscribe = router.onChange(() => {
      this.initializeFromUrl()
      this.updateIntervalSelectedState()
      this.updateIntervalUI()
    })

    document.addEventListener('timezone-loaded', (event) => {
      this.updateTimezone(event.detail.timezone)
    })

    this.fromInputTarget.addEventListener('focus', () => this.onDateInputFocus())
    this.toInputTarget.addEventListener('focus', () => this.onDateInputFocus())
    this.fromInputTarget.addEventListener('blur', () => this.onDateInputBlur())
    this.toInputTarget.addEventListener('blur', () => this.onDateInputBlur())
    this.fromInputTarget.addEventListener('keydown', (e) => this.onDateInputKeydown(e))
    this.toInputTarget.addEventListener('keydown', (e) => this.onDateInputKeydown(e))
  }

  disconnect() {
    if (this.routerUnsubscribe) {
      this.routerUnsubscribe()
    }
  }

  getInterval() {
    const query = getQuery()
    return query.min_interval || '15m'
  }

  selectInterval(event) {
    const button = event.currentTarget
    const interval = button.dataset.interval

    closeAllDropdowns()
    updateQuery({ min_interval: interval })
    if (this.hasIntervalSelectedTextTarget) {
      this.intervalSelectedTextTarget.textContent = interval
    }
    this.updateIntervalSelectedState()
    triggerChartUpdate()
  }

  updateIntervalSelectedState() {
    if (!this.intervalMenuTarget) return
    const currentInterval = this.getInterval()
    this.intervalMenuTarget.querySelectorAll(".interval-option").forEach(option => {
      option.classList.toggle("selected", option.dataset.interval === currentInterval)
    })
  }

  updateIntervalUI() {
    if (this.hasIntervalSelectedTextTarget) {
      this.intervalSelectedTextTarget.textContent = this.getInterval()
    }
  }

  toggleIntervalMenu() {
    const button = this.element.querySelector(".interval-btn")
    toggleMenu(this.intervalMenuTarget, button)
  }

  initializeFromUrl() {
    const pathParams = parsePath()
    const presetAttr = this.element.getAttribute('data-topnav-date-preset-value') || 'last_7_days'

    if (pathParams?.from && pathParams?.to) {
      this.fromInputTarget.value = pathParams.from
      this.toInputTarget.value = pathParams.to
      this.preset = this.findMatchingPreset() || presetAttr
    } else {
      const presetButton = this.menuTarget.querySelector(`[data-preset="${presetAttr}"]`)
      if (presetButton && presetButton.dataset.from) {
        this.fromInputTarget.value = presetButton.dataset.from
        this.toInputTarget.value = presetButton.dataset.to
        this.preset = presetAttr
      } else {
        this.fromInputTarget.value = '7 days ago'
        this.toInputTarget.value = 'now'
        this.preset = 'last_7_days'
      }
    }
    this.updateSelectedState()
  }

  findMatchingPreset() {
    const from = this.fromInputTarget.value
    const to = this.toInputTarget.value
    const presetButtons = this.menuTarget.querySelectorAll('.date-preset-option[data-preset]')
    for (const button of presetButtons) {
      if (button.dataset.from === from && button.dataset.to === to) {
        return button.dataset.preset
      }
    }
    return null
  }

  onDateInputFocus() {
    this.previousFrom = this.fromInputTarget.value
    this.previousTo = this.toInputTarget.value
    this.switchToCustom()
  }

  onDateInputBlur() {
    const from = this.fromInputTarget.value
    const to = this.toInputTarget.value

    if (from === this.previousFrom && to === this.previousTo) return

    this.preset = this.findMatchingPreset() || ''
    this.updateSelectedState()
    this.updateUI()
    this._updateUrl()
    triggerChartUpdate()
  }

  onDateInputKeydown(event) {
    if (event.key === 'Enter') {
      event.target.blur()
    }
  }

  selectPreset(event) {
    const button = event.currentTarget

    this.fromInputTarget.value = button.dataset.from || ''
    this.toInputTarget.value = button.dataset.to || ''
    this.preset = button.dataset.preset || ''

    this.updateSelectedState()
    closeAllDropdowns()
    this.updateUI()
    this._updateUrl()
    triggerChartUpdate()

    if (typeof window.gtag === 'function') {
      window.gtag('event', 'select_preset', { preset: this.preset })
    }
  }

  _updateUrl() {
    const from = this.fromInputTarget.value
    const to = this.toInputTarget.value
    router.updatePath({ from, to })
  }

  updateSelectedState() {
    this.menuTarget.querySelectorAll(".date-preset-option").forEach(option => {
      option.classList.toggle("selected", option.dataset.preset === this.preset)
    })
  }

  toggleMenu() {
    const button = this.element.querySelector(".date-preset-btn")
    toggleMenu(this.menuTarget, button)
  }

  updateUI() {
    const preset = this.preset

    this.presetTarget.textContent = preset ?
      this.getPresetDisplayName(preset) : 'Custom'

    const hasPreset = !!preset
    if (hasPreset) {
      this.fromInputTarget.classList.add('preset-mode')
      this.toInputTarget.classList.add('preset-mode')
    } else {
      this.fromInputTarget.classList.remove('preset-mode')
      this.toInputTarget.classList.remove('preset-mode')
    }
  }

  getPresetDisplayName(preset) {
    const selectedButton = this.menuTarget.querySelector(`[data-preset="${preset}"]`)
    if (selectedButton) {
      const textSpan = selectedButton.querySelector('.option-text')
      return textSpan ? textSpan.textContent : preset
    }
    return preset
  }

  switchToCustom() {
    if (this.preset) {
      this.preset = ''
      this.updateUI()
    }
  }

  updateTimezone(timezone) {
    this.timezoneTarget.querySelector('.timezone-name').textContent = timezone
  }
}

