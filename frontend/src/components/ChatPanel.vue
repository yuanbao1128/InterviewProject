<template>
  <div class="border rounded p-4 h-[60vh] flex flex-col">
    <div class="text-sm text-gray-500 mb-2">风格: {{ style }} | 状态: 提问中</div>
    <div class="flex-1 overflow-auto space-y-3">
      <div v-if="question">
        <div class="text-gray-600 text-sm">面试官</div>
        <div class="bg-gray-100 p-3 rounded">{{ question.text }}</div>
      </div>
      <div v-for="m in messages" :key="m.id">
        <div class="text-gray-600 text-sm">我</div>
        <div class="bg-blue-50 p-3 rounded">{{ m.text }}</div>
      </div>
    </div>
    <div class="mt-3 flex gap-2">
      <input v-model="input" class="flex-1 border rounded p-2" placeholder="请输入你的回答..." />
      <button class="bg-blue-600 text-white px-3 py-2 rounded" @click="send">发送</button>
      <button class="bg-gray-600 text-white px-3 py-2 rounded" @click="$emit('finish')">结束面试</button>
    </div>
    <div class="text-xs text-gray-500 mt-1">进度: 第 {{ current }}/{{ total }} 题</div>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { useApp } from '../stores/app';

const props = defineProps<{ style: string, total:number, current:number, question:any }>();
const emit = defineEmits<{ (e:'answered'): void, (e:'finish'): void }>();
const store = useApp();
const input = ref('');
const messages = ref<{id:number, text:string}[]>([]);
async function send(){
  if(!input.value.trim()) return;
  const text = input.value.trim();
  messages.value.push({ id: Date.now(), text });
  await store.submitAnswer(text, 1);
  input.value = '';
  emit('answered');
}
</script>