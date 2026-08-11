<script setup>
import { computed, ref } from 'vue';
import Sidebar from './components/Sidebar.vue';
import TodoHeader from './components/TodoHeader.vue';
import AddTask from './components/AddTask.vue';
import TaskItem from './components/TaskItem.vue';

// Every element carries a compiled-in data-insp-path (source file:line:col),
// so ⌘ + clicking any of them jumps to the matching Vue SFC location.
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

const lists = ref([...INITIAL_LISTS]);
const tasks = ref([...INITIAL_TASKS]);
const filter = ref('All');
const activeList = ref('today');
const activeTag = ref(null);

const toggle = (id) => {
  tasks.value = tasks.value.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
};
const remove = (id) => {
  tasks.value = tasks.value.filter((t) => t.id !== id);
};
const add = (text) => {
  tasks.value = [
    {
      id: Date.now(),
      text,
      done: false,
      priority: 'medium',
      tag: activeTag.value || 'inbox',
      list: activeList.value,
    },
    ...tasks.value,
  ];
};
const clearDone = () => {
  tasks.value = tasks.value.filter((t) => !t.done);
};

const selectList = (id) => {
  activeList.value = id;
  activeTag.value = null;
};
const selectTag = (tag) => {
  activeTag.value = tag;
};
const addList = () => {
  const label = window.prompt('New list name');
  const name = label?.trim();
  if (!name) return;
  const id = `list-${Date.now()}`;
  lists.value = [...lists.value, { id, icon: '◇', label: name }];
  activeList.value = id;
  activeTag.value = null;
};

const counts = computed(() =>
  Object.fromEntries(lists.value.map((l) => [l.id, tasks.value.filter((t) => t.list === l.id).length])),
);

const visible = computed(() =>
  tasks.value.filter((t) => {
    if (t.list !== activeList.value) return false;
    if (activeTag.value && t.tag !== activeTag.value) return false;
    if (filter.value === 'Active') return !t.done;
    if (filter.value === 'Completed') return t.done;
    return true;
  }),
);

const listTitle = computed(
  () => lists.value.find((l) => l.id === activeList.value)?.label ?? 'Tasks',
);
const doneCount = computed(() => visible.value.filter((t) => t.done).length);
const totalVisible = computed(() => visible.value.length);
const leftCount = computed(() =>
  tasks.value.filter((t) => t.list === activeList.value && !t.done).length,
);
</script>

<template>
  <div class="app">
    <Sidebar
      :lists="lists"
      :active-list="activeList"
      :tags="TAGS"
      :active-tag="activeTag"
      :counts="counts"
      @select-list="selectList"
      @select-tag="selectTag"
      @add-list="addList"
    />
    <main class="main">
      <TodoHeader :title="listTitle" :total="totalVisible" :done="doneCount" />
      <AddTask :filters="FILTERS" :active="filter" @add="add" @filter="filter = $event" />
      <ul class="tasks">
        <TaskItem
          v-for="task in visible"
          :key="task.id"
          :task="task"
          @toggle="toggle"
          @remove="remove"
        />
        <li v-if="visible.length === 0" class="tasks-empty">Nothing here — enjoy the break ☕</li>
      </ul>
      <footer class="tasks-foot">
        <span>{{ leftCount }} items left</span>
        <button class="link-btn" type="button" @click="clearDone">Clear completed</button>
      </footer>
    </main>
  </div>
</template>
