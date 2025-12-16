<template>
  <div class="mb-4">
    <div class="text-gray-500">{{ step }}</div>
    <h2 class="text-xl font-semibold">{{ title }}</h2>
  </div>
</template>
<script setup lang="ts">
defineProps<{ step: string; title: string }>();
</script>