export function TodoHeader({ title = 'Today', total, done }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <header className="todo-head">
      <div className="todo-head-row">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-sub">Hold ⌘ and click any element to jump to its source</p>
        </div>
        <div className="progress-badge">
          <span className="progress-num">
            {done}/{total}
          </span>
          <span className="progress-cap">done</span>
        </div>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </header>
  );
}
