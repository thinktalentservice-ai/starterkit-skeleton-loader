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

/* From an independent review of the branch: each of these was reproduced in a
   real browser before it was fixed. */
describe("extractBones — things inside a run of text", () => {
  const circle = ["top-left", "top-right", "bottom-right", "bottom-left"]
    .map((corner) => `border-${corner}-radius:50%`)
    .join(";");

  it("gives an inline image its own bone instead of swallowing it into the text bar", () => {
    // <img> computes to display:inline, so "avatar + name" looked like one run.
    const root = mount(`
      <div data-rect="0,0,300,40" data-lines="48,10,80,20">
        <img data-rect="0,0,40,40" style="${circle}" /> Jane Doe
      </div>`);
    const bones = extractBones(root);
    expect(bones.map((b) => b.variant)).toEqual(["circular", "text"]);
    expect(geometry(bones[1])).toEqual({ x: 48, y: 10, width: 80, height: 20 });
  });

  it("honours data-skeleton-ignore on an inline child", () => {
    const root = mount(`
      <p data-rect="0,0,400,20" data-lines="0,0,47,20">
        Name <span data-skeleton-ignore data-rect="50,0,350,20" data-lines="50,0,350,20">a long aside</span>
      </p>`);
    expect(extractBones(root).map(geometry)).toEqual([{ x: 0, y: 0, width: 47, height: 20 }]);
  });

  it("honours data-skeleton-variant on a text element", () => {
    const root = mount(
      `<p data-skeleton-variant="rounded" data-rect="0,0,200,40" data-lines="0,0,120,20">Heading</p>`,
    );
    const bones = extractBones(root);
    expect(bones).toHaveLength(1);
    expect(bones[0]).toMatchObject({ variant: "rounded", width: 200, height: 40 });
  });
});

describe("extractBones — what is not really there", () => {
  it("skips the body of a closed <details>", () => {
    const root = mount(`
      <details data-rect="0,0,300,20">
        <summary data-rect="0,0,300,20" data-lines="0,0,60,20">More</summary>
        <p data-rect="0,20,300,20" data-lines="0,20,140,20">Hidden body</p>
      </details>`);
    expect(extractBones(root).map(geometry)).toEqual([{ x: 0, y: 0, width: 60, height: 20 }]);
  });

  it("measures the body of an open <details>", () => {
    const root = mount(`
      <details open data-rect="0,0,300,40">
        <summary data-rect="0,0,300,20" data-lines="0,0,60,20">More</summary>
        <p data-rect="0,20,300,20" data-lines="0,20,140,20">Shown body</p>
      </details>`);
    expect(extractBones(root)).toHaveLength(2);
  });

  it("does not measure another skeleton's own bones", () => {
    // A nested AutoSkeleton's overlay sits inside the outer one's content.
    const root = mount(`
      <img data-rect="0,0,40,40" />
      <div data-auto-skeleton-overlay data-rect="0,0,300,200">
        <span data-rect="0,50,200,20" style="background-color:rgb(200, 200, 200)"></span>
      </div>`);
    expect(extractBones(root).map(geometry)).toEqual([{ x: 0, y: 0, width: 40, height: 40 }]);
  });
});

describe("extractBones — a scaled wrapper", () => {
  it("reports local pixels when an ancestor transform scales the wrapper", () => {
    // Laid out 400px wide, drawn 200px wide: transform: scale(0.5) above it.
    // Bones are positioned inside that same transform, so they need the
    // unscaled numbers.
    const root = mount(`<img data-rect="10,20,50,25" />`, 'data-rect="0,0,200,150"');
    Object.defineProperty(root, "offsetWidth", { value: 400 });
    Object.defineProperty(root, "offsetHeight", { value: 300 });
    expect(extractBones(root).map(geometry)).toEqual([{ x: 20, y: 40, width: 100, height: 50 }]);
  });
});

describe("extractBones — background images on frames", () => {
  it("keeps a gradient with its size, position and repeat", () => {
    const root = mount(`
      <div data-rect="0,0,300,200" style="background-image:linear-gradient(red, blue);background-size:cover;background-repeat:no-repeat">
        <img data-rect="0,0,10,10" />
      </div>`);
    const surface = extractBones(root)[0]?.surface;
    expect(surface?.backgroundImage).toContain("linear-gradient");
    expect(surface?.backgroundSize).toBe("cover");
    expect(surface?.backgroundRepeat).toBe("no-repeat");
  });

  it("does not repaint a photo: a url() background is left out of the frame", () => {
    const root = mount(`
      <div data-rect="0,0,300,200" style="background-image:url(photo.jpg);background-color:rgb(10, 20, 30)">
        <img data-rect="0,0,10,10" />
      </div>`);
    const surface = extractBones(root)[0]?.surface;
    expect(surface?.backgroundImage).toBe("");
    expect(surface?.backgroundColor).toBe("rgb(10, 20, 30)");
  });

  it("still turns a childless photo box into a bone", () => {
    const root = mount(`<div data-rect="0,0,300,200" style="background-image:url(photo.jpg)"></div>`);
    expect(extractBones(root).map((b) => b.kind)).toEqual(["bone"]);
  });
});

/* Found on real screens (a MUI data table and a form page), not on the demo
   card: rules that were right for a card turned table cells into solid blocks
   and repainted avatars and slider thumbs in full colour. */
describe("extractBones — text in a box that is only outlined", () => {
  it("keeps the words as lines when the box has a border but no fill", () => {
    const root = mount(
      `<h3 data-rect="0,0,300,30" data-lines="0,4,120,20" style="border-bottom:1px solid rgb(0, 0, 0)">Section</h3>`,
    );
    const bones = extractBones(root);
    expect(bones.map((b) => `${b.kind}:${b.variant}`)).toEqual(["surface:rectangular", "bone:text"]);
    expect(geometry(bones[1])).toEqual({ x: 0, y: 4, width: 120, height: 20 });
  });
});

describe("extractBones — tables", () => {
  const cell = "border-bottom:1px solid rgb(200, 200, 200);background-color:rgb(255, 255, 255)";

  it("draws a filled cell's text as lines over its frame, never as one block", () => {
    const root = mount(`
      <table data-rect="0,0,400,40"><tbody data-rect="0,0,400,40"><tr data-rect="0,0,400,40">
        <td data-rect="0,0,200,40" data-lines="16,10,120,20" style="${cell}">ada@example.com</td>
      </tr></tbody></table>`);
    const bones = extractBones(root);
    expect(bones.map((b) => `${b.kind}:${b.variant}`)).toEqual(["surface:rectangular", "bone:text"]);
    expect(geometry(bones[1])).toEqual({ x: 16, y: 10, width: 120, height: 20 });
  });

  it("repaints an empty filled cell as a frame, not a bone", () => {
    const root = mount(`
      <table data-rect="0,0,400,40"><tbody data-rect="0,0,400,40"><tr data-rect="0,0,400,40">
        <th data-rect="0,0,120,40" style="${cell}"></th>
      </tr></tbody></table>`);
    expect(extractBones(root).map((b) => b.kind)).toEqual(["surface"]);
  });

  it("does not collapse a small filled cell into a bone", () => {
    const root = mount(`
      <table data-rect="0,0,400,40"><tbody data-rect="0,0,400,40"><tr data-rect="0,0,400,40">
        <td data-rect="0,0,60,40" style="${cell}"><img data-rect="10,8,24,24" /></td>
      </tr></tbody></table>`);
    expect(extractBones(root).map((b) => b.kind)).toEqual(["surface", "bone"]);
  });
});

describe("extractBones — small painted containers", () => {
  const round = ["top-left", "top-right", "bottom-right", "bottom-left"]
    .map((corner) => `border-${corner}-radius:50%`)
    .join(";");
  const fill = "background-color:rgb(30, 60, 200)";

  it("turns a small filled container into one bone instead of repainting its colour", () => {
    // An avatar wrapping an <img>, a slider thumb wrapping its <input>.
    const root = mount(
      `<div data-rect="0,0,40,40" style="${fill};${round}"><img data-rect="0,0,40,40" /></div>`,
    );
    const bones = extractBones(root);
    expect(bones).toHaveLength(1);
    expect(bones[0]).toMatchObject({ kind: "bone", variant: "circular", x: 0, y: 0, width: 40, height: 40 });
  });

  it("does the same for a chip holding an icon and a label", () => {
    const root = mount(`
      <div data-rect="0,0,96,28" style="${fill}">
        <svg data-rect="6,6,16,16"></svg>
        <span data-rect="28,4,60,20" data-lines="28,4,60,20">Active</span>
      </div>`);
    expect(extractBones(root).map((b) => `${b.kind}:${b.width}`)).toEqual(["bone:96"]);
  });

  it("keeps a small container with more than two pieces as a frame", () => {
    const root = mount(`
      <div data-rect="0,0,120,48" style="${fill}">
        <img data-rect="4,4,16,16" /><img data-rect="24,4,16,16" /><img data-rect="44,4,16,16" />
      </div>`);
    expect(extractBones(root).map((b) => b.kind)).toEqual(["surface", "bone", "bone", "bone"]);
  });

  it("keeps a large container as a frame however little is in it", () => {
    const root = mount(
      `<div data-rect="0,0,300,200" style="${fill}"><img data-rect="16,16,48,48" /></div>`,
    );
    expect(extractBones(root).map((b) => b.kind)).toEqual(["surface", "bone"]);
  });

  it("keeps a wide bar as a frame: a toolbar with a title is not a bone", () => {
    const root = mount(`
      <div data-rect="0,0,900,48" style="${fill}">
        <span data-rect="16,14,80,20" data-lines="16,14,80,20">Title</span>
      </div>`);
    expect(extractBones(root).map((b) => b.kind)).toEqual(["surface", "bone"]);
  });
});

describe("extractBones — clipping", () => {
  const card =
    "overflow:hidden;background-color:rgb(255, 255, 255);border-top-left-radius:16px;border-top-right-radius:16px;border-bottom-right-radius:16px;border-bottom-left-radius:16px";

  it("clips a child to the rounded corners of an overflow:hidden parent", () => {
    // A card header with a square background: unclipped, it paints over the
    // card's rounded corners.
    const root = mount(`
      <div data-rect="0,0,300,200" style="${card}">
        <div data-rect="0,0,300,50" style="background-color:rgb(240, 240, 240)">
          <img data-rect="16,16,20,20" /><img data-rect="40,16,20,20" /><img data-rect="64,16,20,20" />
        </div>
      </div>`);
    const header = extractBones(root)[1];
    expect(header?.kind).toBe("surface");
    expect(header?.clip).toEqual({ x: 0, y: 0, width: 300, height: 200, radius: "16px" });
  });

  it("clips to the inside of the border, with the radius reduced to match", () => {
    const root = mount(`
      <div data-rect="0,0,300,200" style="${card};border-top:2px solid rgb(0, 0, 0);border-right:2px solid rgb(0, 0, 0);border-bottom:2px solid rgb(0, 0, 0);border-left:2px solid rgb(0, 0, 0)">
        <div data-rect="2,2,296,196" style="background-color:rgb(240, 240, 240)">
          <img data-rect="16,16,20,20" /><img data-rect="40,16,20,20" /><img data-rect="64,16,20,20" />
        </div>
      </div>`);
    expect(extractBones(root)[1]?.clip).toEqual({ x: 2, y: 2, width: 296, height: 196, radius: "14px" });
  });

  it("clips what sticks out of a scroll container and drops what is fully outside it", () => {
    const root = mount(`
      <div data-rect="0,0,200,100" style="overflow:auto">
        <img data-rect="10,10,50,50" />
        <img data-rect="150,10,100,50" />
        <img data-rect="10,300,50,50" />
      </div>`);
    const bones = extractBones(root);
    expect(bones.map(geometry)).toEqual([
      { x: 10, y: 10, width: 50, height: 50 },
      { x: 150, y: 10, width: 100, height: 50 },
    ]);
    expect(bones[0]?.clip).toBeUndefined();
    expect(bones[1]?.clip).toEqual({ x: 0, y: 0, width: 200, height: 100, radius: "" });
  });

  it("does not clip an absolutely positioned child that escapes a static clipper", () => {
    // The child's containing block is the outer relative box, so the inner
    // overflow:hidden does not apply to it — on the page it is fully visible.
    const root = mount(`
      <div data-rect="0,0,400,400" style="position:relative">
        <div data-rect="0,0,400,30" style="overflow:hidden">
          <img data-rect="20,200,80,40" style="position:absolute" />
        </div>
      </div>`);
    const bones = extractBones(root);
    expect(bones.map(geometry)).toEqual([{ x: 20, y: 200, width: 80, height: 40 }]);
    expect(bones[0]?.clip).toBeUndefined();
  });

  it("still clips an absolutely positioned child when the clipper is its containing block", () => {
    const root = mount(`
      <div data-rect="0,0,400,30" style="overflow:hidden;position:relative">
        <img data-rect="20,200,80,40" style="position:absolute" />
      </div>`);
    expect(extractBones(root)).toEqual([]);
  });

  it("resolves a percentage radius against the clipper, not the bone", () => {
    // inset(... round 50%) would be 50% of the bone's own box.
    const circle = ["top-left", "top-right", "bottom-right", "bottom-left"]
      .map((corner) => `border-${corner}-radius:50%`)
      .join(";");
    const root = mount(`
      <div data-rect="0,0,200,200" style="overflow:hidden;${circle}">
        <img data-rect="0,0,200,60" /><img data-rect="0,70,10,10" /><img data-rect="20,70,10,10" />
      </div>`);
    expect(extractBones(root)[0]?.clip).toEqual({ x: 0, y: 0, width: 200, height: 200, radius: "100px" });
  });

  it("leaves children of an overflow:visible parent alone", () => {
    const root = mount(`
      <div data-rect="0,0,200,100" style="background-color:rgb(255, 255, 255)">
        <img data-rect="150,10,100,50" /><img data-rect="0,0,10,10" /><img data-rect="20,0,10,10" />
      </div>`);
    expect(extractBones(root).every((bone) => bone.clip === undefined)).toBe(true);
  });
});
