import { router, parsePath, getQuery, updateQuery } from "../router.js"
import { closeAllDropdowns, toggleMenu } from "../dropdown_utils.js"

export function initTopnavDate() {
  const root = document.getElementById('topnav-date')
  if (!root) return

  const fromInput = document.getElementById('date-from')
  const toInput = document.getElementById('date-to')
  const menu = root.querySelector('.date-preset-menu')
  const presetText = root.querySelector('.date-preset-btn .dropdown-value')
  const resolutionMenu = root.querySelector('.resolution-menu')
  const resolutionSelectedText = root.querySelector('.resolution-btn .dropdown-value')
  const timezone = root.querySelector('.timezone-selector')

  let preset = null
  let previousFrom = null
  let previousTo = null

  function getResolution() {
    return getQuery().min_resolution || '15m'
  }

  function selectResolution(button) {
    const resolution = button.dataset.resolution
    closeAllDropdowns()
    updateQuery({ min_resolution: resolution })
    if (resolutionSelectedText) resolutionSelectedText.textContent = resolution
    updateResolutionSelectedState()
  }

  function updateResolutionSelectedState() {
    if (!resolutionMenu) return
    const currentResolution = getResolution()
    resolutionMenu.querySelectorAll(".resolution-option").forEach(option => {
      option.classList.toggle("selected", option.dataset.resolution === currentResolution)
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

    const resolutionButton = event.target.closest('.resolution-option')
    if (resolutionButton) return selectResolution(resolutionButton)

    if (event.target.closest('.date-preset-btn')) return toggleMenu(menu, root.querySelector('.date-preset-btn'))
    if (event.target.closest('.resolution-btn')) return toggleMenu(resolutionMenu, root.querySelector('.resolution-btn'))
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
    updateResolutionSelectedState()
    updateResolutionUI()
    updateUI()
  }

  syncFromUrl()
  router.onChange(syncFromUrl)

}
