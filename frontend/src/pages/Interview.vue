<template>
  <div class="container min-h-screen">
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
import { useRoute, useRouter } from 'vue-router';
import ChatPanel from '../components/ChatPanel.vue';

const store = useApp();
const route = useRoute();
const router = useRouter();

onMounted(async () => {
  const idFromRoute = route.params.id as string | undefined;
  if (idFromRoute && idFromRoute !== store.interviewId) {
    store.interviewId = idFromRoute;
  }
  try {
    if (!store.question) {
      await store.fetchQuestion();
    }
  } catch (e) {
    console.error(e);
    router.replace('/setup');
  }
});

async function onAnswered() {
  await store.fetchQuestion();
}
async function onFinish() {
  await store.finish();
  router.push({ path: `/report/${store.interviewId}` });
}
</script>