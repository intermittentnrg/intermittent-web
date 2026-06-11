# Critical CSS rule

`src/views/shared/critical_css.ejs` must only contain styles for elements
that are visible on the initial page load — the page skeleton, topnav bar,
dashboard tabs, trigger buttons, and their immediate labels/values.

Anything hidden in a dropdown panel (`.dropdown__panel`,
`.dropdown__content`, `.dropdown__option`, checkboxes inside panels,
date range panes, area tree columns, etc.) must go in the external CSS
asset files (`public/topnav-*.css`).
