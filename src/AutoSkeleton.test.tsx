import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
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

describe("AutoSkeleton — before anything is measured", () => {
  // renderToString runs no effects: this is the markup a static export ships,
  // and what is on screen until hydration.
  const shipped = () => {
    const html = renderToString(
      <AutoSkeleton loading fixture={<Card title="Placeholder" />}>
        {null}
      </AutoSkeleton>,
    );
    const parsed = new DOMParser().parseFromString(html, "text/html");
    return parsed.querySelector<HTMLElement>("[data-auto-skeleton-content]");
  };

  it("ships the content visible and flagged for the CSS skeleton, not hidden behind a block", () => {
    const element = shipped();
    expect(element?.hasAttribute("data-auto-skeleton-css")).toBe(true);
    expect(element?.style.visibility).toBe("");
    expect(element?.textContent).toContain("Placeholder");
  });

  it("ships the content inert and hidden from assistive tech", () => {
    const element = shipped();
    expect(element?.hasAttribute("inert")).toBe(true);
    expect(element?.getAttribute("aria-hidden")).toBe("true");
  });

  it("hands over to measured bones once it can measure", () => {
    render(
      <AutoSkeleton loading>
        <Card />
      </AutoSkeleton>,
    );
    expect(content()).not.toHaveAttribute("data-auto-skeleton-css");
    expect(content().style.visibility).toBe("hidden");
    expect(skeletons()).toHaveLength(2);
  });
});

describe('AutoSkeleton — mode="css"', () => {
  it("stays on the CSS skeleton and never measures", () => {
    const rects = vi.spyOn(Element.prototype, "getBoundingClientRect");
    render(
      <AutoSkeleton loading mode="css">
        <Card />
      </AutoSkeleton>,
    );
    expect(content()).toHaveAttribute("data-auto-skeleton-css");
    expect(content().style.visibility).toBe("");
    expect(content()).toHaveAttribute("inert");
    expect(document.querySelector("[data-auto-skeleton-surface]")).toBeNull();
    expect(rects).not.toHaveBeenCalled();
  });

  it("drops the flag when loading ends", () => {
    const { rerender } = render(
      <AutoSkeleton loading mode="css">
        <Card />
      </AutoSkeleton>,
    );
    rerender(
      <AutoSkeleton loading={false} mode="css">
        <Card />
      </AutoSkeleton>,
    );
    expect(content()).not.toHaveAttribute("data-auto-skeleton-css");
    expect(content()).not.toHaveAttribute("inert");
    expect(screen.getByText("Title")).toBeVisible();
  });
});

describe("AutoSkeleton — boneColor", () => {
  it("colours measured bones and publishes the colour for the CSS skeleton", () => {
    render(
      <AutoSkeleton loading boneColor="rgb(1, 2, 3)">
        <Card />
      </AutoSkeleton>,
    );
    expect(getComputedStyle(root()).getPropertyValue("--auto-skeleton-bone")).toBe("rgb(1, 2, 3)");
    for (const bone of skeletons()) {
      expect(getComputedStyle(bone).backgroundColor).toBe("rgb(1, 2, 3)");
    }
  });
});

/* From an independent review: each reproduced in a real browser first. */
describe("AutoSkeleton — the fixture and the children are different things", () => {
  // Same component type in both slots, as in the README's first example. Its
  // state and its uncontrolled input are seeded from props on mount.
  const Stateful = ({ name }: { name: string }) => {
    const [seeded] = useState(name);
    const [clicks, setClicks] = useState(0);
    return (
      <div data-rect="0,0,300,60">
        <output>{seeded}</output>
        <input defaultValue={name} aria-label="name" data-rect="0,0,100,20" />
        <button type="button" data-rect="0,30,60,20" onClick={() => setClicks((n) => n + 1)}>
          clicks {clicks}
        </button>
      </div>
    );
  };

  it("does not hand the fixture's state to the real component", () => {
    const view = (loading: boolean) => (
      <AutoSkeleton loading={loading} fixture={<Stateful name="Placeholder" />}>
        <Stateful name="Real" />
      </AutoSkeleton>
    );
    const { rerender } = render(view(true));
    rerender(view(false));
    expect(screen.getByRole("status")).toHaveTextContent("Real");
    expect(screen.getByLabelText("name")).toHaveValue("Real");
  });

  it("keeps the children's state across a load, fixture or not", () => {
    const view = (loading: boolean) => (
      <AutoSkeleton loading={loading} fixture={<Stateful name="Placeholder" />}>
        <Stateful name="Real" />
      </AutoSkeleton>
    );
    const { rerender } = render(view(false));
    act(() => screen.getByRole("button").click());
    expect(screen.getByRole("button")).toHaveTextContent("clicks 1");

    rerender(view(true));
    rerender(view(false));
    expect(screen.getByRole("button")).toHaveTextContent("clicks 1");
  });

  it("measures only the fixture while both are mounted", () => {
    render(
      <AutoSkeleton loading fixture={<img alt="" data-rect="0,0,10,10" />}>
        <img alt="" data-rect="0,50,99,99" />
      </AutoSkeleton>,
    );
    expect(skeletons().map((el) => el.style.width)).toEqual(["10px"]);
  });
});

describe("AutoSkeleton — remembered shapes", () => {
  it("hydrates cleanly when the shape is already remembered", () => {
    // The server has no memory; the first client render must not consult it.
    const markup = (
      <AutoSkeleton loading name="card">
        {null}
      </AutoSkeleton>
    );
    const host = document.createElement("div");
    document.body.appendChild(host);
    // Rendered with nothing remembered, as on a server...
    host.innerHTML = renderToString(markup);
    // ...then hydrated in a page where another instance has since learned the shape.
    render(
      <AutoSkeleton loading={false} name="card">
        <Card />
      </AutoSkeleton>,
    ).unmount();
    const mismatches: unknown[] = [];
    // React reports an attribute mismatch on console.error and a structural
    // one through onRecoverableError; either is a failed hydration.
    const logged = vi.spyOn(console, "error").mockImplementation((...args) => {
      if (/hydrat|did not match|didn't match/i.test(String(args[0]))) mismatches.push(args[0]);
    });
    let hydrated: ReturnType<typeof hydrateRoot> | undefined;
    act(() => {
      hydrated = hydrateRoot(host, markup, { onRecoverableError: (error) => mismatches.push(error) });
    });
    logged.mockRestore();
    expect(mismatches).toEqual([]);
    // …and still ends up using it, one commit later.
    expect(host.querySelectorAll(".MuiSkeleton-root")).toHaveLength(2);
    act(() => hydrated?.unmount());
    host.remove();
  });

  it("does not reuse a shape learned at a different width", () => {
    // 600px-wide bones in a 200px wrapper would be painted over its neighbours.
    const clientWidth = vi.spyOn(Element.prototype, "clientWidth", "get");
    clientWidth.mockReturnValue(600);
    render(
      <AutoSkeleton loading={false} name="wide">
        <Card />
      </AutoSkeleton>,
    ).unmount();

    clientWidth.mockReturnValue(200);
    render(
      <AutoSkeleton loading name="wide" minHeight={40}>
        {null}
      </AutoSkeleton>,
    );
    expect(skeletons()).toHaveLength(1);
    expect(skeletons()[0]?.style.width).toBe("100%");
  });
});

describe("AutoSkeleton — content that changes without telling its parent", () => {
  it("re-measures when something inside the content mutates", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    render(
      <AutoSkeleton loading>
        <img alt="" data-testid="img" data-rect="0,0,10,10" />
      </AutoSkeleton>,
    );
    expect(skeletons()[0]?.style.width).toBe("10px");

    // A child moving itself in its own effect: no commit of AutoSkeleton, no
    // change in the wrapper's size.
    await act(async () => {
      document.querySelector("[data-testid=img]")?.setAttribute("data-rect", "0,0,64,10");
      await Promise.resolve();
    });
    expect(skeletons()[0]?.style.width).toBe("64px");
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
