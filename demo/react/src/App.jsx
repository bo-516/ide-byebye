import { useState } from 'react';
import { Sidebar } from './components/Sidebar.jsx';
import { TodoHeader } from './components/TodoHeader.jsx';
import { AddTask } from './components/AddTask.jsx';
import { TaskItem } from './components/TaskItem.jsx';

// Every element carries a compiled-in data-insp-path (source file:line:col),
// so ⌘ + clicking any of them jumps to the matching source location.
const INITIAL_TASKS = [
  { id: 1, text: 'Finish the quarterly report', done: false, priority: 'high', tag: 'work' },
  { id: 2, text: 'Review pull request #128', done: false, priority: 'medium', tag: 'dev' },
  { id: 3, text: 'Morning workout', done: true, priority: 'low', tag: 'health' },
  { id: 4, text: 'Buy groceries for the week', done: false, priority: 'medium', tag: 'home' },
  { id: 5, text: 'Call the dentist back', done: true, priority: 'low', tag: 'personal' },
  { id: 6, text: 'Plan the weekend trip', done: false, priority: 'low', tag: 'personal' },
];

const FILTERS = ['All', 'Active', 'Completed'];

export default function App() {
  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [filter, setFilter] = useState('All');

  const toggle = (id) =>
    setTasks((list) => list.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const remove = (id) => setTasks((list) => list.filter((t) => t.id !== id));
  const add = (text) =>
    setTasks((list) => [
      { id: Date.now(), text, done: false, priority: 'medium', tag: 'inbox' },
      ...list,
    ]);
  const clearDone = () => setTasks((list) => list.filter((t) => !t.done));

  const visible = tasks.filter((t) =>
    filter === 'All' ? true : filter === 'Active' ? !t.done : t.done,
  );
  const doneCount = tasks.filter((t) => t.done).length;

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <TodoHeader total={tasks.length} done={doneCount} />
        <AddTask onAdd={add} filters={FILTERS} active={filter} onFilter={setFilter} />
        <ul className="tasks">
          {visible.map((task) => (
            <TaskItem key={task.id} task={task} onToggle={toggle} onRemove={remove} />
          ))}
          {visible.length === 0 && <li className="tasks-empty">Nothing here — enjoy the break ☕</li>}
        </ul>
        <footer className="tasks-foot">
          <span>{tasks.length - doneCount} items left</span>
          <button className="link-btn" type="button" onClick={clearDone}>
            Clear completed
          </button>
        </footer>
      </main>
    </div>
  );
}
