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

function buildPublicUrlFromFilePath(filePath: string) {
  // 如果你的静态文件是通过 /public 或对象存储直链提供，按需拼接
  // 1) 若后端的 /api/upload 返回的文件可通过 /uploads/<filePath> 访问：
  // return `/uploads/${filePath}`;
  // 2) 若返回的是存储桶相对路径，需要你的后端在 /start 中识别 filePath，无需拼 URL
  // 默认返回原始 filePath，让 /start 去识别
  return filePath;
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;
  const file = input.files[0];
  fileName.value = file.name;

  try {
    uploading.value = true;
    uiStatus.value = 'uploading';
    error.value = null;

    // 1) 上传
    const form = new FormData();
    form.append('file', file);

    const res = await fetch('/api/upload', { method: 'POST', body: form });

    // 兼容文本错误响应
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      const txt = await res.text();
      throw new Error(`上传失败：${txt?.slice(0, 200) || '未知错误'}`);
    }
    if (!res.ok || !data?.ok) {
      // 你的示例里是 { ok: true, data: {...} }，也兼容 { ok: true, filePath: ... }
      throw new Error(data?.error || '上传失败');
    }

    // 2) 取文件“可传递给后端”的地址/路径（兼容你的字段）
    // 优先常见字段
    let url: string =
      data.url || data.fileUrl || data.location || data.path || '';

    // 兼容你截图中的结构：{ ok: true, data: { filePath: 'resumes/..pdf', bucket: 'resumes', originalName: '...' } }
    if (!url && data.data && typeof data.data.filePath === 'string') {
      url = buildPublicUrlFromFilePath(data.data.filePath);
    }

    // 有些实现返回 { ok: true, filePath: 'resumes/..pdf' }
    if (!url && typeof data.filePath === 'string') {
      url = buildPublicUrlFromFilePath(data.filePath);
    }

    if (!url) {
      console.warn('[UploadCard] unexpected upload response', data);
      throw new Error('上传成功但未返回文件路径/URL（缺少 url/fileUrl/path/location/data.filePath）');
    }

    // 通知父组件：文件已上传
    emit('uploaded', url);

    // 3) 创建解析任务（任务制接口）
    const startRes = await fetch('/api/parse-resume/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // 后端可以同时接受 { fileUrl } 或 { filePath }，这里统一传 fileUrl 字段承载你返回的“路径或URL”
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
    // 抛出 taskId，Setup.vue 会轮询 /status
    emit('parsed', { taskId: String(startData.taskId) });
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