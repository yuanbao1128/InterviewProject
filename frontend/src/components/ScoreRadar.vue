<template>
  <div class="border rounded p-4">
    <div class="font-medium mb-2">综合评分：{{ overall ?? '-' }}</div>
    <ul class="list-disc pl-5 text-sm text-gray-700 space-y-1">
      <li>岗位匹配度：{{ dims.match?.score ?? dims.match ?? '-' }}</li>
      <li>逻辑与结构（STAR）：{{ dims.structure?.score ?? dims.structure ?? '-' }}</li>
      <li>专业深度：{{ dims.depth?.score ?? dims.depth ?? '-' }}</li>
      <li>表达清晰度：{{ dims.communication?.score ?? dims.communication ?? '-' }}</li>
      <li>学习与反思：{{ dims.reflection?.score ?? dims.reflection ?? '-' }}</li>
    </ul>
  </div>
</template>
<script setup lang="ts">
defineProps<{ overall: number|null, dims:any }>();
</script>