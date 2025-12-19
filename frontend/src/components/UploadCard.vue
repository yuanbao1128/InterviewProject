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

const props = defineProps<{ t?: Record<string, any> }>();
const emit = defineEmits<{
  (e: 'uploaded', url: string): void;
  (e: 'parsed', payload: { taskId: string }): void;
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const fileName = ref('');
const uploading = ref(false);

type UIStatus = 'idle' | 'uploading' | 'task-started' | 'failed';
const uiStatus = ref<UIStatus>('idle');
const error = ref<string>('');

// 仅作展示
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
    'bg-yellow-50 border-yellow-200 text-yellow-800':
      uiStatus.value === 'idle' || uiStatus.value === 'uploading',
    'bg-blue-50 border-blue-200 text-blue-800': uiStatus.value === 'task-started',
    'bg-red-50 border-red-200 text-red-800': uiStatus.value === 'failed',
  };
});

function triggerFile() {
  fileInput.value?.click();
}

// 从上传响应中提取 filePath（与后端统一：data.filePath）
function selectFilePathFromUploadResp(resp: any): string {
  if (resp?.data?.filePath && typeof resp.data.filePath === 'string') return resp.data.filePath;
  if (resp?.filePath && typeof resp.filePath === 'string') return resp.filePath;
  // 兼容其它常见字段（容错）
  const url = resp?.url || resp?.fileUrl || resp?.location || resp?.path || '';
  return typeof url === 'string' ? url : '';
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;
  const file = input.files[0];
  fileName.value = file.name;

  try {
    uploading.value = true;
    uiStatus.value = 'uploading';
    error.value = '';

    // 1) 上传
    const form = new FormData();
    form.append('file', file);

    const uploadRes = await fetch('/api/upload', { method: 'POST', body: form });
    let uploadJson: any = null;
    try {
      uploadJson = await uploadRes.json();
    } catch {
      // 不再对同一个 Response 进行 text() 读取，直接抛出统一错误，避免 body stream already read
      throw new Error('上传失败：服务端未返回有效的 JSON');
    }
    if (!uploadRes.ok || !uploadJson?.ok) {
      throw new Error(uploadJson?.error || '上传失败');
    }

    const filePath = selectFilePathFromUploadResp(uploadJson);
    if (!filePath) throw new Error('上传成功但未返回文件路径 filePath');

    emit('uploaded', filePath);

    // 2) 创建解析任务
    const startRes = await fetch('/api/parse-resume-task/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resumeFileUrl: filePath }),
    });

    let startJson: any = null;
    try {
      startJson = await startRes.json();
    } catch {
      throw new Error('创建解析任务失败：服务端未返回有效的 JSON');
    }

    const taskId = startJson?.data?.taskId || startJson?.taskId;
    if (!startRes.ok || !startJson?.ok || !taskId) {
      throw new Error(startJson?.error || '无法创建解析任务');
    }

    uiStatus.value = 'task-started';
    emit('parsed', { taskId: String(taskId) });
  } catch (e: any) {
    console.error('[UploadCard] error', e);
    error.value = e?.message || '发生错误';
    uiStatus.value = 'failed';
  } finally {
    uploading.value = false;
  }
}
</script>

<style scoped>
/* 保持简洁，样式跟随父页 */
</style>