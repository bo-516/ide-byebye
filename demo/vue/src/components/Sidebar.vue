<script setup>
import FocusTimer from './FocusTimer.vue';

const LISTS = [
  { icon: '◷', label: 'Today', count: 6, active: true },
  { icon: '◍', label: 'Upcoming', count: 4 },
  { icon: '★', label: 'Personal', count: 3 },
  { icon: '▣', label: 'Work', count: 8 },
];

const TAGS = ['design', 'urgent', 'ideas'];
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <span class="brand-logo">✓</span>
      <span class="brand-name">Task<b>Flow</b> <small style="font-weight:500;opacity:.6">Vue</small></span>
    </div>

    <nav class="menu">
      <p class="menu-cap">My Lists</p>
      <a
        v-for="item in LISTS"
        :key="item.label"
        href="#"
        class="list-item"
        :class="{ 'is-active': item.active }"
      >
        <span class="list-icon">{{ item.icon }}</span>
        <span class="list-label">{{ item.label }}</span>
        <span class="list-count">{{ item.count }}</span>
      </a>

      <p class="menu-cap">Tags</p>
      <div class="tag-row">
        <span v-for="tag in TAGS" :key="tag" class="tag">#{{ tag }}</span>
      </div>
    </nav>

    <FocusTimer />

    <button class="btn btn-primary btn-block" type="button">+ New List</button>
  </aside>
</template>
