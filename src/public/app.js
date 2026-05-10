const state = JSON.parse(
  document.querySelector("#initial-state").textContent
);

function syncActiveClasses() {
  document.querySelectorAll("[data-active-key]").forEach((el) => {
    const key = el.dataset.activeKey;
    const value = el.dataset.activeValue;

    el.classList.toggle("active", state[key] === value);
  });
}

document.addEventListener("click", async (event) => {
  const link = event.target.closest("[data-spa-link]");

  if (!link) return;

  event.preventDefault();

  const url = new URL(link.href);

  state.type = url.pathname.replace("/", "");

  history.pushState({}, "", url.pathname);

  syncActiveClasses();

  document.querySelector("#chart").innerHTML =
    `Chart type: ${state.type}`;
});

window.addEventListener("popstate", () => {
  state.type = location.pathname.replace("/", "") || "wind";

  syncActiveClasses();
});

syncActiveClasses();
