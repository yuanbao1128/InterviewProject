<template>
  <div class="border rounded p-4">
    <div class="font-medium mb-2">{{ t.upload }}</div>
    <input type="file" @change="onFile" />
    <div class="text-sm text-gray-500 mt-2">{{ t.uploadHint }} | 支持最大 10MB</div>
    <div v-if="fileName" class="text-sm mt-2">{{ fileName }}</div>
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