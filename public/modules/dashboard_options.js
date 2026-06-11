import { router } from "../router.js"
import { closeAllDropdowns, toggleMenu } from "../dropdown_utils.js"
import { dashboardHasFeature } from "../../src/shared/dashboardCatalog.js"

const targetNames = ["productionTypeMenu", "productionTypeSelectedText", "productionTypeSection", "productionTypeGroupSection", "productionTypeGroupOptions", "productionTypeGroupSelectedText", "productionTypeGroupMenu", "simulationSection", "electricityMixSection", "tempsSection", "loadSection", "transmissionCheckboxSection", "productionTypeOptions", "unitSection", "unitOptions", "unitSelectedText", "unitMenu", "transmissionSection", "transmissionOptions", "transmissionSelectedText", "transmissionMenu", "multiplierMenu", "multiplierSelectedText", "nuclearInput", "windInput", "solarInput", "demandInput"]

function targetSelector(target) {
  return `.dashboard-options-${kebab(target)}`
}

function targetListSelector(target) {
  return `.dashboard-options-${kebab(target)}`
}

function kebab(value) {
  return value.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
}

function renderMultiSelectOptions(container, options, { idPrefix, selected = [], checkboxClass = 'dropdown__checkbox', label = option => option.label, value = option => option.value }) {
  const selectedValues = selected.filter(Boolean).filter(v => v !== 'all')
  const allSelected = selectedValues.length === 0
  const regularOptions = options.filter(option => String(value(option)) !== 'all')
  const optionHtml = (optionValue, optionLabel, checked) => `
    <label class="dropdown__option${checked ? ' selected' : ''}">
      <input type="checkbox" class="${checkboxClass}" value="${optionValue}" ${checked ? 'checked' : ''}>
      <span class="dropdown__label">${optionLabel}</span>
    </label>
  `

  container.innerHTML = [
    optionHtml('all', 'All', allSelected),
    ...regularOptions.map(option => {
      const optionValue = String(value(option))
      return optionHtml(optionValue, label(option), !allSelected && selectedValues.includes(optionValue))
    }),
  ].join('')
}

function checkedValues(container, selector = '.dropdown__checkbox:checked') {
  return Array.from(container.querySelectorAll(selector)).map(cb => cb.value)
}

function updateAllCheckboxSelection(container, checkbox, selector = '.dropdown__checkbox') {
  if (checkbox.value === 'all') {
    if (checkbox.checked) {
      container.querySelectorAll(selector).forEach(cb => {
        if (cb.value !== 'all') cb.checked = false
      })
    }
  } else if (checkbox.checked) {
    const allCheckbox = container.querySelector(`${selector}[value='all']`)
    if (allCheckbox) allCheckbox.checked = false
  }
}

function updateMultiSelectQuery(container, queryParam, selector = '.dropdown__checkbox:checked') {
  const selected = checkedValues(container, selector).filter(value => value !== 'all')
  router.updateQuery({ [queryParam]: selected.length ? selected.join(',') : null })
}

function syncCheckboxesFromQuery(container, queryParam, { selector = '.dropdown__checkbox', defaultToAll = false } = {}) {
  if (!container) return
  const selected = (router.getQuery()[queryParam] || '').split(',').filter(Boolean)
  const allSelected = defaultToAll && selected.length === 0

  container.querySelectorAll(selector).forEach(cb => {
    cb.checked = cb.value === 'all' ? allSelected : selected.includes(cb.value)
    const option = cb.closest('.dropdown__option')
    if (option) option.classList.toggle('dropdown__option--selected', cb.checked)
  })
}

function titleize(value) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

export function initDashboardOptions() {
  const root = document.getElementById('topnav-content')
  if (!root) return null
  const instance = new DashboardOptions(root)
  instance.init()
  return instance
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

  init() {
    this.updateVisibility()
    router.onChange(() => this.updateVisibilityFromRouter())

    this.element.addEventListener('click', (event) => this.handleClick(event))

    ;['productionTypeOptions', 'productionTypeGroupOptions', 'unitOptions', 'transmissionOptions'].forEach(key => {
      this[`${key}Target`]?.addEventListener('change', (event) => this.toggleMultiSelectCheckbox(event))
    })

    document.getElementById('topnav-prices-checkbox')?.addEventListener('change', (event) => this.togglePrices(event))
    document.getElementById('topnav-temps-checkbox')?.addEventListener('change', (event) => this.toggleTemps(event))
    document.getElementById('topnav-load-checkbox')?.addEventListener('change', (event) => this.toggleLoad(event))
    document.getElementById('topnav-transmission-checkbox')?.addEventListener('change', (event) => this.toggleTransmission(event))

    this.populateMultipliersFromUrl()
  }

  handleClick(event) {
    if (event.target.closest('.production-type-selector > .dropdown__trigger')) return this.toggleSectionMenu(event, this.productionTypeMenuTarget)
    if (event.target.closest('.production-type-selector .dropdown__apply')) return this.applyProductionType(event)
    if (event.target.closest('.multiplier-selector > .dropdown__trigger')) return this.toggleSectionMenu(event, this.multiplierMenuTarget)
    if (event.target.closest('.multiplier-selector .dropdown__apply')) return this.applyMultipliers(event)
    if (event.target.closest('.production-type-group-selector > .dropdown__trigger')) return this.toggleSectionMenu(event, this.productionTypeGroupMenuTarget)
    if (event.target.closest('.production-type-group-selector .dropdown__apply')) return this.applyProductionTypeGroup(event)
    if (event.target.closest('.transmission-selector > .dropdown__trigger')) return this.toggleSectionMenu(event, this.transmissionMenuTarget)
    if (event.target.closest('.transmission-selector .dropdown__apply')) return this.applyTransmission(event)
    if (event.target.closest('.unit-selector > .dropdown__trigger')) return this.toggleSectionMenu(event, this.unitMenuTarget)
    if (event.target.closest('.unit-selector .dropdown__apply')) return this.applyUnits(event)
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

    if (this.hasTransmissionCheckboxSectionTarget) {
      const checkbox = this.transmissionCheckboxSectionTarget.querySelector('input[type="checkbox"]')
      if (checkbox) {
        checkbox.checked = query.transmission !== '0'
      }
    }

    this.simulationSectionTargets.forEach(el => {
      el.style.display = dashboard === 'simulation' ? 'flex' : 'none'
    })
    
    if (dashboard === 'simulation' && !this.multiplierMenuTarget?.classList.contains('open')) {
      this.populateMultipliersFromUrl()
    }

    syncCheckboxesFromQuery(this.productionTypeOptionsTarget, 'production_type', { defaultToAll: true })
    syncCheckboxesFromQuery(this.productionTypeGroupOptionsTarget, 'production_type_group', { defaultToAll: true })
    syncCheckboxesFromQuery(this.transmissionOptionsTarget, 'transmission')
    syncCheckboxesFromQuery(this.unitOptionsTarget, 'units', { selector: '.unit-checkbox', defaultToAll: true })
    this.updateUI()
    this.updateProductionTypeGroupUI()
    this.updateTransmissionUI()
    this.filterUnitsByProductionType(this.getSelectedProductionTypes())
    
    this.updateVisibility()
  }

  updateVisibility() {
    const dashboard = router.parsePath()?.dashboard || ''

    if (this.hasProductionTypeSectionTarget) {
      this.productionTypeSectionTarget.style.display = dashboardHasFeature(dashboard, 'production_type_selector') ? 'flex' : 'none'
    }
    
    if (this.hasProductionTypeGroupSectionTarget) {
      this.productionTypeGroupSectionTarget.style.display = dashboardHasFeature(dashboard, 'production_type_group_selector') ? 'flex' : 'none'
    }
    
    if (this.hasSimulationSectionTarget) {
      this.simulationSectionTargets.forEach(el => {
        el.style.display = dashboardHasFeature(dashboard, 'simulation_multipliers') ? 'flex' : 'none'
      })
    }
    
    if (this.hasElectricityMixSectionTarget) {
      this.electricityMixSectionTarget.style.display = dashboardHasFeature(dashboard, 'prices_checkbox') ? 'flex' : 'none'
    }
    
    if (this.hasTempsSectionTarget) {
      this.tempsSectionTarget.style.display = dashboardHasFeature(dashboard, 'temps_checkbox') ? 'flex' : 'none'
    }
    
    if (this.hasLoadSectionTarget) {
      this.loadSectionTarget.style.display = dashboardHasFeature(dashboard, 'load_checkbox') ? 'flex' : 'none'
    }

    if (this.hasTransmissionCheckboxSectionTarget) {
      this.transmissionCheckboxSectionTarget.style.display = dashboardHasFeature(dashboard, 'transmission_checkbox') ? 'flex' : 'none'
    }

    if (this.hasUnitSectionTarget) {
      this.unitSectionTargets.forEach(el => {
        el.style.display = dashboardHasFeature(dashboard, 'per_unit_selector') ? 'flex' : 'none'
      })
    }

    if (this.hasTransmissionSectionTarget) {
      this.transmissionSectionTarget.style.display = dashboardHasFeature(dashboard, 'transmission_selector') ? 'flex' : 'none'
    }
  }

  renderProductionTypeGroups(groups) {
    if (!this.hasProductionTypeGroupOptionsTarget) return

    const query = router.getQuery()
    const currentGroups = query.production_type_group ? query.production_type_group.split(',') : []

    renderMultiSelectOptions(this.productionTypeGroupOptionsTarget, groups, {
      idPrefix: 'production-type-group',
      selected: currentGroups,
    })
    this.updateProductionTypeGroupUI()
  }

  renderProductionTypes(productionTypes) {
    if (!this.hasProductionTypeOptionsTarget) return

    const query = router.getQuery()
    const currentTypes = query.production_type ? query.production_type.split(',') : []

    renderMultiSelectOptions(this.productionTypeOptionsTarget, productionTypes, {
      idPrefix: 'production-type',
      selected: currentTypes,
    })
    this.updateUI()
  }

  renderUnits(units) {
    if (!this.hasUnitOptionsTarget) return

    const query = router.getQuery()
    const selected = (query.units || '').split(',').filter(Boolean)
    const isAllSelected = selected.length === 0
    const selectedNames = []

    units.forEach(unit => {
      if (!isAllSelected && selected.includes(String(unit.id))) selectedNames.push(unit.name)
    })

    renderMultiSelectOptions(this.unitOptionsTarget, units, {
      idPrefix: 'unit',
      selected,
      checkboxClass: 'dropdown__checkbox unit-checkbox',
      value: unit => unit.id,
      label: unit => `${unit.name} (${unit.area})`,
    })
    
    if (this.hasUnitSelectedTextTarget) {
      if (isAllSelected || selectedNames.length === 0) {
        this.unitSelectedTextTarget.textContent = 'All'
      } else {
        this.unitSelectedTextTarget.textContent = selectedNames.length > 3 
          ? `${selectedNames.length} units` 
          : selectedNames.join(', ')
      }
    }
  }

  filterUnitsByProductionType(productionTypes) {
    if (!this.units.length) return
    
    const selected = productionTypes.filter(type => type !== 'all')
    const filtered = selected.length === 0
      ? this.units
      : this.units.filter(u => selected.includes(u.production_type))
    
    this.renderUnits(filtered)
  }

  renderTransmissionLines(transmissionLines) {
    if (!this.hasTransmissionOptionsTarget) return

    const query = router.getQuery()
    const selected = (query.transmission_lines || '').split(',').filter(Boolean)

    renderMultiSelectOptions(this.transmissionOptionsTarget, transmissionLines, {
      idPrefix: 'transmission',
      selected,
      value: line => line.id,
    })
    this.updateTransmissionUI()
  }

  toggleMultiSelectCheckbox(event) {
    const checkbox = event.target.closest('.dropdown__checkbox')
    if (!checkbox) return
    const container = checkbox.closest('.dropdown__content')

    updateAllCheckboxSelection(container, checkbox, checkbox.classList.contains('unit-checkbox') ? '.unit-checkbox' : '.dropdown__checkbox')

    container.querySelectorAll('.dropdown__checkbox').forEach(cb => {
      const option = cb.closest('.dropdown__option')
      if (option) option.classList.toggle('dropdown__option--selected', cb.checked)
    })

    if (container === this.productionTypeOptionsTarget) this.updateUI()
    if (container === this.productionTypeGroupOptionsTarget) this.updateProductionTypeGroupUI()
    if (container === this.transmissionOptionsTarget) this.updateTransmissionUI()
  }

  updateTransmissionUI() {
    if (!this.hasTransmissionSelectedTextTarget) return
    const selected = this.getSelectedTransmissions()

    const selectedLines = selected.filter(value => value !== 'all')

    if (selectedLines.length === 0) {
      this.transmissionSelectedTextTarget.textContent = 'All'
    } else if (selectedLines.length === 1) {
      const line = this.transmissionLines.find(l => l.id === selectedLines[0])
      this.transmissionSelectedTextTarget.textContent = line ? line.label : '1 line'
    } else {
      this.transmissionSelectedTextTarget.textContent = `${selectedLines.length} lines`
    }
  }

  applyTransmission() {
    closeAllDropdowns()
    updateMultiSelectQuery(this.transmissionOptionsTarget, 'transmission_lines')
  }

  getSelectedTransmissions() {
    return checkedValues(this.transmissionOptionsTarget)
  }

  loadUnits(units) {
    this.units = units || []
    this.filterUnitsByProductionType(this.getSelectedProductionTypes())
  }

  loadTransmissionLines(lines) {
    this.transmissionLines = lines || []
    this.renderTransmissionLines(this.transmissionLines)
  }

  applyProductionType() {
    closeAllDropdowns()
    updateMultiSelectQuery(this.productionTypeOptionsTarget, 'production_type')
  }

  getSelectedProductionTypes() {
    return this.hasProductionTypeOptionsTarget ? checkedValues(this.productionTypeOptionsTarget) : []
  }

  applyProductionTypeGroup() {
    closeAllDropdowns()
    updateMultiSelectQuery(this.productionTypeGroupOptionsTarget, 'production_type_group')
  }

  updateProductionTypeGroupUI() {
    if (!this.hasProductionTypeGroupSelectedTextTarget) return
    const selected = checkedValues(this.productionTypeGroupOptionsTarget).filter(v => v !== 'all')
    if (selected.length === 0) {
      this.productionTypeGroupSelectedTextTarget.textContent = 'All'
    } else if (selected.length === 1) {
      this.productionTypeGroupSelectedTextTarget.textContent = titleize(selected[0])
    } else {
      this.productionTypeGroupSelectedTextTarget.textContent = `${selected.length} groups`
    }
  }

  applyUnits() {
    closeAllDropdowns()
    updateMultiSelectQuery(this.unitOptionsTarget, 'units', '.unit-checkbox:checked')
  }

  updateUI() {
    if (!this.hasProductionTypeSelectedTextTarget) return
    const types = this.getSelectedProductionTypes()
    
    if (types.length === 0 || types.includes('all')) {
      this.productionTypeSelectedTextTarget.textContent = 'All'
    } else if (types.length === 1) {
      this.productionTypeSelectedTextTarget.textContent = titleize(types[0])
    } else {
      this.productionTypeSelectedTextTarget.textContent = `${types.length} types`
    }
  }

  toggleSectionMenu(event, menuTarget) {
    toggleMenu(menuTarget, event.target.closest('.dropdown__trigger'))
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

  }

  togglePrices(event) {
    router.updateQuery({ prices: event.target.checked ? '1' : null })
  }

  toggleTemps(event) {
    router.updateQuery({ temps: event.target.checked ? '1' : null })
  }

  toggleLoad(event) {
    router.updateQuery({ load: event.target.checked ? '1' : null })
  }

  toggleTransmission(event) {
    router.updateQuery({ transmission: event.target.checked ? null : '0' })
  }
}
