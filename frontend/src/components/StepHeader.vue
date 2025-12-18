<template>
  <div class="mb-4 md:mb-5">
    <div class="text-gray-500 text-sm">{{ step }}</div>
    <h2 class="text-xl font-semibold mt-1">{{ title }}</h2>
  </div>
</template>
<script setup lang="ts">
defineProps<{ step: string; title: string }>();
</script>