import { Controller } from "@hotwired/stimulus"
import { router } from "../router.js"
import { closeAllDropdowns } from "../dropdown_utils.js"

export default class extends Controller {
  connect() {
    this.updateActiveTabFromUrl()
    this.updateWindowTitle()
    this.routerUnsubscribe = router.onChange(() => {
      this.updateActiveTabFromUrl()
      this.updateWindowTitle()
    })
  }

  disconnect() {
    if (this.routerUnsubscribe) {
      this.routerUnsubscribe()
    }
  }

  toggleDropdown(event) {
    event.preventDefault()
    event.stopPropagation()

    const group = event.currentTarget.closest(".dashboard-tab-group")
    const isOpen = group.classList.contains("dropdown-open")

    closeAllDropdowns()

    if (!isOpen) {
      group.classList.add("dropdown-open")
    }
  }

  switchDashboard(event) {
    event.preventDefault()
    const link = event.currentTarget
    router.updatePath({ dashboard: link.getAttribute('href') })
    closeAllDropdowns()
  }

  updateActiveTabFromUrl() {
    const dashboard = router.parsePath()?.dashboard

    this.element.querySelectorAll(".dashboard-tab").forEach(tab => {
      tab.classList.toggle("selected", tab.getAttribute('href') === dashboard)
    })

    this.element.querySelectorAll(".dashboard-dropdown-item").forEach(item => {
      const isActive = item.getAttribute('href') === dashboard
      item.classList.toggle("selected", isActive)

      if (isActive) {
        const group = item.closest(".dashboard-tab-group")
        if (group) {
          const parentTab = group.querySelector(".dashboard-tab")
          if (parentTab) {
            parentTab.classList.add("selected")
          }
        }
      }
    })
  }

  updateWindowTitle() {
    const dashboardTitle = this.getDashboardTitle()
    const areaText = this.getAreaText()
    if (dashboardTitle && areaText) {
      document.title = `${dashboardTitle} • ${areaText}`
    }
  }

  getDashboardTitle() {
    const selectedTab = this.element.querySelector(".dashboard-tab.selected")
    if (selectedTab) {
      return selectedTab.textContent.trim()
    }
    return null
  }

  getAreaText() {
    const areaButton = document.querySelector("#topnav-area .dropdown-value")
    if (areaButton) {
      return areaButton.textContent.trim()
    }
    return null
  }
}
