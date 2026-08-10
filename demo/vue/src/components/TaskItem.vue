<script setup>
defineProps({
  task: { type: Object, required: true },
});
defineEmits(['toggle', 'remove']);
</script>

<template>
  <li class="task" :class="{ 'is-done': task.done }">
    <button
      class="check"
      type="button"
      aria-label="toggle task"
      @click="$emit('toggle', task.id)"
    >
      ✓
    </button>
    <span class="task-text">{{ task.text }}</span>
    <span class="pri" :class="`pri-${task.priority}`">{{ task.priority }}</span>
    <span class="task-tag">#{{ task.tag }}</span>
    <button
      class="task-del"
      type="button"
      aria-label="delete task"
      @click="$emit('remove', task.id)"
    >
      ✕
    </button>
  </li>
</template>
