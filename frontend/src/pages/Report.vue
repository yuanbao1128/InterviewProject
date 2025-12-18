<template>
  <div class="container">
    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3 my-4">
      <h2 class="text-xl font-semibold">面试评估报告</h2>
      <div class="flex gap-2">
        <button class="bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-md" @click="$router.push('/')">返回首页</button>
        <button class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-md" @click="$router.push('/')">再练一次</button>
      </div>
    </div>

    <div v-if="loading">报告生成中...</div>

    <div v-else class="space-y-6">
      <ScoreRadar :overall="report.overall" :dims="report.dimensions || {}" />

      <div>
        <div class="font-medium mb-1">核心总结</div>
        <p class="text-gray-700 whitespace-pre-line leading-relaxed">{{ report.summary }}</p>
      </div>

      <div>
        <div class="font-medium mb-2">逐题复盘</div>
        <div class="space-y-4">
          <div v-for="(item, idx) in report.items || []" :key="idx" class="border rounded-lg p-3">
            <div class="text-gray-700">Q{{ idx+1 }}: {{ item.question }}</div>
            <div class="text-sm mt-1 text-gray-800">你的回答（摘要）：{{ item.candidate_answer }}</div>
            <div class="text-sm mt-1 text-green-700">亮点：{{ (item.highlights || []).join('；') }}</div>
            <div class="text-sm mt-1 text-red-700">问题：{{ (item.issues || []).join('；') }}</div>
            <div class="text-sm mt-1 text-gray-800">AI 参考回答：{{ item.ai_reference }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useApp } from '../stores/app';
import ScoreRadar from '../components/ScoreRadar.vue';

const store = useApp();
const report = ref<any>({});
const loading = ref(true);

onMounted(async () => {
  const r = await store.getReport();
  report.value = r;
  loading.value = false;
});
</script>