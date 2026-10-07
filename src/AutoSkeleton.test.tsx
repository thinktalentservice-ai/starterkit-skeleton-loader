import { act, render, screen } from "@testing-library/react";
import { AutoSkeleton } from "./AutoSkeleton";
import { clearSkeletonCache } from "./cache";

/* Same convention as extract.test.ts: jsdom cannot lay anything out, so
   geometry is declared as data-rect / data-lines and the layout reads are
   stubbed to return it. */

const parseRect = (value: string | null): DOMRect => {
  const [left = 0, top = 0, width = 0, height = 0] = (value ?? "").split(",").map(Number);
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
};

beforeEach(() => {
  clearSkeletonCache();
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return parseRect(this.getAttribute("data-rect"));
  });
  Range.prototype.getClientRects = function (this: Range) {
    const node = this.startContainer;
    const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
    const lines = el?.getAttribute("data-lines");
    return (lines ? lines.split(";").map(parseRect) : []) as unknown as DOMRectList;
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const root = () => document.querySelector("[data-auto-skeleton]") as HTMLElement;
const content = () => document.querySelector("[data-auto-skeleton-content]") as HTMLElement;
const overlay = () => document.querySelector("[data-auto-skeleton-overlay]") as HTMLElement | null;
const skeletons = () => Array.from(document.querySelectorAll<HTMLElement>(".MuiSkeleton-root"));

const Card = ({ title = "Title" }: { title?: string }) => (
  <div data-rect="0,0,300,120" style={{ backgroundColor: "rgb(255, 255, 255)" }}>
    <img alt="" data-rect="16,16,48,48" />
    <p data-rect="16,80,200,20" data-lines="16,80,200,20">
      {title}
    </p>
  </div>
);

describe("AutoSkeleton — loaded", () => {
  it("shows the children and draws nothing over them", () => {
    render(
      <AutoSkeleton loading={false}>
        <Card />
      </AutoSkeleton>,
    );
    expect(screen.getByText("Title")).toBeVisible();
    expect(overlay()).toBeNull();
    expect(root()).not.toHaveAttribute("aria-busy");
    expect(content()).not.toHaveAttribute("aria-hidden");
    expect(content()).not.toHaveAttribute("inert");
  });
});

describe("AutoSkeleton — loading", () => {
  it("marks the wrapper busy and takes the content out of reach", () => {
    render(
      <AutoSkeleton loading>
        <Card />
      </AutoSkeleton>,
    );
    expect(root()).toHaveAttribute("aria-busy", "true");
    expect(content()).toHaveAttribute("aria-hidden", "true");
    expect(content()).toHaveAttribute("inert");
    expect(content().style.visibility).toBe("hidden");
  });

  it("draws one MUI Skeleton per bone at the measured geometry", () => {
    render(
      <AutoSkeleton loading>
        <Card />
      </AutoSkeleton>,
    );
    const drawn = skeletons().map((el) => ({
      left: el.style.left,
      top: el.style.top,
      width: el.style.width,
      height: el.style.height,
    }));
    expect(drawn).toEqual([
      { left: "16px", top: "16px", width: "48px", height: "48px" },
      { left: "16px", top: "80px", width: "200px", height: "20px" },
    ]);
    expect(skeletons()[1]).toHaveClass("MuiSkeleton-text");
  });

  it("repaints a container's own frame instead of turning it into a bone", () => {
    render(
      <AutoSkeleton loading>
        <Card />
      </AutoSkeleton>,
    );
    const surface = document.querySelector<HTMLElement>("[data-auto-skeleton-surface]");
    expect(surface).not.toBeNull();
    expect(surface).not.toHaveClass("MuiSkeleton-root");
    expect(surface?.style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(surface?.style.width).toBe("300px");
  });

  it("measures the fixture, not the children, when one is given", () => {
    render(
      <AutoSkeleton loading fixture={<Card title="Placeholder" />}>
        {null}
      </AutoSkeleton>,
    );
    expect(content()).toHaveTextContent("Placeholder");
    expect(skeletons()).toHaveLength(2);
  });

  it("swaps the fixture for the children once loaded", () => {
    const { rerender } = render(
      <AutoSkeleton loading fixture={<Card title="Placeholder" />}>
        <Card title="Real" />
      </AutoSkeleton>,
    );
    rerender(
      <AutoSkeleton loading={false} fixture={<Card title="Placeholder" />}>
        <Card title="Real" />
      </AutoSkeleton>,
    );
    expect(screen.getByText("Real")).toBeVisible();
    expect(screen.queryByText("Placeholder")).toBeNull();
    expect(overlay()).toBeNull();
    expect(content()).not.toHaveAttribute("inert");
  });

  it("passes animation and boneSx through to every bone", () => {
    render(
      <AutoSkeleton loading animation="wave" boneSx={{ opacity: 0.5 }}>
        <Card />
      </AutoSkeleton>,
    );
    for (const bone of skeletons()) {
      expect(bone).toHaveClass("MuiSkeleton-wave");
      expect(getComputedStyle(bone).opacity).toBe("0.5");
    }
  });

  it("re-measures when the content changes shape between renders", () => {
    const { rerender } = render(
      <AutoSkeleton loading>
        <img alt="" data-rect="0,0,10,10" />
      </AutoSkeleton>,
    );
    expect(skeletons()).toHaveLength(1);
    rerender(
      <AutoSkeleton loading>
        <img alt="" data-rect="0,0,10,10" />
        <img alt="" data-rect="0,20,10,10" />
      </AutoSkeleton>,
    );
    expect(skeletons()).toHaveLength(2);
  });
});

describe("AutoSkeleton — nothing to measure", () => {
  it("falls back to a single block filling the wrapper", () => {
    render(
      <AutoSkeleton loading minHeight={120}>
        {null}
      </AutoSkeleton>,
    );
    expect(skeletons()).toHaveLength(1);
    expect(skeletons()[0]).toHaveClass("MuiSkeleton-rounded");
    expect(skeletons()[0]?.style.width).toBe("100%");
    expect(getComputedStyle(root()).minHeight).toBe("120px");
  });

  it("reuses the shape learned from the loaded content under the same name", () => {
    render(
      <AutoSkeleton loading={false} name="card">
        <Card />
      </AutoSkeleton>,
    ).unmount();

    render(
      <AutoSkeleton loading name="card">
        {null}
      </AutoSkeleton>,
    );
    expect(skeletons()).toHaveLength(2);
    expect(document.querySelector("[data-auto-skeleton-surface]")).not.toBeNull();
  });

  it("does not borrow another name's shape", () => {
    render(
      <AutoSkeleton loading={false} name="card">
        <Card />
      </AutoSkeleton>,
    ).unmount();
    render(
      <AutoSkeleton loading name="row" minHeight={40}>
        {null}
      </AutoSkeleton>,
    );
    expect(skeletons()).toHaveLength(1);
    expect(skeletons()[0]?.style.width).toBe("100%");
  });
});

describe("AutoSkeleton — layout changes without a render", () => {
  it("re-measures on resize and stops listening once unmounted", () => {
    const disconnect = vi.fn();
    let notify: () => void = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const cancel = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancel);

    const view = render(
      <AutoSkeleton loading>
        <img alt="" data-testid="img" data-rect="0,0,10,10" />
      </AutoSkeleton>,
    );
    expect(skeletons()[0]?.style.width).toBe("10px");

    document.querySelector("[data-testid=img]")?.setAttribute("data-rect", "0,0,64,10");
    act(() => notify());
    expect(skeletons()[0]?.style.width).toBe("64px");

    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalled();
    // A late observer callback after unmount must not schedule or throw.
    expect(() => notify()).not.toThrow();
  });
});
