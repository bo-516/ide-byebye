import { useMemo, useState } from 'react';
import { Sidebar } from './components/Sidebar.jsx';
import { TodoHeader } from './components/TodoHeader.jsx';
import { AddTask } from './components/AddTask.jsx';
import { TaskItem } from './components/TaskItem.jsx';

// Every element carries a compiled-in data-insp-path (source file:line:col),
// so ⌘ + clicking any of them jumps to the matching source location.
const INITIAL_LISTS = [
  { id: 'today', icon: '◷', label: 'Today' },
  { id: 'upcoming', icon: '◍', label: 'Upcoming' },
  { id: 'personal', icon: '★', label: 'Personal' },
  { id: 'work', icon: '▣', label: 'Work' },
];

const INITIAL_TASKS = [
  { id: 1, text: 'Finish the quarterly report', done: false, priority: 'high', tag: 'work', list: 'work' },
  { id: 2, text: 'Review pull request #128', done: false, priority: 'medium', tag: 'dev', list: 'work' },
  { id: 3, text: 'Morning workout', done: true, priority: 'low', tag: 'health', list: 'today' },
  { id: 4, text: 'Buy groceries for the week', done: false, priority: 'medium', tag: 'home', list: 'today' },
  { id: 5, text: 'Call the dentist back', done: true, priority: 'low', tag: 'personal', list: 'personal' },
  { id: 6, text: 'Plan the weekend trip', done: false, priority: 'low', tag: 'personal', list: 'upcoming' },
];

const FILTERS = ['All', 'Active', 'Completed'];
const TAGS = ['work', 'dev', 'health', 'home', 'personal'];

export default function App() {
  const [lists, setLists] = useState(INITIAL_LISTS);
  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [filter, setFilter] = useState('All');
  const [activeList, setActiveList] = useState('today');
  const [activeTag, setActiveTag] = useState(null);

  const toggle = (id) =>
    setTasks((list) => list.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const remove = (id) => setTasks((list) => list.filter((t) => t.id !== id));
  const add = (text) =>
    setTasks((list) => [
      {
        id: Date.now(),
        text,
        done: false,
        priority: 'medium',
        tag: activeTag || 'inbox',
        list: activeList,
      },
      ...list,
    ]);
  const clearDone = () => setTasks((list) => list.filter((t) => !t.done));

  const selectList = (id) => {
    setActiveList(id);
    setActiveTag(null);
  };
  const selectTag = (tag) => setActiveTag(tag);
  const addList = () => {
    const label = window.prompt('New list name');
    const name = label?.trim();
    if (!name) return;
    const id = `list-${Date.now()}`;
    setLists((prev) => [...prev, { id, icon: '◇', label: name }]);
    setActiveList(id);
    setActiveTag(null);
  };

  const counts = useMemo(
    () => Object.fromEntries(lists.map((l) => [l.id, tasks.filter((t) => t.list === l.id).length])),
    [lists, tasks],
  );

  const visible = tasks.filter((t) => {
    if (t.list !== activeList) return false;
    if (activeTag && t.tag !== activeTag) return false;
    if (filter === 'Active') return !t.done;
    if (filter === 'Completed') return t.done;
    return true;
  });

  const listTitle = lists.find((l) => l.id === activeList)?.label ?? 'Tasks';
  const doneCount = visible.filter((t) => t.done).length;
  const leftCount = tasks.filter((t) => t.list === activeList && !t.done).length;

  return (
    <div className="app">
      <Sidebar
        lists={lists}
        activeList={activeList}
        tags={TAGS}
        activeTag={activeTag}
        counts={counts}
        onSelectList={selectList}
        onSelectTag={selectTag}
        onAddList={addList}
      />
      <main className="main">
        <TodoHeader title={listTitle} total={visible.length} done={doneCount} />
        <AddTask onAdd={add} filters={FILTERS} active={filter} onFilter={setFilter} />
        <ul className="tasks">
          {visible.map((task) => (
            <TaskItem key={task.id} task={task} onToggle={toggle} onRemove={remove} />
          ))}
          {visible.length === 0 && <li className="tasks-empty">Nothing here — enjoy the break ☕</li>}
        </ul>
        <footer className="tasks-foot">
          <span>{leftCount} items left</span>
          <button className="link-btn" type="button" onClick={clearDone}>
            Clear completed
          </button>
        </footer>
      </main>
    </div>
  );
}
