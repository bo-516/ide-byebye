export function TaskItem({ task, onToggle, onRemove }) {
  return (
    <li className={`task ${task.done ? 'is-done' : ''}`}>
      <button
        className="check"
        type="button"
        onClick={() => onToggle(task.id)}
        aria-label="toggle task"
      >
        ✓
      </button>
      <span className="task-text">{task.text}</span>
      <span className={`pri pri-${task.priority}`}>{task.priority}</span>
      <span className="task-tag">#{task.tag}</span>
      <button
        className="task-del"
        type="button"
        onClick={() => onRemove(task.id)}
        aria-label="delete task"
      >
        ✕
      </button>
    </li>
  );
}
