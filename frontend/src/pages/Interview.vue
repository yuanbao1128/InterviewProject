<template>
  <div class="container">
    <div class="flex items-center justify-between my-4">
      <div class="text-gray-700">业务负责人 | 风格: 中性 | 状态: 提问中</div>
      <div class="text-sm text-gray-500">进度: 第 {{ store.current }}/{{ store.total }} 题</div>
    </div>
    <ChatPanel :style="'中性'" :total="store.total" :current="store.current" :question="store.question" @answered="onAnswered" @finish="onFinish" />
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
async function onAnswered(){
  if (store.current <= store.total) {
    await store.fetchQuestion();
  } else {
    await onFinish();
  }
}
async function onFinish(){
  await store.finish();
  window.location.assign(`/report/${store.interviewId}`);
}
</script>