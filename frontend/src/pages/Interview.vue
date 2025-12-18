<template>
  <div class="container">
    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-2 my-4">
      <div class="text-gray-700">
        {{ store.role }} <span class="mx-1 text-gray-300">|</span> 风格: {{ store.style }} <span class="mx-1 text-gray-300">|</span> 状态: 提问中
      </div>
      <div class="flex items-center gap-4 text-sm text-gray-500">
        <span>{{ store.timeDisplay() }}</span>
        <span>进度: 第 {{ store.current }}/{{ store.total }} 题</span>
      </div>
    </div>

    <ChatPanel
      :style="store.style"
      :total="store.total"
      :current="store.current"
      :question="store.question"
      @answered="onAnswered"
      @finish="onFinish"
    />

    <div class="text-xs text-gray-500 mt-2">面试开始于 {{ store.startedAt }}</div>
    <div class="text-xs text-gray-500 mt-1">AI 可能会产生不准确的信息</div>
  </div>
</template>
<script setup lang="ts">
import { onMounted } from 'vue';
import { useApp } from '../stores/app';
import ChatPanel from '../components/ChatPanel.vue';

const store = useApp();
onMounted(async () => {
  if (!store.question) await store.fetchQuestion();
});
async function onAnswered() {
  await store.fetchQuestion();
}
async function onFinish() {
  await store.finish();
  window.location.assign(`/report/${store.interviewId}`);
}
</script>