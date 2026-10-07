import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AutoSkeleton } from "../src";

/* Browser harness for tests/auto-skeleton.spec.ts, and a page to look at.
     ?loading=0   start loaded
     ?spacer=1    push the cards 1500px down, to measure on a scrolled page
     ?anim=wave   MUI wave animation
     ?mode=css    the CSS-only skeleton, i.e. what server-rendered HTML shows
                  before JavaScript has measured anything
     ?fixture=0   no fixture and no children while loading
     ?scale=0.5   put the skeleton under a scaling transform */

const params = new URLSearchParams(location.search);

const PIXEL =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'><rect width='8' height='8' fill='%2393c5fd'/></svg>";

type Account = { name: string; role: string; about: string };

const PLACEHOLDER: Account = {
  name: "Placeholder name",
  role: "Role",
  about:
    "Placeholder copy long enough to wrap onto a second and a third line in a narrow card, so line bones can be told apart.",
};

const REAL: Account = {
  name: "Ada Lovelace",
  role: "Admin",
  about:
    "Wrote the first published algorithm intended for a machine, and saw further than the machine's own designer about what it could do.",
};

function AccountCard({ account }: { account: Account }) {
  return (
    <div className="card" data-testid="card">
      <div className="banner" data-testid="banner" />
      <div className="head">
        <div className="avatar" data-testid="avatar" />
        <div>
          <h3 data-testid="title">{account.name}</h3>
          <span className="badge" data-testid="badge">
            {account.role}
          </span>
        </div>
      </div>
      <img data-testid="image" src={PIXEL} alt="" />
      <p className="meta" data-testid="meta">
        Updated today
      </p>
      <p data-testid="about">{account.about}</p>
      <button type="button" data-testid="action">
        Open account
      </button>
    </div>
  );
}

function App() {
  const [loading, setLoading] = useState(params.get("loading") !== "0");
  const animation = params.get("anim") === "wave" ? "wave" : "pulse";
  // ?fixture=0: nothing to measure while loading, as with `{data && <Card />}`.
  // The skeleton then has only the shape remembered from the last loaded view.
  const withFixture = params.get("fixture") !== "0";
  const scale = Number(params.get("scale")) || 1;
  const skeleton = (
    <AutoSkeleton
      loading={loading}
      name="accounts"
      animation={animation}
      mode={params.get("mode") === "css" ? "css" : "measure"}
      className="grid"
      minHeight={withFixture ? undefined : 120}
      fixture={
        withFixture ? (
          <>
            <AccountCard account={PLACEHOLDER} />
            <AccountCard account={PLACEHOLDER} />
          </>
        ) : undefined
      }
    >
      {withFixture || !loading ? (
        <>
          <AccountCard account={REAL} />
          <AccountCard account={REAL} />
        </>
      ) : null}
    </AutoSkeleton>
  );
  return (
    <>
      <div className="toolbar">
        <button type="button" data-testid="toggle" onClick={() => setLoading((value) => !value)}>
          {loading ? "Finish loading" : "Load again"}
        </button>
      </div>
      {params.get("spacer") === "1" && <div className="spacer" />}
      {/* ?scale=0.5: an ancestor transform, as under MUI's Grow / Popover. */}
      {scale === 1 ? (
        skeleton
      ) : (
        <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0", width: 900 }}>{skeleton}</div>
      )}
    </>
  );
}

createRoot(document.getElementById("app") as HTMLElement).render(<App />);
