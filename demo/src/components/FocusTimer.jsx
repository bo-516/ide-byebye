import { useEffect, useState } from 'react';

// A focus block lasts 25 minutes; when it hits zero the timer loops back to a
// full block so a recording of any length always captures movement.
const SESSION_SECONDS = 25 * 60;

// SVG ring geometry. The progress circle animates via stroke-dashoffset, so we
// need its circumference (2πr) to map "fraction remaining" onto a dash length.
const RING_R = 26;
const RING_C = 2 * Math.PI * RING_R;

/**
 * FocusTimer — an auto-running, Pomodoro-style countdown pinned in the sidebar.
 *
 * Why it exists: the rest of the demo only changes when the user acts, so an
 * rrweb recording of an idle page is a single static frame. This widget mutates
 * the DOM every second (the MM:SS label, the ring's stroke-dashoffset, the live
 * pulse), giving the recorder a continuous time-series to capture even when
 * nobody touches the page — which is the whole point the recording demonstrates.
 *
 * It starts running on mount and restarts at zero so any recording window shows
 * motion. The play/pause button keeps it interactive for anyone driving by hand.
 */
export function FocusTimer() {
  const [left, setLeft] = useState(SESSION_SECONDS);
  const [running, setRunning] = useState(true);

  // Tick once per second while running; loop back to a full block at zero.
  // Re-subscribes whenever `running` flips so pause/resume cleanly start/stop
  // the interval. Returns the cleanup that clears it to avoid duplicate timers.
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => {
      setLeft((s) => (s <= 1 ? SESSION_SECONDS : s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  // Offset grows as the block depletes, so the stroke retreats over the session.
  const dashOffset = RING_C * (1 - left / SESSION_SECONDS);

  return (
    <section className="focus" aria-label="focus timer">
      <div className="focus-ring">
        <svg className="focus-svg" viewBox="0 0 64 64" aria-hidden="true">
          <circle className="focus-ring-track" cx="32" cy="32" r={RING_R} />
          <circle
            className="focus-ring-prog"
            cx="32"
            cy="32"
            r={RING_R}
            style={{ strokeDasharray: RING_C, strokeDashoffset: dashOffset }}
          />
        </svg>
        <span className="focus-time">
          {mm}:{ss}
        </span>
      </div>

      <div className="focus-body">
        <p className="focus-cap">
          <span className={`focus-dot ${running ? 'is-live' : ''}`} />
          {running ? 'Focusing' : 'Paused'}
        </p>
        <p className="focus-task">Finish the quarterly report</p>
      </div>

      <button
        className="focus-btn"
        type="button"
        onClick={() => setRunning((r) => !r)}
        aria-label={running ? 'pause focus timer' : 'start focus timer'}
      >
        {running ? '❚❚' : '▶'}
      </button>
    </section>
  );
}
