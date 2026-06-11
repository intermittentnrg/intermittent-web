import { Canvas, Path2D } from "skia-canvas";

let active = false;
let currentCanvas: Canvas | null = null;

const classListMock = {
  add: () => {},
  remove: () => {},
  contains: () => false,
  toggle: () => false,
};

function mockElement(tag: string) {
  if (tag === "canvas") {
    const c = currentCanvas;
    if (!c) throw new Error("uplotDomShim: currentCanvas is null — call setShimCanvas() first");
    return Object.assign(c, {
      style: {} as Record<string, string>,
      classList: classListMock,
      getBoundingClientRect: () => ({
        left: 0, top: 0, width: c.width, height: c.height,
        right: c.width, bottom: c.height,
      }),
      addEventListener: () => {},
      removeEventListener: () => {},
      parentNode: null,
      dispatchEvent: () => true,
      remove: () => {},
    }) as any;
  }
  return {
    style: {} as Record<string, string>,
    classList: classListMock,
    appendChild: () => {},
    removeChild: () => {},
    insertBefore: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }),
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute: () => {},
    getAttribute: () => null,
    textContent: "",
    childNodes: [] as any[],
    firstChild: null,
    append: () => {},
    remove: () => {},
  };
}

function mockMatchMedia(query: string) {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  };
}

export function initDomShim(): void {
  if (active) return;

  // @ts-ignore
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
    devicePixelRatio: 1,
    matchMedia: mockMatchMedia,
    document: undefined as any,
    navigator: undefined as any,
  };

  // @ts-ignore
  globalThis.document = {
    createElement: mockElement,
    createTextNode: () => ({ textContent: "" }),
    createElementNS: () => mockElement("div"),
    documentElement: { style: {} },
    body: { appendChild: () => {}, style: {} },
    head: { appendChild: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  // @ts-ignore
  globalThis.DOMRect = class DOMRect {
    x: number; y: number; width: number; height: number;
    constructor(x = 0, y = 0, width = 0, height = 0) {
      this.x = x; this.y = y; this.width = width; this.height = height;
    }
    toJSON() { return { x: this.x, y: this.y, width: this.width, height: this.height }; }
  } as any;

  // @ts-ignore
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}; unobserve() {}; disconnect() {};
  };

  // @ts-ignore
  globalThis.requestAnimationFrame = (fn: Function) => setTimeout(fn, 0);
  // @ts-ignore
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
  // @ts-ignore
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type: string, _init?: Record<string, any>) { super(type); }
  };
  // @ts-ignore
  globalThis.MouseEvent = class MouseEvent extends Event {
    constructor(type: string, _init?: Record<string, any>) { super(type); }
  };
  // @ts-ignore
  globalThis.TouchEvent = class TouchEvent extends Event {
    constructor(type: string, _init?: Record<string, any>) { super(type); }
  };
  // @ts-ignore
  globalThis.Path2D = Path2D;
  // @ts-ignore
  globalThis.HTMLElement = class HTMLElement {
    style: Record<string, string> = {};
    classList = classListMock;
    appendChild() {}; addEventListener() {}; removeEventListener() {};
  } as any;
  // @ts-ignore
  globalThis.KeyboardEvent = class KeyboardEvent extends Event {
    constructor(type: string, _init?: Record<string, any>) { super(type); }
  };
  // @ts-ignore
  globalThis.matchMedia = mockMatchMedia;
  // @ts-ignore
  globalThis.devicePixelRatio = 1;

  active = true;
}

export function setShimCanvas(canvas: Canvas): void {
  currentCanvas = canvas;
}

export function getShimCanvas(): Canvas | null {
  return currentCanvas;
}

export function isShimActive(): boolean {
  return active;
}

export function destroyDomShim(): void {
  // @ts-ignore
  delete globalThis.document;
  // @ts-ignore
  delete globalThis.window;
  // @ts-ignore
  delete globalThis.DOMRect;
  // @ts-ignore
  delete globalThis.ResizeObserver;
  // @ts-ignore
  delete globalThis.requestAnimationFrame;
  // @ts-ignore
  delete globalThis.cancelAnimationFrame;
  // @ts-ignore
  delete globalThis.CustomEvent;
  // @ts-ignore
  delete globalThis.MouseEvent;
  // @ts-ignore
  delete globalThis.TouchEvent;
  // @ts-ignore
  delete globalThis.Path2D;
  // @ts-ignore
  delete globalThis.HTMLElement;
  // @ts-ignore
  delete globalThis.KeyboardEvent;
  // @ts-ignore
  delete globalThis.matchMedia;
  // @ts-ignore
  delete globalThis.devicePixelRatio;
  currentCanvas = null;
  active = false;
}
