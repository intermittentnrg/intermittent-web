import { router } from "../router.js"
import { closeAllDropdowns } from "../dropdown_utils.js"

export function initTopnavDashboard() {
  const root = document.getElementById('topnav-dashboard')
  if (!root) return null

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
    const areaButton = document.querySelector("#topnav-area .dropdown-value")
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

  return { syncFromUrl }
}
