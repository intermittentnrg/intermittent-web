import { router, parsePath, getQuery, updateQuery } from "/assets/router.js"
import { closeAllDropdowns, toggleMenu } from "/assets/dropdown_utils.js"

export function initTopnavDate() {
  const root = document.getElementById('topnav-date')
  if (!root) return null

  const datePanel = root.querySelector('.date-range-selector__panel')
  if (datePanel) {
    datePanel.innerHTML = `<div class="date-range-selector__panes">
      <div class="date-range-selector__presets">
        <button type="button" class="dropdown__option" data-preset="today" data-from="today" data-to="today"><span class="option-text">Today</span></button>
        <button type="button" class="dropdown__option" data-preset="yesterday" data-from="yesterday" data-to="yesterday"><span class="option-text">Yesterday</span></button>
        <button type="button" class="dropdown__option" data-preset="last_7_days" data-from="7 days ago" data-to="now"><span class="option-text">Last 7 Days</span></button>
        <button type="button" class="dropdown__option" data-preset="last_30_days" data-from="30 days ago" data-to="now"><span class="option-text">Last 30 Days</span></button>
        <button type="button" class="dropdown__option" data-preset="last_90_days" data-from="90 days ago" data-to="now"><span class="option-text">Last 90 Days</span></button>
        <button type="button" class="dropdown__option" data-preset="previous_week" data-from="last week" data-to="last week"><span class="option-text">Previous Week</span></button>
        <button type="button" class="dropdown__option" data-preset="previous_month" data-from="last month" data-to="last month"><span class="option-text">Previous Month</span></button>
        <button type="button" class="dropdown__option" data-preset="previous_year" data-from="last year" data-to="last year"><span class="option-text">Previous Year</span></button>
        <button type="button" class="dropdown__option" data-preset="last_year" data-from="1 year ago" data-to="now"><span class="option-text">Last Year</span></button>
        <button type="button" class="dropdown__option" data-preset="last_5_years" data-from="5 years ago" data-to="now"><span class="option-text">Last 5 Years</span></button>
      </div>
      <div class="date-range-selector__custom">
        <div class="date-range-selector__custom-body">
          <div class="date-range-selector__input-group"><label>From</label><input type="text" id="date-from" class="date-range-selector__input" placeholder="yesterday"></div>
          <div class="date-range-selector__input-group"><label>To</label><input type="text" id="date-to" class="date-range-selector__input" placeholder="today"></div>
          <div class="date-range-selector__hint"><span class="date-range-selector__hint-label">Try:</span><span>2024-01-15</span><span>7 days ago</span><span>yesterday &middot; now</span></div>
        </div>
        <div class="dropdown__actions"><button type="button" class="dropdown__apply">Apply</button></div>
      </div>
    </div>`
  }

  const resolutionPanel = root.querySelector('.resolution-selector__panel')
  if (resolutionPanel) {
    resolutionPanel.innerHTML = `
      <button type="button" class="dropdown__option" data-resolution="5m"><span class="option-text">5m</span></button>
      <button type="button" class="dropdown__option" data-resolution="15m"><span class="option-text">15m</span></button>
      <button type="button" class="dropdown__option" data-resolution="30m"><span class="option-text">30m</span></button>
      <button type="button" class="dropdown__option" data-resolution="1h"><span class="option-text">1h</span></button>
      <button type="button" class="dropdown__option" data-resolution="6h"><span class="option-text">6h</span></button>
      <button type="button" class="dropdown__option" data-resolution="12h"><span class="option-text">12h</span></button>
      <button type="button" class="dropdown__option" data-resolution="1d"><span class="option-text">1d</span></button>
      <button type="button" class="dropdown__option" data-resolution="1w"><span class="option-text">1w</span></button>
      <button type="button" class="dropdown__option" data-resolution="1M"><span class="option-text">1M</span></button>`
  }

  const menu = root.querySelector('.date-range-selector__panel')
  const fromInput = document.getElementById('date-from')
  const toInput = document.getElementById('date-to')
  const presetText = root.querySelector('.date-range-selector__trigger .dropdown__value')
  const resolutionMenu = root.querySelector('.resolution-selector__panel')
  const resolutionSelectedText = root.querySelector('.resolution-selector__trigger .dropdown__value')
  const timezone = root.querySelector('.timezone-selector')

  let preset = null
  let previousFrom = null
  let previousTo = null

  function getResolution() {
    return getQuery().min_resolution || '15m'
  }

  function selectResolution(button) {
    closeAllDropdowns()
    updateQuery({ min_resolution: button.dataset.resolution })
  }

  function updateResolutionSelectedState() {
    if (!resolutionMenu) return
    const currentResolution = getResolution()
    resolutionMenu.querySelectorAll(".dropdown__option").forEach(option => {
      option.classList.toggle("dropdown__option--selected", option.dataset.resolution === currentResolution)
    })
  }

  function updateResolutionUI() {
    if (resolutionSelectedText) resolutionSelectedText.textContent = getResolution()
  }

  function initializeFromUrl() {
    const pathParams = parsePath()
    const presetAttr = root.getAttribute('data-topnav-date-preset-value') || 'last_7_days'

    if (pathParams?.from && pathParams?.to) {
      fromInput.value = pathParams.from
      toInput.value = pathParams.to
      preset = findMatchingPreset() || ''
    } else {
      const presetButton = menu.querySelector(`[data-preset="${presetAttr}"]`)
      if (presetButton && presetButton.dataset.from) {
        fromInput.value = presetButton.dataset.from
        toInput.value = presetButton.dataset.to
        preset = presetAttr
      } else {
        fromInput.value = '7 days ago'
        toInput.value = 'now'
        preset = 'last_7_days'
      }
    }
    updateSelectedState()
  }

  function findMatchingPreset() {
    const from = fromInput.value
    const to = toInput.value
    for (const button of menu.querySelectorAll('.dropdown__option[data-preset]')) {
      if (button.dataset.from === from && button.dataset.to === to) return button.dataset.preset
    }
    return null
  }

  function onDateInputFocus() {
    previousFrom = fromInput.value
    previousTo = toInput.value
    switchToCustom()
  }

  function onDateInputBlur() {
    const from = fromInput.value
    const to = toInput.value
    if (from === previousFrom && to === previousTo) return

    // Re-evaluate whether the current values match a preset
    preset = findMatchingPreset() || ''
    updateSelectedState()
    updateUI()
  }

  function onDateInputKeydown(event) {
    if (event.key === 'Enter') {
      applyDateRange()
    }
  }

  function selectPreset(button) {
    fromInput.value = button.dataset.from || ''
    toInput.value = button.dataset.to || ''
    preset = button.dataset.preset || ''

    closeAllDropdowns()
    updateUrl()

    if (typeof window.gtag === 'function') {
      window.gtag('event', 'select_preset', { preset })
    }
  }

  function applyDateRange() {
    preset = findMatchingPreset() || ''
    updateSelectedState()
    updateUI()
    closeAllDropdowns()
    updateUrl()
  }

  function updateUrl() {
    router.updatePath({ from: fromInput.value, to: toInput.value })
  }

  function updateSelectedState() {
    menu.querySelectorAll(".dropdown__option").forEach(option => {
      option.classList.toggle("dropdown__option--selected", option.dataset.preset === preset)
    })
  }

  function updateUI() {
    if (presetText) presetText.textContent = preset ? getPresetDisplayName(preset) : `${fromInput.value} - ${toInput.value}`
    fromInput.classList.toggle('date-range-selector__input--preset', !!preset)
    toInput.classList.toggle('date-range-selector__input--preset', !!preset)
  }

  function getPresetDisplayName(presetName) {
    const selectedButton = menu.querySelector(`[data-preset="${presetName}"]`)
    const textSpan = selectedButton?.querySelector('.option-text')
    return textSpan ? textSpan.textContent : presetName
  }

  function switchToCustom() {
    if (preset) {
      preset = ''
      updateSelectedState()
      updateUI()
    }
  }

  function updateTimezone(value) {
    const timezoneName = timezone?.querySelector('.timezone-name')
    if (timezoneName) timezoneName.textContent = value
  }

  root.addEventListener('click', event => {
    const presetButton = event.target.closest('.date-range-selector__panel .dropdown__option')
    if (presetButton) return selectPreset(presetButton)

    const applyButton = event.target.closest('.dropdown__apply')
    if (applyButton) return applyDateRange()

    const resolutionButton = event.target.closest('.resolution-selector__panel .dropdown__option')
    if (resolutionButton) return selectResolution(resolutionButton)

    if (event.target.closest('.date-range-selector__trigger')) return toggleMenu(menu, root.querySelector('.date-range-selector__trigger'))
    if (event.target.closest('.resolution-selector__trigger')) return toggleMenu(resolutionMenu, root.querySelector('.resolution-selector__trigger'))
  })

  fromInput.addEventListener('focus', onDateInputFocus)
  toInput.addEventListener('focus', onDateInputFocus)
  fromInput.addEventListener('blur', onDateInputBlur)
  toInput.addEventListener('blur', onDateInputBlur)
  fromInput.addEventListener('keydown', onDateInputKeydown)
  toInput.addEventListener('keydown', onDateInputKeydown)

  function syncFromUrl() {
    initializeFromUrl()
    updateResolutionSelectedState()
    updateResolutionUI()
    updateUI()
  }

  syncFromUrl()
  router.onChange(syncFromUrl)

  return { updateTimezone }
}
