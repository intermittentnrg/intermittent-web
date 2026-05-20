import { router, parsePath, getQuery, updateQuery } from "../router.js"
import { closeAllDropdowns, toggleMenu, triggerChartUpdate } from "../dropdown_utils.js"

export function initTopnavDate() {
  const root = document.getElementById('topnav-date')
  if (!root) return null

  const fromInput = document.getElementById('date-from')
  const toInput = document.getElementById('date-to')
  const menu = root.querySelector('.date-preset-menu')
  const presetText = root.querySelector('.date-preset-btn .dropdown-value')
  const intervalMenu = root.querySelector('.interval-menu')
  const intervalSelectedText = root.querySelector('.interval-btn .dropdown-value')
  const timezone = root.querySelector('.timezone-selector')

  let preset = null
  let previousFrom = null
  let previousTo = null

  function getInterval() {
    return getQuery().min_interval || '15m'
  }

  function selectInterval(button) {
    const interval = button.dataset.interval
    closeAllDropdowns()
    updateQuery({ min_interval: interval })
    if (intervalSelectedText) intervalSelectedText.textContent = interval
    updateIntervalSelectedState()
    triggerChartUpdate()
  }

  function updateIntervalSelectedState() {
    if (!intervalMenu) return
    const currentInterval = getInterval()
    intervalMenu.querySelectorAll(".interval-option").forEach(option => {
      option.classList.toggle("selected", option.dataset.interval === currentInterval)
    })
  }

  function updateIntervalUI() {
    if (intervalSelectedText) intervalSelectedText.textContent = getInterval()
  }

  function initializeFromUrl() {
    const pathParams = parsePath()
    const presetAttr = root.getAttribute('data-topnav-date-preset-value') || 'last_7_days'

    if (pathParams?.from && pathParams?.to) {
      fromInput.value = pathParams.from
      toInput.value = pathParams.to
      preset = findMatchingPreset() || presetAttr
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
    for (const button of menu.querySelectorAll('.date-preset-option[data-preset]')) {
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

    preset = findMatchingPreset() || ''
    updateSelectedState()
    updateUI()
    updateUrl()
    triggerChartUpdate()
  }

  function onDateInputKeydown(event) {
    if (event.key === 'Enter') event.target.blur()
  }

  function selectPreset(button) {
    fromInput.value = button.dataset.from || ''
    toInput.value = button.dataset.to || ''
    preset = button.dataset.preset || ''

    updateSelectedState()
    closeAllDropdowns()
    updateUI()
    updateUrl()
    triggerChartUpdate()

    if (typeof window.gtag === 'function') {
      window.gtag('event', 'select_preset', { preset })
    }
  }

  function updateUrl() {
    router.updatePath({ from: fromInput.value, to: toInput.value })
  }

  function updateSelectedState() {
    menu.querySelectorAll(".date-preset-option").forEach(option => {
      option.classList.toggle("selected", option.dataset.preset === preset)
    })
  }

  function updateUI() {
    if (presetText) presetText.textContent = preset ? getPresetDisplayName(preset) : 'Custom'
    fromInput.classList.toggle('preset-mode', !!preset)
    toInput.classList.toggle('preset-mode', !!preset)
  }

  function getPresetDisplayName(presetName) {
    const selectedButton = menu.querySelector(`[data-preset="${presetName}"]`)
    const textSpan = selectedButton?.querySelector('.option-text')
    return textSpan ? textSpan.textContent : presetName
  }

  function switchToCustom() {
    if (preset) {
      preset = ''
      updateUI()
    }
  }

  function updateTimezone(value) {
    const timezoneName = timezone?.querySelector('.timezone-name')
    if (timezoneName) timezoneName.textContent = value
  }

  root.addEventListener('click', event => {
    const presetButton = event.target.closest('.date-preset-option')
    if (presetButton) return selectPreset(presetButton)

    const intervalButton = event.target.closest('.interval-option')
    if (intervalButton) return selectInterval(intervalButton)

    if (event.target.closest('.date-preset-btn')) return toggleMenu(menu, root.querySelector('.date-preset-btn'))
    if (event.target.closest('.interval-btn')) return toggleMenu(intervalMenu, root.querySelector('.interval-btn'))
  })

  fromInput.addEventListener('focus', onDateInputFocus)
  toInput.addEventListener('focus', onDateInputFocus)
  fromInput.addEventListener('blur', onDateInputBlur)
  toInput.addEventListener('blur', onDateInputBlur)
  fromInput.addEventListener('keydown', onDateInputKeydown)
  toInput.addEventListener('keydown', onDateInputKeydown)

  document.addEventListener('timezone-loaded', event => updateTimezone(event.detail.timezone))

  function syncFromUrl() {
    initializeFromUrl()
    updateIntervalSelectedState()
    updateIntervalUI()
    updateUI()
  }

  syncFromUrl()
  router.onChange(syncFromUrl)

  return { syncFromUrl }
}
