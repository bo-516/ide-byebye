<script setup>
import { ref } from 'vue';

defineProps({
  filters: { type: Array, required: true },
  active: { type: String, required: true },
});

const emit = defineEmits(['add', 'filter']);
const text = ref('');

const submit = (e) => {
  e.preventDefault();
  const value = text.value.trim();
  if (!value) return;
  emit('add', value);
  text.value = '';
};
</script>

<template>
  <div class="add-block">
    <form class="add-form" @submit="submit">
      <input
        v-model="text"
        class="add-input"
        placeholder="Add a new task…"
      />
      <button class="btn btn-primary" type="submit">Add</button>
    </form>
    <div class="filters">
      <button
        v-for="name in filters"
        :key="name"
        type="button"
        class="filter-btn"
        :class="{ 'is-active': active === name }"
        @click="emit('filter', name)"
      >
        {{ name }}
      </button>
    </div>
  </div>
</template>
