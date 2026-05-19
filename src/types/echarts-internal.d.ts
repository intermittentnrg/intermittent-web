declare module "echarts/lib/renderer/installCanvasRenderer.js" {
  export function install(registers: unknown): void;
}

declare module "echarts/lib/chart/*/install.js" {
  export function install(registers: unknown): void;
}

declare module "echarts/lib/component/*/install.js" {
  export function install(registers: unknown): void;
}

declare module "echarts/lib/component/marker/installMarkLine.js" {
  export function install(registers: unknown): void;
}
