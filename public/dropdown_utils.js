function closeAllDropdowns() {
  document.querySelectorAll('.open').forEach(el => {
    el.classList.remove('open')
  })
  document.querySelectorAll('.dropdown-open').forEach(el => {
    el.classList.remove('dropdown-open')
  })
}

function positionMenu(button, menu) {
  if (!button || !menu) return
  const buttonRect = button.getBoundingClientRect()
  menu.style.left = `${buttonRect.left}px`
  menu.style.top = `${buttonRect.bottom + 4}px`
}

function toggleMenu(menu, button) {
  if (!menu) return
  const wasOpen = menu.classList.contains('open')
  closeAllDropdowns()
  if (!wasOpen) {
    menu.classList.add('open')
    positionMenu(button, menu)
  }
}

function triggerChartUpdate() {
  document.dispatchEvent(new CustomEvent('update-chart', { bubbles: true }))
}

document.addEventListener('click', (event) => {
  const clickedInside = event.target.closest('.open, .dropdown-btn, .dropdown-open')
  if (!clickedInside) {
    closeAllDropdowns()
  }
})

export { closeAllDropdowns, positionMenu, toggleMenu, triggerChartUpdate }
