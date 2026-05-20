import { router } from "../router.js"
import { closeAllDropdowns, toggleMenu, triggerChartUpdate } from "../dropdown_utils.js"

const targetNames = ["menu", "selectedText", "productionTypeSection", "simulationsSection", "electricityMixSection", "tempsSection", "loadSection", "productionTypeOptions", "perUnitSection", "unitOptions", "unitSelectedText", "unitMenu", "transmissionSection", "transmissionOptions", "transmissionSelectedText", "transmissionMenu", "perUnitProductionTypeMenu", "perUnitProductionTypeOptions", "perUnitProductionTypeSelectedText", "multiplierMenu", "multiplierSelectedText", "nuclearInput", "windInput", "solarInput", "demandInput"]

function targetSelector(target) {
  return `#dashboard-options-${kebab(target)}`
}

function targetListSelector(target) {
  return `.dashboard-options-${kebab(target)}`
}

function kebab(value) {
  return value.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
}

export function initDashboardOptions() {
  const root = document.getElementById('topnav-content')
  if (!root) return null
  const module = new DashboardOptions(root)
  module.connect()
  return module
}

class DashboardOptions {
  units = []
  transmissionLines = []

  constructor(element) {
    this.element = element
    for (const target of targetNames) {
      Object.defineProperty(this, `${target}Target`, { get: () => this.element.querySelector(targetSelector(target)) })
      Object.defineProperty(this, `${target}Targets`, { get: () => Array.from(this.element.querySelectorAll(targetListSelector(target))) })
      Object.defineProperty(this, `has${target.charAt(0).toUpperCase() + target.slice(1)}Target`, { get: () => !!this.element.querySelector(targetSelector(target)) || !!this.element.querySelector(targetListSelector(target)) })
    }
  }

  connect() {
    this.updateVisibilityFromRouter()
    this.routerUnsubscribe = router.onChange(() => this.updateVisibilityFromRouter())

    document.addEventListener('production-types-loaded', (event) => {
      this.renderProductionTypes(event.detail.production_types || [])
      this.renderPerUnitProductionTypes(event.detail.production_types || [])
    })

    document.addEventListener('units-loaded', (event) => {
      this.units = event.detail.units || []
      const productionType = this.getSelectedPerUnitProductionType()
      if (productionType && productionType !== 'all') {
        this.renderUnits(this.units.filter(u => u.production_type === productionType))
      } else {
        this.renderUnits(this.units)
      }
    })

    document.addEventListener('transmission-lines-loaded', (event) => {
      this.transmissionLines = event.detail.transmission_lines || []
      this.renderTransmissionLines(this.transmissionLines)
    })

    this.element.addEventListener('click', (event) => this.handleClick(event))
    this.element.addEventListener('change', (event) => this.handleChange(event))

    this.populateMultipliersFromUrl()
  }

  handleClick(event) {
    if (event.target.closest('.production-type-selector > .dropdown-btn')) return this.toggleMenu(event)
    if (event.target.closest('.production-type-selector .action-btn.apply')) return this.applyProductionType(event)
    if (event.target.closest('.multiplier-selector > .dropdown-btn')) return this.toggleMultiplierMenu(event)
    if (event.target.closest('.multiplier-selector .action-btn.apply')) return this.applyMultipliers(event)
    if (event.target.closest('#dashboard-options-transmission-section > .dropdown-btn')) return this.toggleTransmissionMenu(event)
    if (event.target.closest('#dashboard-options-transmission-section .action-btn.apply')) return this.applyTransmission(event)
    if (event.target.closest('#dashboard-options-per-unit-production-type-section > .dropdown-btn')) return this.togglePerUnitProductionTypeMenu(event)
    if (event.target.closest('#dashboard-options-per-unit-production-type-section .action-btn.apply')) return this.applyPerUnitProductionType(event)
    if (event.target.closest('#dashboard-options-unit-section > .dropdown-btn')) return this.toggleUnitMenu(event)
    if (event.target.closest('#dashboard-options-unit-section .action-btn.apply')) return this.applyUnits(event)
  }

  handleChange(event) {
    if (event.target.closest('.production-type-selector .dropdown-checkbox')) return this.toggleProductionType(event)
    if (event.target.closest('#dashboard-options-per-unit-production-type-section .dropdown-checkbox')) return this.togglePerUnitProductionType(event)
    if (event.target.closest('#dashboard-options-unit-section .unit-checkbox')) return this.toggleUnit(event)
    if (event.target.closest('#dashboard-options-transmission-section .dropdown-checkbox')) return this.toggleTransmission(event)
    if (event.target.id === 'topnav-prices-checkbox') return this.togglePrices(event)
    if (event.target.id === 'topnav-temps-checkbox') return this.toggleTemps(event)
    if (event.target.id === 'topnav-load-checkbox') return this.toggleLoad(event)
  }

  populateMultipliersFromUrl() {
    const query = router.getQuery()
    if (this.hasNuclearInputTarget) {
      this.nuclearInputTarget.value = query.nuclear_multiplier || 1.0
    }
    if (this.hasWindInputTarget) {
      this.windInputTarget.value = query.wind_multiplier || 1.0
    }
    if (this.hasSolarInputTarget) {
      this.solarInputTarget.value = query.solar_multiplier || 1.0
    }
    if (this.hasDemandInputTarget) {
      this.demandInputTarget.value = query.demand_multiplier || 1.0
    }
  }

  disconnect() {
    if (this.routerUnsubscribe) {
      this.routerUnsubscribe()
    }
  }

  updateVisibilityFromRouter() {
    const dashboard = router.parsePath()?.dashboard || ''

    const query = router.getQuery()
    
    if (this.hasElectricityMixSectionTarget) {
      const checkbox = this.electricityMixSectionTarget.querySelector('input[type="checkbox"]')
      if (checkbox) {
        checkbox.checked = query.prices === '1'
      }
    }
    
    if (this.hasTempsSectionTarget) {
      const checkbox = this.tempsSectionTarget.querySelector('input[type="checkbox"]')
      if (checkbox) {
        checkbox.checked = query.temps === '1'
      }
    }
    
    if (this.hasLoadSectionTarget) {
      const checkbox = this.loadSectionTarget.querySelector('input[type="checkbox"]')
      if (checkbox) {
        checkbox.checked = query.load === '1'
      }
    }

    this.simulationsSectionTargets.forEach(el => {
      el.style.display = dashboard === 'simulations' ? 'flex' : 'none'
    })
    
    if (dashboard === 'simulations' && !this.multiplierMenuTarget?.classList.contains('open')) {
      this.populateMultipliersFromUrl()
    }
    
    this.updateVisibility()
  }

  updateVisibility() {
    const dashboard = router.parsePath()?.dashboard || ''

    if (this.hasProductionTypeSectionTarget) {
      this.productionTypeSectionTarget.style.display = ['generation', 'generation_min_max', 'generation_total', 'generation_yoy', 'capture_price', 'simulations'].includes(dashboard) ? 'flex' : 'none'
    }
    
    if (this.hasSimulationsSectionTarget) {
      this.simulationsSectionTargets.forEach(el => {
        el.style.display = dashboard === 'simulations' ? 'flex' : 'none'
      })
    }
    
    if (this.hasElectricityMixSectionTarget) {
      this.electricityMixSectionTarget.style.display = ['electricity_mix', 'generation'].includes(dashboard) ? 'flex' : 'none'
    }
    
    if (this.hasTempsSectionTarget) {
      this.tempsSectionTarget.style.display = dashboard === 'generation' ? 'flex' : 'none'
    }
    
    if (this.hasLoadSectionTarget) {
      this.loadSectionTarget.style.display = dashboard === 'generation' ? 'flex' : 'none'
    }
    
    if (this.hasPerUnitSectionTarget) {
      this.perUnitSectionTargets.forEach(el => {
        el.style.display = ['per_unit', 'per_unit_peak', 'per_unit_total', 'per_unit_moving_capacity', 'per_unit_battery'].includes(dashboard) ? 'flex' : 'none'
      })
    }

    if (this.hasTransmissionSectionTarget) {
      this.transmissionSectionTarget.style.display = dashboard === 'transmission' ? 'flex' : 'none'
    }
  }

  renderProductionTypes(productionTypes) {
    if (!this.hasProductionTypeOptionsTarget) return

    const query = router.getQuery()
    const currentTypes = query.production_type ? query.production_type.split(',') : []
    const isAllSelected = currentTypes.length === 0 || currentTypes.includes('all')

    let html = ""
    productionTypes.forEach(type => {
      const isAll = type.value === 'all'
      const shouldBeChecked = isAll ? isAllSelected : (!isAllSelected && currentTypes.includes(type.value))
      html += `
        <div class="dropdown-option">
          <input type="checkbox" class="dropdown-checkbox" id="production-type-${type.value}"
                 value="${type.value}" ${shouldBeChecked ? "checked" : ""}
                >
          <label class="dropdown-label" for="production-type-${type.value}">${type.label}</label>
        </div>
      `
    })

    this.productionTypeOptionsTarget.innerHTML = html
    this.updateUI()
  }

  renderPerUnitProductionTypes(productionTypes) {
    if (!this.hasPerUnitProductionTypeOptionsTarget) return

    const query = router.getQuery()
    const currentType = query.production_type || 'all'

    let html = ""
    productionTypes.forEach(type => {
      const isSelected = type.value === currentType
      html += `
        <div class="dropdown-option">
          <input type="checkbox" class="dropdown-checkbox" id="per-unit-production-type-${type.value}"
                 value="${type.value}" ${isSelected ? "checked" : ""}
                >
          <label class="dropdown-label" for="per-unit-production-type-${type.value}">${type.label}</label>
        </div>
      `
    })

    this.perUnitProductionTypeOptionsTarget.innerHTML = html
    this.updatePerUnitProductionTypeUI()
  }

  renderUnits(units) {
    if (!this.hasUnitOptionsTarget) return

    const query = router.getQuery()
    const selected = (query.units || '').split(',').filter(Boolean)
    const isAllSelected = selected.includes('all')
    const selectedNames = []

    const allCheckbox = this.unitOptionsTarget.querySelector(".unit-checkbox[value='all']")
    if (allCheckbox) allCheckbox.checked = isAllSelected

    let html = ""
    units.forEach(unit => {
      const isSelected = !isAllSelected && selected.includes(String(unit.id))
      if (isSelected) selectedNames.push(unit.name)
      html += `
        <div class="dropdown-option">
          <input type="checkbox" class="dropdown-checkbox unit-checkbox" id="unit-${unit.id}"
                 value="${unit.id}" data-production-type="${unit.production_type}"
                 ${isSelected ? "checked" : ""}
                >
          <label class="dropdown-label" for="unit-${unit.id}">${unit.name} (${unit.area})</label>
        </div>
      `
    })

    const individualUnitsContainer = this.unitOptionsTarget.querySelector('.individual-units')
    if (individualUnitsContainer) {
      individualUnitsContainer.innerHTML = html
    }
    
    if (this.hasUnitSelectedTextTarget) {
      if (isAllSelected || selectedNames.length === 0) {
        this.unitSelectedTextTarget.textContent = 'All units'
      } else {
        this.unitSelectedTextTarget.textContent = selectedNames.length > 3 
          ? `${selectedNames.length} units` 
          : selectedNames.join(', ')
      }
    }
  }

  filterUnitsByProductionType(productionTypes) {
    if (!this.units.length) return
    
    const filtered = productionTypes.includes('all') 
      ? this.units 
      : this.units.filter(u => productionTypes.includes(u.production_type))
    
    this.renderUnits(filtered)
  }

  renderTransmissionLines(transmissionLines) {
    if (!this.hasTransmissionOptionsTarget) return

    const query = router.getQuery()
    const currentId = query.transmission || ''

    let html = ""
    transmissionLines.forEach(line => {
      const isSelected = line.id === currentId
      html += `
        <div class="dropdown-option">
          <input type="checkbox" class="dropdown-checkbox" id="transmission-${line.id}"
                 value="${line.id}" ${isSelected ? "checked" : ""}
                >
          <label class="dropdown-label" for="transmission-${line.id}">${line.label}</label>
        </div>
      `
    })

    this.transmissionOptionsTarget.innerHTML = html
    this.updateTransmissionUI()
  }

  toggleTransmission(event) {
    const checkbox = event.currentTarget
    const id = checkbox.value

    if (checkbox.checked) {
      this.transmissionOptionsTarget.querySelectorAll(".dropdown-checkbox").forEach(cb => {
        if (cb.value !== id) cb.checked = false
      })
    }

    this.updateTransmissionUI()
  }

  updateTransmissionUI() {
    if (!this.hasTransmissionSelectedTextTarget) return
    const lines = this.transmissionLines
    const currentId = router.getQuery().transmission || ''

    if (currentId && lines.length > 0) {
      const selected = lines.find(l => l.id === currentId)
      this.transmissionSelectedTextTarget.textContent = selected ? selected.label : 'Select line'
    } else {
      this.transmissionSelectedTextTarget.textContent = 'Select line'
    }
  }

  applyTransmission() {
    closeAllDropdowns()

    const selectedId = this.getSelectedTransmissionId()
    if (selectedId) {
      router.updateQuery({ transmission: selectedId })
    } else {
      router.updateQuery({ transmission: null })
    }

    triggerChartUpdate()
  }

  getSelectedTransmissionId() {
    const checked = this.transmissionOptionsTarget.querySelector(".dropdown-checkbox:checked")
    return checked ? checked.value : null
  }

  toggleTransmissionMenu(event) {
    toggleMenu(this.transmissionMenuTarget, event.target.closest('#dashboard-options-transmission-section > .dropdown-btn'))
  }

  toggleProductionType(event) {
    const checkbox = event.target.closest('.dropdown-checkbox')

    if (checkbox.value === 'all') {
      if (checkbox.checked) {
        this.productionTypeOptionsTarget.querySelectorAll(".dropdown-checkbox").forEach(cb => {
          if (cb.value !== 'all') cb.checked = false
        })
      }
    } else {
      const allCheckbox = this.productionTypeOptionsTarget.querySelector(".dropdown-checkbox[value='all']")
      if (allCheckbox) allCheckbox.checked = false
    }

    this.updateUI()
  }

  applyProductionType() {
    closeAllDropdowns()

    const selectedTypes = this.getSelectedProductionTypes()
    if (selectedTypes.includes('all') || selectedTypes.length === 0) {
      router.updateQuery({ production_type: null })
    } else {
      router.updateQuery({ production_type: selectedTypes.join(',') })
    }

    triggerChartUpdate()
  }

  getSelectedProductionTypes() {
    const checked = this.productionTypeOptionsTarget.querySelectorAll(".dropdown-checkbox:checked")
    return Array.from(checked).map(cb => cb.value)
  }

  togglePerUnitProductionType(event) {
    const checkbox = event.target.closest('.dropdown-checkbox')

    if (checkbox.checked) {
      this.perUnitProductionTypeOptionsTarget.querySelectorAll(".dropdown-checkbox").forEach(cb => {
        if (cb.value !== checkbox.value) cb.checked = false
      })
    } else {
      const allCheckbox = this.perUnitProductionTypeOptionsTarget.querySelector(".dropdown-checkbox[value='all']")
      if (allCheckbox) allCheckbox.checked = true
    }

    this.updatePerUnitProductionTypeUI()
    this.filterUnitsByProductionType([this.getSelectedPerUnitProductionType()])
  }

  updatePerUnitProductionTypeUI() {
    if (!this.hasPerUnitProductionTypeSelectedTextTarget) return
    const type = this.getSelectedPerUnitProductionType()
    if (type === 'all') {
      this.perUnitProductionTypeSelectedTextTarget.textContent = 'All'
    } else {
      this.perUnitProductionTypeSelectedTextTarget.textContent = type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    }
  }

  getSelectedPerUnitProductionType() {
    const checked = this.perUnitProductionTypeOptionsTarget.querySelector(".dropdown-checkbox:checked")
    return checked ? checked.value : 'all'
  }

  togglePerUnitProductionTypeMenu(event) {
    toggleMenu(this.perUnitProductionTypeMenuTarget, event.target.closest('#dashboard-options-per-unit-production-type-section > .dropdown-btn'))
  }

  applyPerUnitProductionType() {
    closeAllDropdowns()

    const type = this.getSelectedPerUnitProductionType()
    if (type && type !== 'all') {
      router.updateQuery({ production_type: type })
    } else {
      router.updateQuery({ production_type: null })
    }

    triggerChartUpdate()
  }

  toggleUnit(event) {
    const checkbox = event.currentTarget
    const value = checkbox.value

    if (value === 'all') {
      if (checkbox.checked) {
        this.unitOptionsTarget.querySelectorAll(".unit-checkbox").forEach(cb => {
          if (cb.value !== 'all') cb.checked = false
        })
      }
    } else if (checkbox.checked) {
      const allCheckbox = this.unitOptionsTarget.querySelector(".unit-checkbox[value='all']")
      if (allCheckbox) allCheckbox.checked = false
    }
  }

  applyUnits() {
    closeAllDropdowns()

    const selected = this.getSelectedUnits()
    if (selected.includes('all') || selected.length === 0) {
      const allCheckbox = this.unitOptionsTarget.querySelector(".unit-checkbox[value='all']")
      if (allCheckbox) allCheckbox.checked = true
      this.unitOptionsTarget.querySelectorAll(".unit-checkbox:checked").forEach(cb => {
        if (cb.value !== 'all') cb.checked = false
      })
      router.updateQuery({ units: null })
    } else {
      router.updateQuery({ units: selected.sort((a, b) => a - b).join(',') })
    }

    triggerChartUpdate()
  }


  getSelectedUnits() {
    const allCheckbox = this.unitOptionsTarget.querySelector(".unit-checkbox[value='all']")
    if (allCheckbox?.checked) return ['all']
    
    const ids = []
    this.unitOptionsTarget.querySelectorAll(".unit-checkbox:checked").forEach(cb => {
      ids.push(parseInt(cb.value))
    })
    return ids
  }

  toggleUnitMenu(event) {
    toggleMenu(this.unitMenuTarget, event.target.closest('#dashboard-options-unit-section > .dropdown-btn'))
  }

  updateUI() {
    if (!this.hasSelectedTextTarget) return
    const types = this.getSelectedProductionTypes()
    
    if (types.includes('all') || types.length === 0) {
      this.selectedTextTarget.textContent = 'All'
    } else if (types.length === 1) {
      this.selectedTextTarget.textContent = types[0].replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    } else {
      this.selectedTextTarget.textContent = `${types.length} types`
    }
  }

  toggleMenu(event) {
    toggleMenu(this.menuTarget, event.target.closest('.production-type-selector > .dropdown-btn'))
  }

  toggleMultiplierMenu(event) {
    toggleMenu(this.multiplierMenuTarget, event.target.closest('.multiplier-selector > .dropdown-btn'))
  }

  applyMultipliers() {
    closeAllDropdowns()

    const nuclear = parseFloat(this.nuclearInputTarget?.value) || 1.0
    const wind = parseFloat(this.windInputTarget?.value) || 1.0
    const solar = parseFloat(this.solarInputTarget?.value) || 1.0
    const demand = parseFloat(this.demandInputTarget?.value) || 1.0

    router.updateQuery({
      nuclear_multiplier: nuclear === 1.0 ? null : nuclear.toString(),
      wind_multiplier: wind === 1.0 ? null : wind.toString(),
      solar_multiplier: solar === 1.0 ? null : solar.toString(),
      demand_multiplier: demand === 1.0 ? null : demand.toString()
    })

    triggerChartUpdate()
  }

  togglePrices(event) {
    router.updateQuery({ prices: event.target.checked ? '1' : null })
    triggerChartUpdate()
  }

  toggleTemps(event) {
    router.updateQuery({ temps: event.target.checked ? '1' : null })
    triggerChartUpdate()
  }

  toggleLoad(event) {
    router.updateQuery({ load: event.target.checked ? '1' : null })
    triggerChartUpdate()
  }
}
