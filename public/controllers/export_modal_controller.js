import { Controller } from "@hotwired/stimulus"
import { closeAllDropdowns, toggleMenu } from "../dropdown_utils.js"

export default class extends Controller {
  static targets = ["modal", "intervalSelected", "intervalMenu"]

  connect() {
    this.selectedInterval = '1h'
  }

  open(event) {
    event.preventDefault()
    event.stopPropagation()
    closeAllDropdowns()
    this.positionModal()
    this.modalTarget.classList.add('open')
  }

  close() {
    this.modalTarget.classList.remove('open')
  }

  positionModal() {
    const chart = document.querySelector('#main-chart')
    if (chart) {
      const rect = chart.getBoundingClientRect()
      this.modalTarget.style.top = `${rect.top + rect.height / 2}px`
      this.modalTarget.style.left = `${rect.left + rect.width / 2}px`
    }
  }

  toggleIntervalMenu(event) {
    event.stopPropagation()
    toggleMenu(this.intervalMenuTarget, event.currentTarget)
  }

  selectInterval(event) {
    event.preventDefault()
    const btn = event.currentTarget
    const interval = btn.dataset.interval

    this.selectedInterval = interval
    this.intervalSelectedTarget.textContent = interval

    this.intervalMenuTarget.querySelectorAll('.interval-option').forEach(el => {
      el.classList.remove('selected')
    })
    btn.classList.add('selected')
    closeAllDropdowns()
  }

  download() {
    const interval = this.selectedInterval
    const path = window.location.pathname
    const exportUrl = `${path}/data.csv?export_interval=${interval}`

    const query = new URLSearchParams(window.location.search)
    query.forEach((value, key) => {
      if (key !== 'export_interval') {
        exportUrl.searchParams.append(key, value)
      }
    })

    const link = document.createElement('a')
    link.href = exportUrl.toString()
    link.download = ''
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    this.close()
  }
}
