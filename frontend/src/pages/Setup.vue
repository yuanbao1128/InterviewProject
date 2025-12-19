<!-- src/pages/Setup.vue -->
<template>
  <div class="container">
    <!-- 步骤1：完善背景信息 -->
    <StepHeader :step="t.step" :title="t.header" />
    <div class="grid gap-4">
      <UploadCard :t="t" @uploaded="onUploaded" @parsed="onParsed" />

      <!-- 解析状态提示 -->
      <div v-if="resumeReady" class="border rounded-lg p-3 bg-green-50 text-sm text-green-800">
        简历已解析完成，可继续填写岗位信息并开始面试。
      </div>
      <div v-else class="border rounded-lg p-3 bg-yellow-50 text-sm text-yellow-800">
        <div class="flex items-start gap-2">
          <div class="flex-1">
            <div class="font-medium">请先上传并完成简历解析。</div>
            <div class="text-xs mt-1 text-yellow-900/80">
              上传后系统会自动解析。若网络波动导致中断，您可以点击“重新检测”继续轮询解析状态。
            </div>
            <div v-if="parseError" class="text-xs mt-1 text-red-600">
              解析任务失败：{{ parseError }} <button class="underline" @click="retryProbe">重新检测</button>
            </div>
          </div>
          <div class="text-xs text-gray-600">
            <template v-if="parseTaskId">
              <div>任务ID：{{ parseTaskId.slice(0,8) }}…</div>
              <div>状态：<span class="font-medium">{{ humanStatus(parseStatus) }}</span></div>
            </template>
            <template v-else>
              <div>状态：<span class="font-medium">未开始</span></div>
            </template>
          </div>
        </div>
      </div>

      <label class="block">
        <div class="mb-1 font-medium">{{ t.company }}</div>
        <input v-model="company" class="w-full border rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-gray-900/10" />
      </label>

      <label class="block">
        <div class="mb-1 font-medium">{{ t.role }}</div>
        <input v-model="role" class="w-full border rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-gray-900/10" />
      </label>

      <label class="block">
        <div class="mb-1 font-medium">{{ t.jd }}</div>
        <textarea
          v-model="jd"
          rows="5"
          class="w-full border rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
        >1. 负责B端SaaS产品的规划与设计；
2. 具备优秀的数据分析能力，能通过数据驱动业务迭代；
3. 优秀的跨部门沟通协作能力。</textarea>
      </label>

      <!-- 简历要点预览（来自解析结果） -->
      <div v-if="summaryPreview" class="border rounded-lg p-3 bg-gray-50">
        <div class="font-medium mb-1">简历要点预览</div>
        <div class="text-sm text-gray-700 whitespace-pre-line">
          • {{ (summaryPreview.highlights || []).join('\n• ') || '—' }}
        </div>
        <div class="text-xs text-gray-500 mt-1">技能：{{ (summaryPreview.skills || []).join('、') || '—' }}</div>
      </div>
    </div>

    <!-- 步骤2：定制面试风格 -->
    <StepHeader :step="t.step2" :title="t.styleHeader" class="mt-8" />
    <StylePicker :t="t" @change="v => style = v" />

    <div class="mt-6">
      <LoadingHint v-if="loading" />
      <button
        :disabled="loading || !resumeReady"
        class="inline-flex items-center rounded-md bg-gray-900 disabled:opacity-60 text-white px-5 py-2.5 hover:bg-black"
        @click="start"
      >
        {{ t.start }}
      </button>
      <div v-if="!resumeReady" class="text-xs text-red-600 mt-2">
        需要简历解析完成后才能开始面试。
        <template v-if="parseTaskId && (parseStatus === 'pending' || parseStatus === 'running')">
          正在等待解析完成（{{ pollInfoText }}）。
          <button class="underline ml-1" @click="retryProbe">重新检测</button>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import StepHeader from '../components/StepHeader.vue';
import UploadCard from '../components/UploadCard.vue';
import StylePicker from '../components/StylePicker.vue';
import LoadingHint from '../components/LoadingHint.vue';
import { onBeforeUnmount, ref, computed } from 'vue'; // 修复：补充 computed
import { useApp } from '../stores/app';
import { useRouter } from 'vue-router';
import zh from '../i18n/zh.json';

const t = zh.setup;
const store = useApp();
const router = useRouter();

const fileUrl = ref('');
const company = ref('');
const role = ref('');
const jd = ref('');
const style = ref<{duration:number, role:string, style:string}>({ duration:30, role:'业务负责人', style:'中性' });
const loading = ref(false);

// 新增：解析任务轮询状态
type ParseStatus = 'idle' | 'pending' | 'running' | 'succeeded' | 'failed';
const resumeReady = ref(false);
const summaryPreview = ref<any>(null);

const parseTaskId = ref<string | null>(null);
const parseStatus = ref<ParseStatus>('idle');
const parseError = ref<string | null>(null);

let pollTimer: number | null = null;
const POLL_INTERVAL_MS = 1500;
const MAX_POLL_MINUTES = 8;
const pollStartedAt = ref<number | null>(null);

function humanStatus(s: ParseStatus) {
  switch (s) {
    case 'idle': return '未开始';
    case 'pending': return '排队中';
    case 'running': return '解析中';
    case 'succeeded': return '已完成';
    case 'failed': return '失败';
    default: return s;
  }
}

const pollInfoText = computed(() => {
  if (!pollStartedAt.value) return '等待中';
  const ms = Date.now() - pollStartedAt.value;
  const sec = Math.max(1, Math.floor(ms / 1000));
  return `已等待 ${sec}s`;
});

// UploadCard 回调：文件上传完成
function onUploaded(url: string){
  fileUrl.value = url;
  // 若此前有任务状态，重置到未开始
  if (!parseTaskId.value) {
    parseStatus.value = 'idle';
    parseError.value = null;
  }
}

// UploadCard 回调：服务端触发解析并在完成时回调 parsed
function onParsed(payload: any) {
  // 情况 A：直接给出解析结果
  if (payload && typeof payload === 'object' && (payload.summary || payload.highlights || payload.skills || Array.isArray(payload?.projects))) {
    summaryPreview.value = payload || null;
    resumeReady.value = !!payload;
    parseStatus.value = 'succeeded';
    parseError.value = null;
    return;
  }
  // 情况 B：给出了 taskId
  if (payload && typeof payload === 'object' && payload.taskId) {
    parseTaskId.value = String(payload.taskId);
    parseStatus.value = 'pending';
    parseError.value = null;
    startPolling(); // 开始轮询
    return;
  }
}

// 手动重新检测/创建任务
async function retryProbe() {
  try {
    parseError.value = null;
    if (!parseTaskId.value) {
      if (!fileUrl.value) {
        parseError.value = '尚未上传简历文件';
        return;
      }
      const res = await fetch('/api/parse-resume/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileUrl: fileUrl.value, interviewId: store.interviewId || null })
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || '无法创建解析任务');
      }
      parseTaskId.value = data.taskId;
      parseStatus.value = 'pending';
    }
    startPolling(true);
  } catch (e: any) {
    parseError.value = e?.message || String(e);
  }
}

function startPolling(force = false) {
  if (pollTimer && !force) return;
  stopPolling();
  pollStartedAt.value = Date.now();
  pollTimer = window.setInterval(checkStatus, POLL_INTERVAL_MS);
  // 立即触发一次，提升响应
  checkStatus();
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function checkStatus() {
  if (!parseTaskId.value) return;
  if (parseStatus.value === 'succeeded' || parseStatus.value === 'failed') {
    stopPolling();
    return;
  }
  // 超时保护
  if (pollStartedAt.value) {
    const minutes = (Date.now() - pollStartedAt.value) / 60000;
    if (minutes > MAX_POLL_MINUTES) {
      parseStatus.value = 'failed';
      parseError.value = `解析超时（>${MAX_POLL_MINUTES}分钟）`;
      stopPolling();
      return;
    }
  }
  try {
    const url = `/api/parse-resume-task/status?taskId=${encodeURIComponent(parseTaskId.value)}`;
    const res = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' }, cache: 'no-store' });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || '状态查询失败');
    }
    const s = (data.status || 'pending') as ParseStatus;
    parseStatus.value = s;

    if (s === 'succeeded') {
      const parsed = data.data || null;
      summaryPreview.value = parsed;
      resumeReady.value = !!parsed;
      parseError.value = null;
      stopPolling();
    } else if (s === 'failed') {
      parseError.value = data.error || '解析失败';
      stopPolling();
    }
  } catch (e: any) {
    parseError.value = e?.message || '网络错误';
  }
}

onBeforeUnmount(() => {
  stopPolling();
});

async function start(){
  try {
    loading.value = true;
    await store.start({
      targetCompany: company.value,
      targetRole: role.value,
      jdText: jd.value,
      resumeFileUrl: fileUrl.value || null,
      role: style.value.role,
      style: style.value.style,
      duration: style.value.duration
    });
    await store.fetchQuestion();
    await router.push({ path: `/interview/${store.interviewId}` });
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.container {
  @apply max-w-3xl mx-auto p-4;
}
</style>