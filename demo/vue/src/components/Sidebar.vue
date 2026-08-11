<script setup>
import { computed } from 'vue';
import FocusTimer from './FocusTimer.vue';

const props = defineProps({
  lists: { type: Array, required: true },
  activeList: { type: String, required: true },
  tags: { type: Array, required: true },
  activeTag: { type: String, default: null },
  counts: { type: Object, required: true },
});

const emit = defineEmits(['select-list', 'select-tag', 'add-list']);

const listCounts = computed(() =>
  props.lists.map((item) => ({
    ...item,
    count: props.counts[item.id] ?? 0,
  })),
);

const onSelectList = (e, id) => {
  e.preventDefault();
  emit('select-list', id);
};

const onSelectTag = (tag) => {
  emit('select-tag', props.activeTag === tag ? null : tag);
};
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
        v-for="item in listCounts"
        :key="item.id"
        href="#"
        class="list-item"
        :class="{ 'is-active': activeList === item.id }"
        @click="onSelectList($event, item.id)"
      >
        <span class="list-icon">{{ item.icon }}</span>
        <span class="list-label">{{ item.label }}</span>
        <span class="list-count">{{ item.count }}</span>
      </a>

      <p class="menu-cap">Tags</p>
      <div class="tag-row">
        <button
          v-for="tag in tags"
          :key="tag"
          type="button"
          class="tag"
          :class="{ 'is-active': activeTag === tag }"
          @click="onSelectTag(tag)"
        >
          #{{ tag }}
        </button>
      </div>
    </nav>

    <FocusTimer />

    <button class="btn btn-primary btn-block" type="button" @click="emit('add-list')">
      + New List
    </button>
  </aside>
</template>
