import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type KeyEvent = {
  key: string;
  repeat: boolean;
  prevented: boolean;
  stopped: boolean;
  preventDefault: () => void;
  stopImmediatePropagation: () => void;
};

function reviewHarness() {
  const windowListeners = new Map<string, (event: KeyEvent) => void>();
  const documentListeners = new Map<string, () => void>();
  const effects: (() => void)[] = [];
  const expanded: boolean[] = [];
  let modalOpen = false;
  const root = { requestFullscreen: () => Promise.resolve() };
  const document = {
    documentElement: root,
    fullscreenEnabled: true,
    fullscreenElement: null as object | null,
    exitFullscreen: () => Promise.resolve(),
    querySelector: () => (modalOpen ? {} : null),
    dispatchEvent: () => {},
    addEventListener: (type: string, fn: () => void) =>
      documentListeners.set(type, fn),
    removeEventListener: () => {},
  };
  root.requestFullscreen = () => {
    document.fullscreenElement = root;
    return Promise.resolve();
  };
  const context = vm.createContext({
    exports: {},
    require: () => ({
      useCallback: (fn: unknown) => fn,
      useRef: (initial: unknown) => ({ current: initial }),
      useState: () => [false, (value: boolean) => expanded.push(value)],
      useEffect: (fn: () => void) => effects.push(fn),
    }),
    document,
    window: {
      addEventListener: (type: string, fn: (event: KeyEvent) => void) =>
        windowListeners.set(type, fn),
      removeEventListener: () => {},
    },
    KeyboardEvent: class {
      constructor(
        readonly type: string,
        readonly options: { key: string }
      ) {}
    },
  });
  const source = readFileSync(
    new URL("./useGanttReview.ts", import.meta.url),
    "utf8"
  );
  vm.runInContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    context
  );
  const review = vm.runInContext("exports.useGanttReview()", context) as {
    setReviewMode: (value: boolean) => void;
    setEscapeHandler: (handler: () => boolean) => void;
    noteEscape: (handled: boolean) => void;
  };
  for (const effect of effects) effect();
  return {
    review,
    expanded,
    setModal: (value: boolean) => {
      modalOpen = value;
    },
    escape() {
      const event: KeyEvent = {
        key: "Escape",
        repeat: false,
        prevented: false,
        stopped: false,
        preventDefault() {
          this.prevented = true;
        },
        stopImmediatePropagation() {
          this.stopped = true;
        },
      };
      windowListeners.get("keydown")?.(event);
      return event;
    },
    release: () => review.noteEscape(false),
    exitNative() {
      document.fullscreenElement = null;
      documentListeners.get("fullscreenchange")?.();
    },
  };
}

describe("Gantt review Escape priority", () => {
  it("lets the iframe consume its dialog/filter before leaving review", () => {
    const harness = reviewHarness();
    let blocked = true;
    let calls = 0;
    harness.review.setEscapeHandler(() => {
      calls++;
      return blocked;
    });
    harness.review.setReviewMode(true);
    expect(harness.escape().prevented).toBe(true);
    expect(calls).toBe(1);
    expect(harness.expanded).toEqual([true]);
    harness.release();
    blocked = false;
    harness.escape();
    expect(harness.expanded).toEqual([true, false]);
  });

  it("lets host dialogs handle Escape without exiting review", () => {
    const harness = reviewHarness();
    let calls = 0;
    harness.review.setEscapeHandler(() => {
      calls++;
      return true;
    });
    harness.review.setReviewMode(true);
    harness.setModal(true);
    expect(harness.escape().prevented).toBe(false);
    expect(calls).toBe(0);
    expect(harness.expanded).toEqual([true]);
  });

  it("keeps the board expanded on native Escape and consumes one layer only", async () => {
    const harness = reviewHarness();
    let calls = 0;
    harness.review.setEscapeHandler(() => {
      calls++;
      return true;
    });
    harness.review.setReviewMode(true);
    await Promise.resolve();
    harness.exitNative();
    expect(calls).toBe(1);
    expect(harness.expanded).toEqual([true]);
    harness.escape();
    expect(calls).toBe(1);
  });

  it("does not consume another layer if the iframe handled native Escape first", async () => {
    const harness = reviewHarness();
    let calls = 0;
    harness.review.setEscapeHandler(() => {
      calls++;
      return true;
    });
    harness.review.setReviewMode(true);
    await Promise.resolve();
    harness.review.noteEscape(true);
    harness.exitNative();
    expect(calls).toBe(0);
    expect(harness.expanded).toEqual([true]);
  });
});
