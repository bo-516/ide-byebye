<script setup>
import { computed, ref } from 'vue';
import Sidebar from './components/Sidebar.vue';
import TodoHeader from './components/TodoHeader.vue';
import AddTask from './components/AddTask.vue';
import TaskItem from './components/TaskItem.vue';

// Every element carries a compiled-in data-insp-path (source file:line:col),
// so ⌘ + clicking any of them jumps to the matching Vue SFC location.
const INITIAL_TASKS = [
  { id: 1, text: 'Finish the quarterly report', done: false, priority: 'high', tag: 'work' },
  { id: 2, text: 'Review pull request #128', done: false, priority: 'medium', tag: 'dev' },
  { id: 3, text: 'Morning workout', done: true, priority: 'low', tag: 'health' },
  { id: 4, text: 'Buy groceries for the week', done: false, priority: 'medium', tag: 'home' },
  { id: 5, text: 'Call the dentist back', done: true, priority: 'low', tag: 'personal' },
  { id: 6, text: 'Plan the weekend trip', done: false, priority: 'low', tag: 'personal' },
];

const FILTERS = ['All', 'Active', 'Completed'];

const tasks = ref([...INITIAL_TASKS]);
const filter = ref('All');

const toggle = (id) => {
  tasks.value = tasks.value.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
};
const remove = (id) => {
  tasks.value = tasks.value.filter((t) => t.id !== id);
};
const add = (text) => {
  tasks.value = [
    { id: Date.now(), text, done: false, priority: 'medium', tag: 'inbox' },
    ...tasks.value,
  ];
};
const clearDone = () => {
  tasks.value = tasks.value.filter((t) => !t.done);
};

const visible = computed(() =>
  tasks.value.filter((t) =>
    filter.value === 'All' ? true : filter.value === 'Active' ? !t.done : t.done,
  ),
);
const doneCount = computed(() => tasks.value.filter((t) => t.done).length);
</script>

<template>
  <div class="app">
    <Sidebar />
    <main class="main">
      <TodoHeader :total="tasks.length" :done="doneCount" />
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
        <span>{{ tasks.length - doneCount }} items left</span>
        <button class="link-btn" type="button" @click="clearDone">Clear completed</button>
      </footer>
    </main>
  </div>
</template>
