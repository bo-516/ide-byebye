<!-- ide-byebye-ignore — stands in for a component library: nothing in this file is stamped. -->
<script setup>
// Like most library dialogs, the mask, title bar and close button are teleported to <body>, and unknown attributes
// (including the caller's `data-insp-path`) are dropped. Only the slot content comes from stamped user code.
defineOptions({ inheritAttrs: false });
defineProps({ title: { type: String, required: true } });
const emit = defineEmits(['close']);
</script>

<template>
  <Teleport to="body">
    <div class="lib-mask" @click.self="emit('close')">
      <div class="lib-box" role="dialog" :aria-label="title">
        <header class="lib-head">
          <span>{{ title }}</span>
          <button class="lib-close" type="button" aria-label="Close" @click="emit('close')">×</button>
        </header>
        <div class="lib-body"><slot /></div>
      </div>
    </div>
  </Teleport>
</template>
