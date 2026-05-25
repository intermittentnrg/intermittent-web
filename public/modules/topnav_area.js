import { router, onChange, parsePath } from "../router.js"
import { closeAllDropdowns, toggleMenu } from "../dropdown_utils.js"

export function initTopnavArea() {
  const root = document.getElementById('topnav-area')
  if (!root) return

  const menu = root.querySelector('.area-menu')
  const selectorButton = root.querySelector('.location-selector-btn')
  const selectionText = root.querySelector('.location-selector-btn .dropdown-value')
  const tree = root.querySelector('[data-area-tree]')

  let region = null
  let areaType = null
  let urlAreas = []

  function directChildNodes(parent, selector) {
    return Array.from(parent.children).filter(child => child.matches(selector))
  }

  function topLevelRegionNodes() {
    return directChildNodes(tree, '.area-node[data-node-type="region"]')
  }

  function areaTypeNodesForRegion(regionNode) {
    const childTree = regionNode?.querySelector(':scope > .child-tree')
    return childTree ? directChildNodes(childTree, '.area-node[data-node-type="area-type"]') : []
  }

  function findRegionNode(regionName = region) {
    return topLevelRegionNodes().find(node => node.dataset.region === regionName) || null
  }

  function findAreaTypeNode(regionName = region, type = areaType) {
    const regionNode = findRegionNode(regionName)
    return areaTypeNodesForRegion(regionNode).find(node => node.dataset.areaType === type) || null
  }

  function setNodeOpen(node, open) {
    if (!node) return
    node.classList.toggle('is-open', open)
    const button = node.querySelector(':scope > .area-node-button')
    if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false')
  }

  function selectRegion(selectedRegion) {
    region = selectedRegion
    const selectedRegionNode = findRegionNode()
    const areaTypeNodes = areaTypeNodesForRegion(selectedRegionNode)
    areaType = areaTypeNodes.length === 1 ? areaTypeNodes[0].dataset.areaType : null
    urlAreas = ['all']

    topLevelRegionNodes().forEach(node => {
      const selected = node.dataset.region === region
      node.classList.toggle('is-selected', selected)
      setNodeOpen(node, selected)
      areaTypeNodesForRegion(node).forEach(typeNode => {
        const typeSelected = selected && typeNode.dataset.areaType === areaType
        typeNode.classList.toggle('is-selected', typeSelected)
        setNodeOpen(typeNode, typeSelected)
      })
    })

    if (areaType) setCheckedAreas(urlAreas)
  }

  function selectAreaType(selectedAreaType) {
    areaType = selectedAreaType
    urlAreas = ['all']

    const regionNode = findRegionNode()
    areaTypeNodesForRegion(regionNode).forEach(node => {
      const selected = node.dataset.areaType === areaType
      node.classList.toggle('is-selected', selected)
      setNodeOpen(node, selected)
    })

    setCheckedAreas(urlAreas)
  }

  function toggleArea(checkbox) {
    const areaTypeNode = checkbox.closest('.area-node[data-node-type="area-type"]')
    if (!areaTypeNode) return

    const allCheckbox = areaTypeNode.querySelector('.dropdown-checkbox[value="all"]')
    if (checkbox.value === 'all') {
      if (checkbox.checked) {
        areaTypeNode.querySelectorAll('.dropdown-checkbox').forEach(cb => {
          if (cb !== checkbox) cb.checked = false
        })
      }
    } else if (checkbox.checked && allCheckbox) {
      allCheckbox.checked = false
    }
  }

  function getSelectedAreas() {
    const areaTypeNode = findAreaTypeNode()
    if (!areaTypeNode) return ['all']

    const allCheckbox = areaTypeNode.querySelector('.dropdown-checkbox[value="all"]')
    if (allCheckbox?.checked) return ['all']

    return Array.from(areaTypeNode.querySelectorAll('.dropdown-checkbox:checked'))
      .map(cb => cb.value)
      .filter(Boolean)
  }

  function setCheckedAreas(areas = urlAreas) {
    root.querySelectorAll('.dropdown-checkbox').forEach(cb => { cb.checked = false })

    const areaTypeNode = findAreaTypeNode()
    if (!areaTypeNode) return

    const selected = areas.length ? areas : ['all']
    if (selected.includes('all')) {
      const allCheckbox = areaTypeNode.querySelector('.dropdown-checkbox[value="all"]')
      if (allCheckbox) allCheckbox.checked = true
      return
    }

    areaTypeNode.querySelectorAll('.dropdown-checkbox').forEach(cb => {
      cb.checked = selected.includes(cb.value)
    })
  }

  function applySelection() {
    if (!region) region = topLevelRegionNodes()[0]?.dataset.region || 'default'
    if (!areaType) areaType = areaTypeNodesForRegion(findRegionNode())[0]?.dataset.areaType || 'country'

    const areas = getSelectedAreas()
    urlAreas = areas.length ? areas : ['all']
    setCheckedAreas(urlAreas)
    updateSelectionText()
    closeAllDropdowns()
    router.updatePath({ region, areaType, area: urlAreas.join(',') })
  }

  function syncOpenState() {
    topLevelRegionNodes().forEach(regionNode => {
      const regionSelected = regionNode.dataset.region === region
      regionNode.classList.toggle('is-selected', regionSelected)
      setNodeOpen(regionNode, regionSelected)

      areaTypeNodesForRegion(regionNode).forEach(typeNode => {
        const typeSelected = regionSelected && typeNode.dataset.areaType === areaType
        typeNode.classList.toggle('is-selected', typeSelected)
        setNodeOpen(typeNode, typeSelected)
      })
    })

    setCheckedAreas(urlAreas)
  }

  function updateSelectionText() {
    const regionLabel = findRegionNode()?.querySelector(':scope > .area-node-button .option-text')?.textContent?.trim() || region || ''
    const selected = urlAreas.length ? urlAreas : ['all']
    const areasText = selected.includes('all') ? 'All areas' : selected.join(', ')
    selectionText.textContent = `${regionLabel} • ${areasText}`
  }

  root.addEventListener('click', event => {
    if (event.target.closest('.location-selector-btn')) return toggleMenu(menu, selectorButton)
    if (event.target.closest('.step-close')) return closeAllDropdowns()

    const regionButton = event.target.closest('.area-node[data-node-type="region"] > .area-node-button')
    if (regionButton) return selectRegion(regionButton.closest('.area-node').dataset.region)

    const areaTypeButton = event.target.closest('.area-node[data-node-type="area-type"] > .area-node-button')
    if (areaTypeButton) return selectAreaType(areaTypeButton.closest('.area-node').dataset.areaType)

    if (event.target.closest('.action-btn.apply')) return applySelection()
  })

  root.addEventListener('change', event => {
    const checkbox = event.target.closest('.dropdown-checkbox')
    if (checkbox) toggleArea(checkbox)
  })

  function syncFromUrl({ params } = {}) {
    if (params?.region) region = params.region
    if (params?.areaType) areaType = params.areaType
    if (params?.area) urlAreas = params.area.split(',').filter(Boolean)

    if (!findRegionNode() && topLevelRegionNodes()[0]) region = topLevelRegionNodes()[0].dataset.region
    const areaTypeNodes = areaTypeNodesForRegion(findRegionNode())
    if (!findAreaTypeNode()) areaType = areaTypeNodes.length === 1 ? areaTypeNodes[0]?.dataset.areaType : areaType

    syncOpenState()
    updateSelectionText()
  }

  syncFromUrl({ params: parsePath() })
  onChange(syncFromUrl)

}
