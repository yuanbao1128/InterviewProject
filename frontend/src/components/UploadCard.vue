<!-- src/components/UploadCard.vue -->
<template>
  <div class="border rounded-lg p-4">
    <div class="font-medium mb-2">{{ t?.uploadTitle || '上传简历' }}</div>

    <div class="flex items-center gap-3">
      <input
        ref="fileInput"
        class="hidden"
        type="file"
        accept=".pdf,.doc,.docx,.txt"
        @change="onFileChange"
      />
      <button
        class="px-3 py-1.5 rounded-md bg-gray-900 text-white hover:bg-black disabled:opacity-60"
        :disabled="busy"
        @click="fileInput?.click()"
        type="button"
      >
        选择文件
      </button>
      <span v-if="fileName" class="text-xs text-gray-600">已选择：{{ fileName }}</span>
    </div>

    <p class="text-xs text-gray-500 mt-2">
      支持 PDF / Word / TXT，大小 ≤ 10MB（推荐 PDF，优先本地解析，保护隐私）
    </p>

    <div class="mt-3 text-xs">
      <div class="p-2 rounded border" :class="statusClass">
        <div class="flex items-center justify-between">
          <span>
            上传后系统会自动创建“解析任务”。若网络波动中断，可在 Setup 页面点击“重新检测”继续轮询解析状态。
          </span>
          <span>状态：<b>{{ statusText }}</b></span>
        </div>
        <div v-if="error" class="text-red-600 mt-1 break-all">
          {{ error }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useApp } from '@/stores/app';

const props = defineProps<{ t?: any }>();

const fileInput = ref<HTMLInputElement | null>(null);
const fileName = ref('');
const localPhase = ref<'idle' | 'uploading' | 'starting-task'>('idle');
const error = ref<string>('');

const app = useApp();
const { resumeTaskStatus, resumeTaskError } = storeToRefs(app);

const busy = computed(() => localPhase.value !== 'idle' || resumeTaskStatus.value === 'processing' || resumeTaskStatus.value === 'pending');

const statusText = computed(() => {
  if (error.value) return '失败';
  switch (true) {
    case localPhase.value === 'uploading': return '上传中…';
    case localPhase.value === 'starting-task': return '创建任务中…';
  }
  switch (resumeTaskStatus.value) {
    case 'pending': return '排队中…';
    case 'processing': return '解析中…';
    case 'done': return '已完成';
    case 'error': return '失败';
    default: return '未开始';
  }
});

const statusClass = computed(() => {
  const st = statusText.value;
  if (st.includes('失败')) return 'bg-red-50 border-red-200 text-red-800';
  if (st.includes('完成')) return 'bg-blue-50 border-blue-200 text-blue-800';
  if (st.includes('上传中') || st.includes('创建任务') || st.includes('排队') || st.includes('解析')) {
    return 'bg-yellow-50 border-yellow-200 text-yellow-800';
  }
  return 'bg-gray-50 border-gray-200 text-gray-700';
});

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;
  const file = input.files[0];
  fileName.value = file.name;
  error.value = '';

  try {
    // 1) 上传（通过 Pinia，axios 只读一次 response）
    localPhase.value = 'uploading';
    const filePath = await app.upload(file);

    // 2) 创建解析任务（通过 Pinia，命中 /api/parse-resume-task/start）
    localPhase.value = 'starting-task';
    await app.startResumeParseTask();

    // 3) 立即触发一次轮询（由页面自行决定是否继续 wait）
    await app.pollResumeTaskOnce();

  } catch (e: any) {
    console.error('[UploadCard] error', e);
    error.value = e?.message || resumeTaskError.value || '发生错误';
  } finally {
    localPhase.value = 'idle';
  }
}
</script>

<style scoped>
/* 保持简洁，样式跟随父页 */
</style>