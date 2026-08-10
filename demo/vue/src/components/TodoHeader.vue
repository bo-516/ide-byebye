<script setup>
import { computed } from 'vue';

const props = defineProps({
  total: { type: Number, required: true },
  done: { type: Number, required: true },
});

const pct = computed(() => (props.total ? Math.round((props.done / props.total) * 100) : 0));
</script>

<template>
  <header class="todo-head">
    <div class="todo-head-row">
      <div>
        <h1 class="page-title">Today</h1>
        <p class="page-sub">Hold ⌘ and click any element to jump to its Vue source</p>
      </div>
      <div class="progress-badge">
        <span class="progress-num">{{ done }}/{{ total }}</span>
        <span class="progress-cap">done</span>
      </div>
    </div>
    <div class="progress-track">
      <div class="progress-fill" :style="{ width: `${pct}%` }" />
    </div>
  </header>
</template>
