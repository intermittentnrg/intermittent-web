/**
 * TypeScript re-export of the shared uPlot heatmap plugin.
 * The runtime implementation lives in the shared .js module so it can be used
 * by both backend (TypeScript) and browser (esbuild).
 */
export { HEATMAP_COLORS, heatmapPlugin } from "./uplotHeatmap.js";
