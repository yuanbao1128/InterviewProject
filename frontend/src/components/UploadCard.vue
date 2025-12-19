<!-- src/components/UploadCard.vue -->
<template>
  <div class="border rounded-lg p-4 md:p-5">
    <div class="font-medium mb-2">{{ t.upload }}</div>
    <div class="flex items-center gap-3">
      <input type="file" class="block" accept=".pdf" @change="onFile" />
      <span v-if="fileName" class="text-sm text-gray-700">{{ fileName }}</span>
    </div>
    <div class="text-sm text-gray-500 mt-2">
      {{ t.uploadHint }} · 支持最大 10MB（推荐 PDF，优先本地解析，保护隐私）
    </div>

    <div class="mt-3 text-sm">
      <div v-if="status === 'idle'" class="text-gray-500">待上传简历</div>
      <div v-else-if="status === 'uploading'" class="text-gray-600">上传中…</div>
      <div v-else-if="status === 'extracting'" class="text-gray-600">本地解析文本中…</div>
      <div v-else-if="status === 'summarizing'" class="text-gray-600">简历要点提炼中…</div>
      <div v-else-if="status === 'done'" class="text-green-700">解析完成</div>
      <div v-else-if="status === 'error'" class="text-red-600">解析失败：{{ errorMsg }}</div>
    </div>

    <div v-if="preview" class="mt-3 border rounded p-3 bg-gray-50">
      <div class="font-medium mb-1">简历要点（预览）：</div>
      <div class="text-sm text-gray-700 whitespace-pre-line">
        • {{ (preview.highlights || []).join('\n• ') || '—' }}
      </div>
      <div class="text-xs text-gray-500 mt-1">技能：{{ (preview.skills || []).join('、') || '—' }}</div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { useApp } from '../stores/app';
import { pdfFileToText } from '../utils/pdfClient';

const props = defineProps<{ t: any }>();
const store = useApp();

const fileName = ref('');
const status = ref<'idle'|'uploading'|'extracting'|'summarizing'|'done'|'error'>('idle');
const errorMsg = ref('');
const preview = ref<any>(null);

const emit = defineEmits<{
  (e:'uploaded', url:string): void;
  (e:'parsed', summary:any): void;
}>();

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement;
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  if (file.size > 10 * 1024 * 1024) {
    errorMsg.value = '文件过大，请控制在 10MB 以内';
    status.value = 'error';
    return;
  }
  fileName.value = file.name;

  try {
    status.value = 'uploading';
    const url = await store.upload(file);
    emit('uploaded', url);

    status.value = 'extracting';
    // 1) 前端本地解析 PDF → 文本
    const text = await pdfFileToText(file, { maxPages: 20 });
    if (!text || text.length < 20) {
      throw new Error('无法从 PDF 提取有效文本（可能是扫描件/加密文件）');
    }

    status.value = 'summarizing';
    // 2) 调用后端 /parse-resume 生成结构化摘要（仅传文本）
    const res = await fetch(`${store.baseUrl}/api/parse-resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const j = await res.json();
    if (!j?.ok) {
      throw new Error(j?.error || '摘要生成失败');
    }
    store.setResumeSummary(j.data);
    preview.value = j.data || {};
    status.value = 'done';
    emit('parsed', j.data);
  } catch (e: any) {
    console.error('[uploadCard] parse error', e);
    errorMsg.value = e?.message || String(e);
    status.value = 'error';
  }
}
</script>