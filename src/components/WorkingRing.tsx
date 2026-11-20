import "./WorkingRing.css";

/** A live work signal around a tab or agent row. The host supplies its accessible status. */
export function WorkingRing() {
  return <svg className="working-ring" aria-hidden="true" focusable="false">
    <rect className="working-ring-track" />
    <rect className="working-ring-trace" pathLength="100" />
  </svg>;
}
