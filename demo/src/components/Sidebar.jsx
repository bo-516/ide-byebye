const LISTS = [
  { icon: '◷', label: 'Today', count: 6, active: true },
  { icon: '◍', label: 'Upcoming', count: 4 },
  { icon: '★', label: 'Personal', count: 3 },
  { icon: '▣', label: 'Work', count: 8 },
];

const TAGS = ['design', 'urgent', 'ideas'];

export function Sidebar() {
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
        {LISTS.map((item) => (
          <a key={item.label} href="#" className={`list-item ${item.active ? 'is-active' : ''}`}>
            <span className="list-icon">{item.icon}</span>
            <span className="list-label">{item.label}</span>
            <span className="list-count">{item.count}</span>
          </a>
        ))}

        <p className="menu-cap">Tags</p>
        <div className="tag-row">
          {TAGS.map((tag) => (
            <span key={tag} className="tag">
              #{tag}
            </span>
          ))}
        </div>
      </nav>

      <button className="btn btn-primary btn-block" type="button">
        + New List
      </button>
    </aside>
  );
}
