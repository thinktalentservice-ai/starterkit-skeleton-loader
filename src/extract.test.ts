import { extractBones, mergeLines } from "./extract";
import type { Bone } from "./types";

/* jsdom has no layout engine, so geometry is declared on the markup and the
   three layout reads the extractor makes are stubbed to return it:
     data-rect="left,top,width,height"      -> getBoundingClientRect()
     data-lines="l,t,w,h;l,t,w,h"           -> Range.getClientRects() over that
                                               element or its direct text
     data-before="<css content value>"      -> getComputedStyle(el, "::before")
   Real layout is covered by the Playwright specs in tests/. */

const parseRect = (value: string | null): DOMRect => {
  const [left = 0, top = 0, width = 0, height = 0] = (value ?? "").split(",").map(Number);
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
};

const realGetComputedStyle = window.getComputedStyle.bind(window);

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return parseRect(this.getAttribute("data-rect"));
  });
  Range.prototype.getClientRects = function (this: Range) {
    const node = this.startContainer;
    const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
    const lines = el?.getAttribute("data-lines");
    const rects = lines ? lines.split(";").map(parseRect) : [];
    return rects as unknown as DOMRectList;
  };
  vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
    if (pseudo) {
      const content = pseudo === "::before" ? el.getAttribute("data-before") : null;
      return { content: content ?? "none" } as CSSStyleDeclaration;
    }
    return realGetComputedStyle(el);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function mount(html: string, rootAttrs = 'data-rect="0,0,400,300"'): Element {
  document.body.innerHTML = `<div id="root" ${rootAttrs}>${html}</div>`;
  return document.getElementById("root") as Element;
}

const geometry = (bone: Bone | undefined) =>
  bone && { x: bone.x, y: bone.y, width: bone.width, height: bone.height };

describe("mergeLines", () => {
  const rect = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
  });

  it("returns nothing for no rects", () => {
    expect(mergeLines([])).toEqual([]);
  });

  it("unions fragments that share a line", () => {
    expect(mergeLines([rect(60, 10, 40, 20), rect(0, 10, 50, 20)])).toEqual([rect(0, 10, 100, 20)]);
  });

  it("joins fragments of different font sizes on one line", () => {
    expect(mergeLines([rect(0, 10, 50, 24), rect(50, 16, 30, 14)])).toEqual([rect(0, 10, 80, 24)]);
  });

  it("keeps separate lines apart, top to bottom", () => {
    expect(mergeLines([rect(0, 40, 80, 20), rect(0, 10, 200, 20)])).toEqual([
      rect(0, 10, 200, 20),
      rect(0, 40, 80, 20),
    ]);
  });

  it("drops zero-size fragments such as collapsed whitespace", () => {
    expect(mergeLines([rect(0, 10, 0, 20), rect(0, 10, 50, 20)])).toEqual([rect(0, 10, 50, 20)]);
  });
});

describe("extractBones — what becomes a bone", () => {
  it("emits one text bone per rendered line of a paragraph", () => {
    const root = mount(
      `<p data-rect="10,20,300,44" data-lines="10,20,300,20;10,44,120,20">Two lines of text</p>`,
    );
    const bones = extractBones(root);
    expect(bones.map((b) => b.variant)).toEqual(["text", "text"]);
    expect(bones.map(geometry)).toEqual([
      { x: 10, y: 20, width: 300, height: 20 },
      { x: 10, y: 44, width: 120, height: 20 },
    ]);
  });

  it("treats text with inline children as one run, not one bone per child", () => {
    const root = mount(
      `<p data-rect="0,0,200,20" data-lines="0,0,60,20;60,0,40,20">Hello <b>world</b></p>`,
    );
    expect(extractBones(root).map(geometry)).toEqual([{ x: 0, y: 0, width: 100, height: 20 }]);
  });

  it("emits media and form controls as a single shape without descending", () => {
    const root = mount(`
      <img data-rect="0,0,80,60" />
      <button data-rect="0,70,120,36" style="border-top-left-radius:8px;border-top-right-radius:8px;border-bottom-right-radius:8px;border-bottom-left-radius:8px">
        <span data-rect="10,78,40,20" data-lines="10,78,40,20">Save</span>
      </button>
      <svg data-rect="0,120,24,24"><path data-rect="0,120,24,24"></path></svg>`);
    const bones = extractBones(root);
    expect(bones.map((b) => b.variant)).toEqual(["rectangular", "rounded", "rectangular"]);
    expect(bones[1]?.radius).toBe("8px");
    expect(geometry(bones[2])).toEqual({ x: 0, y: 120, width: 24, height: 24 });
  });

  it("classifies a square with a full radius as circular", () => {
    const radius = ["top-left", "top-right", "bottom-right", "bottom-left"]
      .map((corner) => `border-${corner}-radius:50%`)
      .join(";");
    const root = mount(`<img data-rect="0,0,48,48" style="${radius}" />`);
    expect(extractBones(root)[0]?.variant).toBe("circular");
  });

  it("keeps a pill — full radius but not square — as rounded", () => {
    const radius = ["top-left", "top-right", "bottom-right", "bottom-left"]
      .map((corner) => `border-${corner}-radius:999px`)
      .join(";");
    const root = mount(`<img data-rect="0,0,120,32" style="${radius}" />`);
    const [bone] = extractBones(root);
    expect(bone?.variant).toBe("rounded");
    expect(bone?.radius).toBe("999px");
  });

  it("emits a painted text box (chip, badge) as one shape instead of text lines", () => {
    const root = mount(
      `<span data-rect="0,0,60,24" data-lines="8,4,44,16" style="background-color:rgb(0, 128, 0)">New</span>`,
    );
    const bones = extractBones(root);
    expect(bones).toHaveLength(1);
    expect(bones[0]?.variant).toBe("rectangular");
    expect(geometry(bones[0])).toEqual({ x: 0, y: 0, width: 60, height: 24 });
  });

  it("emits a childless element only when something is painted", () => {
    const root = mount(`
      <div data-rect="0,0,100,16"></div>
      <div data-rect="0,20,40,40" style="background-color:rgb(200, 200, 200)"></div>
      <i data-rect="0,70,16,16" data-before='"\\f101"'></i>`);
    expect(extractBones(root).map(geometry)).toEqual([
      { x: 0, y: 20, width: 40, height: 40 },
      { x: 0, y: 70, width: 16, height: 16 },
    ]);
  });

  it("picks up loose text that sits beside block children", () => {
    const root = mount(`
      <div data-rect="0,0,300,60" data-lines="0,0,50,20">
        Label
        <div data-rect="0,24,300,36" style="background-color:rgb(1, 2, 3)"></div>
      </div>`);
    expect(extractBones(root).map((b) => b.variant)).toEqual(["text", "rectangular"]);
  });
});

describe("extractBones — surfaces", () => {
  it("emits a container's frame before the bones inside it", () => {
    const root = mount(`
      <div data-rect="0,0,300,200" style="background-color:rgb(255, 255, 255);border-top:1px solid rgb(0, 0, 0);box-shadow:0 1px 2px rgba(0, 0, 0, 0.2)">
        <p data-rect="16,16,200,20" data-lines="16,16,200,20">Title</p>
      </div>`);
    const bones = extractBones(root);
    expect(bones.map((b) => b.kind)).toEqual(["surface", "bone"]);
    expect(bones[0]?.surface).toMatchObject({
      backgroundColor: "rgb(255, 255, 255)",
      borderTop: "1px solid rgb(0, 0, 0)",
      borderLeft: "",
    });
    expect(bones[0]?.surface?.boxShadow).not.toBe("");
  });

  it("does not emit a frame for a container that paints nothing", () => {
    const root = mount(`
      <div data-rect="0,0,300,200" style="background-color:rgba(0, 0, 0, 0)">
        <p data-rect="16,16,200,20" data-lines="16,16,200,20">Title</p>
      </div>`);
    expect(extractBones(root).map((b) => b.kind)).toEqual(["bone"]);
  });
});

describe("extractBones — what is skipped", () => {
  it("skips display:none, opacity:0 and data-skeleton-ignore subtrees", () => {
    const root = mount(`
      <div style="display:none"><img data-rect="0,0,10,10" /></div>
      <div style="opacity:0"><img data-rect="0,0,10,10" /></div>
      <div data-skeleton-ignore><img data-rect="0,0,10,10" /></div>
      <img data-rect="0,50,10,10" />`);
    expect(extractBones(root).map(geometry)).toEqual([{ x: 0, y: 50, width: 10, height: 10 }]);
  });

  it("still measures content hidden with visibility:hidden", () => {
    const root = mount(`<div style="visibility:hidden"><img data-rect="0,0,10,10" /></div>`);
    expect(extractBones(root)).toHaveLength(1);
  });

  it("descends through display:contents, whose own rect is empty", () => {
    const root = mount(`<div style="display:contents" data-rect="0,0,0,0"><img data-rect="5,5,10,10" /></div>`);
    expect(extractBones(root).map(geometry)).toEqual([{ x: 5, y: 5, width: 10, height: 10 }]);
  });

  it("emits nothing for zero-area elements", () => {
    const root = mount(`<img data-rect="0,0,0,0" /><img data-rect="0,0,10,0" />`);
    expect(extractBones(root)).toEqual([]);
  });
});

describe("extractBones — opt-outs", () => {
  it("treats data-skeleton-leaf as one bone and does not descend", () => {
    const root = mount(`
      <div data-skeleton-leaf data-rect="0,0,200,100">
        <p data-rect="0,0,200,20" data-lines="0,0,200,20">Inside</p>
      </div>`);
    expect(extractBones(root).map(geometry)).toEqual([{ x: 0, y: 0, width: 200, height: 100 }]);
  });

  it("honours data-skeleton-variant and ignores unknown values", () => {
    const root = mount(`
      <img data-rect="0,0,40,40" data-skeleton-variant="circular" />
      <img data-rect="0,50,40,40" data-skeleton-variant="hexagon" />`);
    expect(extractBones(root).map((b) => b.variant)).toEqual(["circular", "rectangular"]);
  });
});

describe("extractBones — coordinates", () => {
  it("measures from the origin's padding box, not the viewport", () => {
    const root = mount(`<img data-rect="130,260,10,10" />`, 'data-rect="100,200,400,300"');
    Object.defineProperty(root, "clientLeft", { value: 4 });
    Object.defineProperty(root, "clientTop", { value: 6 });
    expect(extractBones(root).map(geometry)).toEqual([{ x: 26, y: 54, width: 10, height: 10 }]);
  });

  it("accounts for the origin's own scroll offset", () => {
    const root = mount(`<img data-rect="0,-40,10,10" />`);
    Object.defineProperty(root, "scrollTop", { value: 50 });
    expect(extractBones(root).map(geometry)).toEqual([{ x: 0, y: 10, width: 10, height: 10 }]);
  });

  it("uses a separate origin element when one is given", () => {
    document.body.innerHTML = `
      <div id="origin" data-rect="50,50,400,300">
        <div id="root" style="display:contents"><img data-rect="60,70,10,10" /></div>
      </div>`;
    const bones = extractBones(document.getElementById("root") as Element, {
      origin: document.getElementById("origin") as Element,
    });
    expect(bones.map(geometry)).toEqual([{ x: 10, y: 20, width: 10, height: 10 }]);
  });

  it("clamps text lines to the element so clipped overflow is not drawn", () => {
    const root = mount(
      `<p data-rect="0,0,100,20" data-lines="0,0,260,20;0,24,260,20">A very long line that is cut with an ellipsis</p>`,
    );
    expect(extractBones(root).map(geometry)).toEqual([{ x: 0, y: 0, width: 100, height: 20 }]);
  });

  it("falls back to the element box when Range has no layout methods", () => {
    // @ts-expect-error simulating an environment without Range.getClientRects
    Range.prototype.getClientRects = undefined;
    const root = mount(`<p data-rect="0,0,100,20">Text</p>`);
    expect(extractBones(root).map(geometry)).toEqual([{ x: 0, y: 0, width: 100, height: 20 }]);
  });
});
