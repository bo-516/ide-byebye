<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';

// Auto-running Pomodoro so rrweb recordings capture continuous DOM motion.
const SESSION_SECONDS = 25 * 60;
const RING_R = 26;
const RING_C = 2 * Math.PI * RING_R;

const left = ref(SESSION_SECONDS);
const running = ref(true);
let timerId = null;

const tick = () => {
  left.value = left.value <= 1 ? SESSION_SECONDS : left.value - 1;
};

watch(
  running,
  (isRunning) => {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    if (isRunning) {
      timerId = setInterval(tick, 1000);
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  if (timerId) clearInterval(timerId);
});

const mm = computed(() => String(Math.floor(left.value / 60)).padStart(2, '0'));
const ss = computed(() => String(left.value % 60).padStart(2, '0'));
const dashOffset = computed(() => RING_C * (1 - left.value / SESSION_SECONDS));
</script>

<template>
  <section class="focus" aria-label="focus timer">
    <div class="focus-ring">
      <svg class="focus-svg" viewBox="0 0 64 64" aria-hidden="true">
        <circle class="focus-ring-track" cx="32" cy="32" :r="RING_R" />
        <circle
          class="focus-ring-prog"
          cx="32"
          cy="32"
          :r="RING_R"
          :style="{ strokeDasharray: RING_C, strokeDashoffset: dashOffset }"
        />
      </svg>
      <span class="focus-time">{{ mm }}:{{ ss }}</span>
    </div>

    <div class="focus-body">
      <p class="focus-cap">
        <span class="focus-dot" :class="{ 'is-live': running }" />
        {{ running ? 'Focusing' : 'Paused' }}
      </p>
      <p class="focus-task">Finish the quarterly report</p>
    </div>

    <button
      class="focus-btn"
      type="button"
      :aria-label="running ? 'pause focus timer' : 'start focus timer'"
      @click="running = !running"
    >
      {{ running ? '❚❚' : '▶' }}
    </button>
  </section>
</template>
