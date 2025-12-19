<!-- src/components/UploadCard.vue -->
<template>
  <div class="border rounded-lg p-4">
    <div class="font-medium mb-2">{{ t.uploadTitle || '上传简历' }}</div>

    <div class="flex items-center gap-3">
      <input ref="fileInput" class="hidden" type="file" accept=".pdf,.doc,.docx,.txt" @change="onFileChange" />
      <button
        class="px-3 py-1.5 rounded-md bg-gray-900 text-white hover:bg-black disabled:opacity-60"
        :disabled="uploading"
        @click="triggerFile"
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
            上传后系统会自动创建“解析任务”。若网络波动导致中断，可在 Setup 页面点击“重新检测”继续轮询解析状态。
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

const props = defineProps<{ t: any }>();
const emit = defineEmits<{
  (e: 'uploaded', url: string): void
  (e: 'parsed', payload: any): void
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const fileName = ref('');
const uploading = ref(false);

type UIStatus = 'idle' | 'uploading' | 'task-started' | 'failed';
const uiStatus = ref<UIStatus>('idle');
const error = ref<string | null>(null);

const statusText = computed(() => {
  switch (uiStatus.value) {
    case 'idle': return '未开始';
    case 'uploading': return '上传中…';
    case 'task-started': return '已创建解析任务';
    case 'failed': return '失败';
    default: return '—';
  }
});
const statusClass = computed(() => {
  return {
    'bg-yellow-50 border-yellow-200 text-yellow-800': uiStatus.value === 'idle' || uiStatus.value === 'uploading',
    'bg-blue-50 border-blue-200 text-blue-800': uiStatus.value === 'task-started',
    'bg-red-50 border-red-200 text-red-800': uiStatus.value === 'failed',
  };
});

function triggerFile() {
  fileInput.value?.click();
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;
  const file = input.files[0];
  fileName.value = file.name;

  // 1) 上传文件到后端
  try {
    uploading.value = true;
    uiStatus.value = 'uploading';
    error.value = null;

    const form = new FormData();
    form.append('file', file);

    const res = await fetch('/api/upload', { method: 'POST', body: form });
    // 兼容文本错误响应，避免 JSON.parse 抛错
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      const txt = await res.text();
      throw new Error(`上传失败：${txt?.slice(0, 200) || '未知错误'}`);
    }
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || '上传失败');
    }

    // 从响应里取文件地址（兼容不同后端字段）
    const url = data.url || data.fileUrl || data.path || data.location || '';
    if (!url) throw new Error('上传成功但未返回文件地址');

    // 通知父组件：文件已上传
    emit('uploaded', url);

    // 2) 创建解析任务（新的任务制接口）
    // 请确保你的后端已实现 POST /api/parse-resume/start
    const startRes = await fetch('/api/parse-resume/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileUrl: url })
    });

    let startData: any = null;
    try {
      startData = await startRes.json();
    } catch {
      const txt = await startRes.text();
      throw new Error(`创建解析任务失败：${txt?.slice(0, 200) || '未知错误'}`);
    }

    if (!startRes.ok || !startData?.ok || !startData?.taskId) {
      throw new Error(startData?.error || '无法创建解析任务');
    }

    uiStatus.value = 'task-started';

    // 3) 把任务ID抛给父组件（Setup.vue 会开启轮询）
    emit('parsed', { taskId: String(startData.taskId) });
  } catch (e: any) {
    console.error('[UploadCard] error', e);
    error.value = e?.message || '发生错误';
    uiStatus.value = 'failed';

    // 兼容兜底：如后端暂未提供 /start 接口，可回退到“同步解析”以不阻断用户
    // 但这会再次遇到 Vercel 10s 限制，强烈建议尽快完成任务制接口
    // try {
    //   const parseRes = await fetch('/api/parse-resume', {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ fileUrl: url })
    //   });
    //   const parsed = await parseRes.json();
    //   if (!parseRes.ok || !parsed?.ok) throw new Error(parsed?.error || '解析失败');
    //   emit('parsed', parsed.data);
    // } catch {}
  } finally {
    uploading.value = false;
  }
}
</script>

<style scoped>
/* 保持简洁，样式跟随父页 */
</style>