import { FocusTimer } from './FocusTimer.jsx';

/**
 * Sidebar — list/tag navigation plus focus timer.
 * @param {object} props
 * @param {{ id: string, icon: string, label: string }[]} props.lists
 * @param {string} props.activeList
 * @param {string[]} props.tags
 * @param {string | null} props.activeTag
 * @param {Record<string, number>} props.counts
 * @param {(id: string) => void} props.onSelectList
 * @param {(tag: string | null) => void} props.onSelectTag
 * @param {() => void} props.onAddList
 */
export function Sidebar({
  lists,
  activeList,
  tags,
  activeTag,
  counts,
  onSelectList,
  onSelectTag,
  onAddList,
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-logo">✓</span>
        <span className="brand-name">
          Task<b>Flow</b>
        </span>
      </div>

      <nav className="menu">
        <p className="menu-cap">My Lists</p>
        {lists.map((item) => (
          <a
            key={item.id}
            href="#"
            className={`list-item ${activeList === item.id ? 'is-active' : ''}`}
            onClick={(e) => {
              e.preventDefault();
              onSelectList(item.id);
            }}
          >
            <span className="list-icon">{item.icon}</span>
            <span className="list-label">{item.label}</span>
            <span className="list-count">{counts[item.id] ?? 0}</span>
          </a>
        ))}

        <p className="menu-cap">Tags</p>
        <div className="tag-row">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`tag ${activeTag === tag ? 'is-active' : ''}`}
              onClick={() => onSelectTag(activeTag === tag ? null : tag)}
            >
              #{tag}
            </button>
          ))}
        </div>
      </nav>

      <FocusTimer />

      <button className="btn btn-primary btn-block" type="button" onClick={onAddList}>
        + New List
      </button>
    </aside>
  );
}
