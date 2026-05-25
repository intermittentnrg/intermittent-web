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
  const menuRect = menu.getBoundingClientRect()
  const menuWidth = menuRect.width || menu.offsetWidth || buttonRect.width
  const left = buttonRect.left
  const maxLeft = window.innerWidth - menuWidth - 8

  menu.style.top = `${buttonRect.bottom + 4}px`
  menu.style.left = `${Math.max(8, Math.min(left, maxLeft))}px`
}

function toggleMenu(menu, button) {
  if (!menu) return
  const wasOpen = menu.classList.contains('open')
  closeAllDropdowns()
  if (!wasOpen) {
    menu.classList.add('open')
    positionMenu(button, menu)
    requestAnimationFrame(() => positionMenu(button, menu))
  }
}


document.addEventListener('click', (event) => {
  const clickedInside = event.target.closest('.open, .dropdown-btn, .dropdown-open')
  if (!clickedInside) {
    closeAllDropdowns()
  }
})

export { closeAllDropdowns, positionMenu, toggleMenu }
