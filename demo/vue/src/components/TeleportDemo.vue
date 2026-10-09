<script setup>
import { ref } from 'vue';
import LibDialog from './LibDialog.vue';

// Teleport cases for the inspector: a hand-written dialog and a library dialog, both rendered into <body>.
const openCase = ref(null);
const toggle = (name) => {
  openCase.value = openCase.value === name ? null : name;
};
const close = () => {
  openCase.value = null;
};
</script>

<template>
  <section class="portal-demo">
    <div class="portal-actions">
      <span class="portal-title">Teleport cases</span>
      <button class="filter-btn" type="button" @click="toggle('hand')">Dialog</button>
      <button class="filter-btn" type="button" @click="toggle('lib')">Library dialog</button>
    </div>
    <Teleport to="body">
      <div v-if="openCase === 'hand'" class="hand-mask" @click.self="close">
        <div class="hand-panel">
          <h3 class="hand-title">Hand-written Teleport</h3>
          <p class="portal-note">Written in TeleportDemo.vue and teleported to body.</p>
          <button class="btn btn-primary" type="button" @click="close">Close</button>
        </div>
      </div>
    </Teleport>
    <LibDialog v-if="openCase === 'lib'" title="Library dialog" @close="close">
      <p class="portal-note">This paragraph is written in TeleportDemo.vue.</p>
    </LibDialog>
  </section>
</template>
