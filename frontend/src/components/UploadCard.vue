<template>
  <div class="border rounded-lg p-4 md:p-5">
    <div class="font-medium mb-2">{{ t.upload }}</div>
    <div class="flex items-center gap-3">
      <input type="file" class="block" @change="onFile" />
      <span v-if="fileName" class="text-sm text-gray-700">{{ fileName }}</span>
    </div>
    <div class="text-sm text-gray-500 mt-2">
      {{ t.uploadHint }} · 支持最大 10MB
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { useApp } from '../stores/app';
const props = defineProps<{ t: any }>();
const store = useApp();
const fileName = ref('');
const emit = defineEmits<{ (e:'uploaded', url:string): void }>();

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement;
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  fileName.value = file.name;
  const url = await store.upload(file);
  emit('uploaded', url);
}
</script>