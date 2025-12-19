<!-- src/pages/Setup.vue -->
<template>
  <div class="container">
    <!-- 步骤1：完善背景信息 -->
    <StepHeader :step="t.step" :title="t.header" />
    <div class="grid gap-4">
      <UploadCard :t="t" @uploaded="onUploaded" @parsed="onParsed" />

      <div v-if="resumeReady" class="border rounded-lg p-3 bg-green-50 text-sm text-green-800">
        简历已解析完成，可继续填写岗位信息并开始面试。
      </div>
      <div v-else class="border rounded-lg p-3 bg-yellow-50 text-sm text-yellow-800">
        请先上传并完成简历解析。
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
        <textarea v-model="jd" rows="5"
          class="w-full border rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
        >1. 负责B端SaaS产品的规划与设计；
2. 具备优秀的数据分析能力，能通过数据驱动业务迭代；
3. 优秀的跨部门沟通协作能力。</textarea>
      </label>

      <!-- 简历要点预览（来自 UploadCard 的 parsed 结果） -->
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
      <div v-if="!resumeReady" class="text-xs text-red-600 mt-2">需要简历解析完成后才能开始面试。</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import StepHeader from '../components/StepHeader.vue';
import UploadCard from '../components/UploadCard.vue';
import StylePicker from '../components/StylePicker.vue';
import LoadingHint from '../components/LoadingHint.vue';
import { ref } from 'vue';
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

// 新增：前端保存解析状态与预览
const resumeReady = ref(false);
const summaryPreview = ref<any>(null);

function onUploaded(url: string){ fileUrl.value = url; }
function onParsed(summary: any) {
  summaryPreview.value = summary || null;
  resumeReady.value = !!summary;
}

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