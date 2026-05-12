import { Controller } from "@hotwired/stimulus"
import { router, onChange, parsePath } from "../router.js"
import { closeAllDropdowns, toggleMenu, triggerChartUpdate } from "../dropdown_utils.js"

export default class extends Controller {
  static targets = ["menu", "selectionText", "areaTypeTitle", "areaTitle",
                    "areaTypeOptions", "areaOptions"]

  static values = {
    areasData: { type: Object, default: {} }
  }

  region = null
  areaType = null
  urlAreas = []

  areaTypeMap = {}
  areaMap = {}

  connect() {
    this.initializeAreaMaps()
    this.initializeFromUrl()
    this.updateRegionOptions()
    this.updateAreaTypeOptions()
    this.updateAreaOptions()
    this.updateSelectionText()

    this.routerUnsubscribe = onChange(({ params }) => {
      if (params?.region) {
        this.region = params.region
      }
      if (params?.areaType) {
        this.areaType = params.areaType
      }
      if (params?.area) {
        this.urlAreas = params.area.split(',').filter(a => a)
      }
      this.updateRegionOptions()
      this.updateAreaTypeOptions()
      this.updateAreaOptions()
      this.updateSelectionText()
    })
  }

  disconnect() {
    if (this.routerUnsubscribe) {
      this.routerUnsubscribe()
    }
  }

  initializeFromUrl() {
    const urlParams = parsePath()
    if (!urlParams) return

    this.region = urlParams.region
    this.areaType = urlParams.areaType
    this.urlAreas = urlParams.area ? urlParams.area.split(',').filter(a => a) : []
  }
  
  initializeAreaMaps() {
    let areasData = this.areasDataValue

    if (!areasData || Object.keys(areasData).length === 0) {
      const rawData = this.element.getAttribute('data-topnav-area-areas-data-value')
      if (rawData && rawData.trim().startsWith('{')) {
        try {
          areasData = JSON.parse(rawData)
        } catch (e) {
          console.error('Failed to parse areas data:', e)
          areasData = null
        }
      }
    }

    if (!areasData || Object.keys(areasData).length === 0) {
      console.warn('No areas data available')
      this.areaTypeMap = {}
      this.areaMap = {}
      return
    }
    
    for (const region of Object.keys(areasData)) {
      if (!areasData[region]) continue
      const areaTypes = Object.keys(areasData[region])
      this.areaTypeMap[region] = areaTypes.map(type => ({
        value: type,
        label: this.titleize(type.replace(/_/g, ' '))
      }))
    }
    
    this.areaMap = areasData
    
    if (!this.areaTypeMap.default) {
      this.areaTypeMap.default = [
        { value: "country", label: "Country" }
      ]
    }
    
    if (!this.areaMap.default) {
      this.areaMap.default = {
        country: []
      }
    }
  }
  
  titleize(str) {
    return str.replace(/\b\w/g, l => l.toUpperCase())
  }
  
  toggleMenu() {
    const button = this.element.querySelector(".location-selector-btn")
    toggleMenu(this.menuTarget, button)
  }
  
  closeMenu() {
    closeAllDropdowns()
  }

  selectRegion(event) {
    const region = event.currentTarget.dataset.region
    this.region = region
    this.areaType = null

    document.querySelectorAll(".step-option[data-region]").forEach(btn => {
      btn.classList.toggle("selected", btn.dataset.region === region)
    })

    this.hideStepsAfter("region")
    this.showStep("areaType")
    this.updateAreaTypeOptions()
  }

  selectAreaType(event) {
    const areaType = event.currentTarget.dataset.areaType
    this.areaType = areaType

    document.querySelectorAll(".step-option[data-area-type]").forEach(btn => {
      btn.classList.toggle("selected", btn.dataset.areaType === areaType)
    })

    this.hideStepsAfter("areaType")
    this.showStep("areas")

    this.updateAreaOptions()
  }

  toggleArea(event) {
    const checkbox = event.currentTarget
    const area = checkbox.value
    const allCheckbox = this.areaOptionsTarget.querySelector(".dropdown-checkbox[value='all']")

    if (area === 'all') {
      if (checkbox.checked) {
        this.areaOptionsTarget.querySelectorAll(".dropdown-checkbox").forEach(cb => {
          if (cb.value !== 'all') cb.checked = false
        })
      }
    } else if (checkbox.checked && allCheckbox) {
      allCheckbox.checked = false
    }
  }

  applySelection() {
    const areas = this.getSelectedAreas()
    if (areas.length === 0) {
      const allCheckbox = this.areaOptionsTarget.querySelector(".dropdown-checkbox[value='all']")
      if (allCheckbox) allCheckbox.checked = true
      areas.push('all')
    }
    this.urlAreas = areas
    this.updateSelectionText()
    this.closeMenu()
    this._updateUrl()
    triggerChartUpdate()
  }

  getSelectedAreas() {
    const allCheckbox = this.areaOptionsTarget.querySelector(".dropdown-checkbox[value='all']")
    if (allCheckbox?.checked) return ['all']
    
    const areas = []
    this.areaOptionsTarget.querySelectorAll(".dropdown-checkbox:checked").forEach(cb => {
      areas.push(cb.value)
    })
    return areas
  }

  _updateUrl() {
    router.updatePath({
      region: this.region,
      areaType: this.areaType,
      area: this.urlAreas.join(',')
    })
  }
   
  backToStep(event) {
    const visibleSteps = this.menuTarget.querySelectorAll(".location-step.visible")
    const lastVisibleStep = visibleSteps[visibleSteps.length - 1]
    const currentStepName = lastVisibleStep?.dataset.step

    if (currentStepName === "areaType") {
      this.hideStepsAfter("region")
      this.showStep("region")
    } else if (currentStepName === "areas") {
      this.hideStepsAfter("areaType")
      this.showStep("areaType")
    }
  }

  showStep(stepName) {
    const step = this.menuTarget.querySelector(`[data-step="${stepName}"]`)
    if (step) {
      step.classList.add("visible")
    }
  }
  
  hideStepsAfter(stepName) {
    const stepOrder = ["region", "areaType", "areas"]
    const stepIndex = stepOrder.indexOf(stepName)
    
    stepOrder.slice(stepIndex + 1).forEach(stepToHide => {
      const step = this.menuTarget.querySelector(`[data-step="${stepToHide}"]`)
      if (step) {
        step.classList.remove("visible")
      }
    })
  }
  
  updateRegionOptions() {
    document.querySelectorAll(".step-option[data-region]").forEach(btn => {
      btn.classList.toggle("selected", btn.dataset.region === this.region)
    })
  }
  
  updateAreaTypeOptions() {
    const areaTypes = this.getAreaTypesForRegion(this.region)
    this.areaTypeTitleTarget.textContent = this.capitalize(this.region)
    
    let html = ""
    areaTypes.forEach(type => {
      const isSelected = type.value === this.areaType
      html += `
        <button type="button" class="step-option ${isSelected ? "selected" : ""}" 
                data-area-type="${type.value}" data-action="topnav-area#selectAreaType">
          <span class="option-text">${type.label}</span>
          <span class="option-arrow">→</span>
        </button>
      `
    })
    
    this.areaTypeOptionsTarget.innerHTML = html
  }
  
  updateAreaOptions() {
    const areas = this.getAreasForRegionAndType(this.region, this.areaType)
    this.areaTitleTarget.textContent = this.capitalize(this.getAreaTypeLabel(this.areaType))

    const selected = this.urlAreas
    const isAllSelected = selected.includes('all')

    const allCheckbox = this.areaOptionsTarget.querySelector(".dropdown-checkbox[value='all']")
    if (allCheckbox) allCheckbox.checked = isAllSelected

    let html = ""
    areas.forEach(area => {
      const isSelected = !isAllSelected && selected.includes(area.code)
      html += `
        <div class="dropdown-option">
          <input type="checkbox" class="dropdown-checkbox" id="area-${area.code}"
                 value="${area.code}" ${isSelected ? "checked" : ""}
                 data-action="change->topnav-area#toggleArea">
          <label class="dropdown-label" for="area-${area.code}">${area.label}</label>
        </div>
      `
    })

    const individualAreasContainer = this.areaOptionsTarget.querySelector('.individual-areas')
    if (individualAreasContainer) {
      individualAreasContainer.innerHTML = html
    }
  }
  
  updateSelectionText() {
    const regionLabel = this.capitalize(this.region)
    const areaTypeLabel = this.getAreaTypeLabel(this.areaType)
    const selected = this.urlAreas

    let areasText = "All areas"
    if (!selected.includes('all')) {
      areasText = selected.join(", ")
    }

    this.selectionTextTarget.textContent = `${regionLabel} • ${areasText}`
  }
  
  getAreaTypesForRegion(region) {
    return this.areaTypeMap[region] || this.areaTypeMap.default || []
  }
  
  getAreasForRegionAndType(region, areaType) {
    const regionData = this.areaMap[region] || this.areaMap.default || {}
    return regionData[areaType] || []
  }
  
  getAreaTypeLabel(areaType) {
    const areaTypes = this.getAreaTypesForRegion(this.region)
    const found = areaTypes.find(t => t.value === areaType)
    return found ? found.label.toLowerCase() : areaType
  }
  
  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }
}
