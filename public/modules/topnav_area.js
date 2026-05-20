import { router, onChange, parsePath } from "../router.js"
import { closeAllDropdowns, toggleMenu, triggerChartUpdate } from "../dropdown_utils.js"

export function initTopnavArea() {
  const root = document.getElementById('topnav-area')
  if (!root) return null

  const menu = root.querySelector('.area-menu')
  const selectionText = root.querySelector('.location-selector-btn .dropdown-value')
  const areaTypeTitle = root.querySelector('[data-area-type-title]')
  const areaTitle = root.querySelector('[data-area-title]')
  const areaTypeOptions = root.querySelector('[data-area-type-options]')
  const areaOptions = root.querySelector('[data-area-options]')

  let region = null
  let areaType = null
  let urlAreas = []
  let areaTypeMap = {}
  let areaMap = {}

  function initializeAreaMaps() {
    let areasData = null
    const initialState = document.getElementById('initial-state')
    if (initialState?.textContent) {
      try {
        areasData = JSON.parse(initialState.textContent).areasData
      } catch (e) {
        console.error('Failed to parse initial state:', e)
      }
    }

    if (!areasData || Object.keys(areasData).length === 0) {
      const rawData = root.getAttribute('data-areas-data')
      if (rawData?.trim().startsWith('{')) {
        try {
          areasData = JSON.parse(rawData)
        } catch (e) {
          console.error('Failed to parse areas data:', e)
        }
      }
    }

    if (!areasData || Object.keys(areasData).length === 0) {
      console.warn('No areas data available')
      areaTypeMap = {}
      areaMap = {}
      return
    }

    for (const regionName of Object.keys(areasData)) {
      if (!areasData[regionName]) continue
      areaTypeMap[regionName] = Object.keys(areasData[regionName]).map(type => ({
        value: type,
        label: titleize(type.replace(/_/g, ' '))
      }))
    }

    areaMap = areasData
    areaTypeMap.default ||= [{ value: 'country', label: 'Country' }]
    areaMap.default ||= { country: [] }
  }

  function initializeFromUrl() {
    const urlParams = parsePath()
    if (!urlParams) return
    region = urlParams.region
    areaType = urlParams.areaType
    urlAreas = urlParams.area ? urlParams.area.split(',').filter(Boolean) : []
  }

  function selectRegion(selectedRegion) {
    region = selectedRegion
    areaType = null
    root.querySelectorAll('.step-option[data-region]').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.region === region)
    })
    hideStepsAfter('region')
    showStep('areaType')
    updateAreaTypeOptions()
  }

  function selectAreaType(selectedAreaType) {
    areaType = selectedAreaType
    root.querySelectorAll('.step-option[data-area-type]').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.areaType === areaType)
    })
    hideStepsAfter('areaType')
    showStep('areas')
    updateAreaOptions()
  }

  function toggleArea(checkbox) {
    const area = checkbox.value
    const allCheckbox = areaOptions.querySelector(".dropdown-checkbox[value='all']")
    if (area === 'all') {
      if (checkbox.checked) {
        areaOptions.querySelectorAll('.dropdown-checkbox').forEach(cb => {
          if (cb.value !== 'all') cb.checked = false
        })
      }
    } else if (checkbox.checked && allCheckbox) {
      allCheckbox.checked = false
    }
  }

  function applySelection() {
    const areas = getSelectedAreas()
    if (areas.length === 0) {
      const allCheckbox = areaOptions.querySelector(".dropdown-checkbox[value='all']")
      if (allCheckbox) allCheckbox.checked = true
      areas.push('all')
    }
    urlAreas = areas
    updateSelectionText()
    closeAllDropdowns()
    updateUrl()
    triggerChartUpdate()
  }

  function getSelectedAreas() {
    const allCheckbox = areaOptions.querySelector(".dropdown-checkbox[value='all']")
    if (allCheckbox?.checked) return ['all']
    return Array.from(areaOptions.querySelectorAll('.dropdown-checkbox:checked')).map(cb => cb.value)
  }

  function updateUrl() {
    router.updatePath({ region, areaType, area: urlAreas.join(',') })
  }

  function backToStep() {
    const visibleSteps = menu.querySelectorAll('.location-step.visible')
    const lastVisibleStep = visibleSteps[visibleSteps.length - 1]
    const currentStepName = lastVisibleStep?.dataset.step
    if (currentStepName === 'areaType') {
      hideStepsAfter('region')
      showStep('region')
    } else if (currentStepName === 'areas') {
      hideStepsAfter('areaType')
      showStep('areaType')
    }
  }

  function showStep(stepName) {
    menu.querySelector(`[data-step="${stepName}"]`)?.classList.add('visible')
  }

  function hideStepsAfter(stepName) {
    const stepOrder = ['region', 'areaType', 'areas']
    stepOrder.slice(stepOrder.indexOf(stepName) + 1).forEach(stepToHide => {
      menu.querySelector(`[data-step="${stepToHide}"]`)?.classList.remove('visible')
    })
  }

  function updateRegionOptions() {
    root.querySelectorAll('.step-option[data-region]').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.region === region)
    })
  }

  function updateAreaTypeOptions() {
    const areaTypes = getAreaTypesForRegion(region)
    if (areaTypeTitle) areaTypeTitle.textContent = capitalize(region)
    areaTypeOptions.innerHTML = areaTypes.map(type => `
      <button type="button" class="step-option ${type.value === areaType ? 'selected' : ''}" data-area-type="${type.value}">
        <span class="option-text">${type.label}</span>
        <span class="option-arrow">→</span>
      </button>
    `).join('')
  }

  function updateAreaOptions() {
    const areas = getAreasForRegionAndType(region, areaType)
    if (areaTitle) areaTitle.textContent = capitalize(getAreaTypeLabel(areaType))
    const selected = urlAreas
    const isAllSelected = selected.includes('all')
    const allCheckbox = areaOptions.querySelector(".dropdown-checkbox[value='all']")
    if (allCheckbox) allCheckbox.checked = isAllSelected

    const html = areas.map(area => {
      const isSelected = !isAllSelected && selected.includes(area.code)
      return `
        <div class="dropdown-option">
          <input type="checkbox" class="dropdown-checkbox" id="area-${area.code}" value="${area.code}" ${isSelected ? 'checked' : ''}>
          <label class="dropdown-label" for="area-${area.code}">${area.label}</label>
        </div>
      `
    }).join('')
    const individualAreasContainer = areaOptions.querySelector('.individual-areas')
    if (individualAreasContainer) individualAreasContainer.innerHTML = html
  }

  function updateSelectionText() {
    const regionLabel = capitalize(region)
    const selected = urlAreas
    const areasText = selected.includes('all') ? 'All areas' : selected.join(', ')
    selectionText.textContent = `${regionLabel} • ${areasText}`
  }

  function getAreaTypesForRegion(regionName) {
    return areaTypeMap[regionName] || areaTypeMap.default || []
  }

  function getAreasForRegionAndType(regionName, type) {
    return (areaMap[regionName] || areaMap.default || {})[type] || []
  }

  function getAreaTypeLabel(type) {
    const found = getAreaTypesForRegion(region).find(t => t.value === type)
    return found ? found.label.toLowerCase() : type
  }

  function capitalize(str = '') {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }

  function titleize(str) {
    return str.replace(/\b\w/g, l => l.toUpperCase())
  }

  root.addEventListener('click', event => {
    if (event.target.closest('.location-selector-btn')) return toggleMenu(menu, root.querySelector('.location-selector-btn'))
    if (event.target.closest('.step-close')) return closeAllDropdowns()
    if (event.target.closest('.step-back')) return backToStep()
    const regionButton = event.target.closest('.step-option[data-region]')
    if (regionButton) return selectRegion(regionButton.dataset.region)
    const areaTypeButton = event.target.closest('.step-option[data-area-type]')
    if (areaTypeButton) return selectAreaType(areaTypeButton.dataset.areaType)
    if (event.target.closest('.action-btn.apply')) return applySelection()
  })

  root.addEventListener('change', event => {
    const checkbox = event.target.closest('[data-area-options] .dropdown-checkbox')
    if (checkbox) toggleArea(checkbox)
  })

  function syncFromUrl({ params } = {}) {
    if (params?.region) region = params.region
    if (params?.areaType) areaType = params.areaType
    if (params?.area) urlAreas = params.area.split(',').filter(Boolean)
    updateRegionOptions()
    updateAreaTypeOptions()
    updateAreaOptions()
    updateSelectionText()
  }

  initializeAreaMaps()
  initializeFromUrl()
  syncFromUrl({ params: parsePath() })
  onChange(syncFromUrl)

  return { syncFromUrl }
}
