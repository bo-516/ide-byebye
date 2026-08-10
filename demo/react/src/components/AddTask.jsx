import { useState } from 'react';

export function AddTask({ onAdd, filters, active, onFilter }) {
  const [text, setText] = useState('');

  const submit = (e) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    onAdd(value);
    setText('');
  };

  return (
    <div className="add-block">
      <form className="add-form" onSubmit={submit}>
        <input
          className="add-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a new task…"
        />
        <button className="btn btn-primary" type="submit">
          Add
        </button>
      </form>
      <div className="filters">
        {filters.map((name) => (
          <button
            key={name}
            type="button"
            className={`filter-btn ${active === name ? 'is-active' : ''}`}
            onClick={() => onFilter(name)}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}
