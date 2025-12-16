<template>
  <div class="container">
    <StepHeader :step="t.step" :title="t.header" />
    <UploadCard :t="t" @uploaded="onUploaded" />
    <div class="grid gap-3 mt-4">
      <label class="block">
        <div class="mb-1">{{ t.company }}</div>
        <input v-model="company" class="w-full border rounded p-2" />
      </label>
      <label class="block">
        <div class="mb-1">{{ t.role }}</div>
        <input v-model="role" class="w-full border rounded p-2" />
      </label>
      <label class="block">
        <div class="mb-1">{{ t.jd }}</div>
        <textarea v-model="jd" class="w-full border rounded p-2" rows="5">1. 负责B端SaaS产品的规划与设计；
2. 具备优秀的数据分析能力，能通过数据驱动业务迭代；
3. 优秀的跨部门沟通协作能力。</textarea>
      </label>
    </div>

    <StepHeader :step="t.step2" :title="t.styleHeader" class="mt-6" />
    <StylePicker :t="t" @change="v => style = v" />

    <div class="mt-6">
      <LoadingHint v-if="loading" />
      <button :disabled="loading" class="bg-blue-600 text-white px-4 py-2 rounded" @click="start">{{ t.start }}</button>
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
import zh from '../i18n/zh.json';

const t = zh.setup;
const store = useApp();

const fileUrl = ref('');
const company = ref('');
const role = ref('');
const jd = ref('');
const style = ref<{duration:number, role:string, style:string}>({ duration:30, role:'业务负责人', style:'中性' });
const loading = ref(false);

function onUploaded(url: string){ fileUrl.value = url; }

async function start(){
  loading.value = true;
  // 简化：不做PDF解析，这里直接把JD作为上下文；你可在后续接入 parse-resume
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
  loading.value = false;
  // 跳转到面试
  history.pushState({}, '', `/interview/${store.interviewId}`);
  window.location.assign(`/interview/${store.interviewId}`);
}
</script>