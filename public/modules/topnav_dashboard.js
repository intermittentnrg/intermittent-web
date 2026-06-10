import { router } from "../router.js"
import { closeAllDropdowns } from "../dropdown_utils.js"
import { dashboardTabGroups } from "../../src/shared/dashboardCatalog.js"

/**
 * Attach and populate the dropdown inside each .dashboard-tab-group.
 * The tab buttons are server-rendered; the dropdown container and its items
 * are created by JS from the shared data structure.
 */
function populateDropdowns() {
  const groups = document.querySelectorAll('#topnav-dashboard .dashboard-tab-group')

  for (const groupEl of groups) {
    const trigger = groupEl.querySelector('.dashboard-tab')
    if (!trigger) continue

    const key = trigger.getAttribute('href')
    const groupData = dashboardTabGroups.find(g => g.items[0]?.key === key)
    if (!groupData) continue

    // Only attach the dropdown once
    if (groupEl.querySelector('.dashboard-dropdown')) continue

    const dropdown = document.createElement('div')
    dropdown.className = 'dashboard-dropdown'

    for (const item of groupData.items) {
      const link = document.createElement('a')
      link.href = item.key
      link.className = 'dashboard-dropdown-item'
      link.textContent = item.label
      dropdown.appendChild(link)
    }

    groupEl.appendChild(dropdown)
  }
}

export function initTopnavDashboard() {
  const root = document.getElementById('topnav-dashboard')
  if (!root) return

  // Ingest the dropdown contents into the server-rendered tab buttons
  populateDropdowns()

  function switchDashboard(event, link) {
    event.preventDefault()
    router.updatePath({ dashboard: link.getAttribute('href') })
    closeAllDropdowns()
  }

  function updateActiveTabFromUrl() {
    const dashboard = router.parsePath()?.dashboard

    root.querySelectorAll(".dashboard-tab").forEach(tab => {
      tab.classList.toggle("selected", tab.getAttribute('href') === dashboard)
    })

    root.querySelectorAll(".dashboard-dropdown-item").forEach(item => {
      const isActive = item.getAttribute('href') === dashboard
      item.classList.toggle("selected", isActive)

      if (isActive) {
        const group = item.closest(".dashboard-tab-group")
        const parentTab = group?.querySelector(".dashboard-tab")
        parentTab?.classList.add("selected")
      }
    })
  }

  function updateWindowTitle() {
    const selectedTab = root.querySelector(".dashboard-tab.selected")
    const areaButton = document.querySelector("#topnav-area .dropdown__value")
    const dashboardTitle = selectedTab?.textContent.trim()
    const areaText = areaButton?.textContent.trim()
    if (dashboardTitle && areaText) document.title = `${dashboardTitle} • ${areaText}`
  }

  root.addEventListener('click', event => {
    const link = event.target.closest('.dashboard-tab, .dashboard-dropdown-item')
    if (!link || !root.contains(link)) return
    switchDashboard(event, link)
  })

  function syncFromUrl() {
    updateActiveTabFromUrl()
    updateWindowTitle()
  }

  syncFromUrl()
  router.onChange(syncFromUrl)

}
