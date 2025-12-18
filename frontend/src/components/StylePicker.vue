<template>
  <div class="grid gap-4">
    <!-- 面试时长 -->
    <div class="border rounded-lg p-4">
      <div class="font-medium mb-2">{{ t.duration }}</div>
      <div class="flex flex-col gap-2 text-sm text-gray-700">
        <label class="inline-flex items-center gap-2">
          <input type="radio" value="15" v-model="duration" />
          <span>15 分钟 <span class="text-gray-500">· 快速演练</span></span>
        </label>
        <label class="inline-flex items-center gap-2">
          <input type="radio" value="30" v-model="duration" />
          <span>30 分钟 <span class="text-gray-500">· 标准流程</span></span>
        </label>
      </div>
    </div>

    <!-- 面试官角色 -->
    <div class="border rounded-lg p-4">
      <div class="font-medium mb-2">{{ t.interviewerRole }}</div>
      <div class="flex flex-col gap-3 text-sm text-gray-700">
        <label class="inline-flex items-start gap-2">
          <input type="radio" value="HR" v-model="role" />
          <span>
            <span class="font-medium">{{ t.hr }} 面试官</span>
            <div class="text-gray-500">侧重考察企业文化匹配度、稳定性、软性素质及薪资期望。</div>
          </span>
        </label>
        <label class="inline-flex items-start gap-2">
          <input type="radio" value="业务负责人" v-model="role" />
          <span>
            <span class="font-medium">业务负责人 <span class="ml-1 rounded-sm bg-gray-900 text-white text-[11px] px-1.5 py-0.5 align-middle">推荐</span></span>
            <div class="text-gray-500">侧重考察专业能力、项目细节深挖、业务理解及解决问题的能力。</div>
          </span>
        </label>
      </div>
    </div>

    <!-- 面试风格 -->
    <div class="border rounded-lg p-4">
      <div class="font-medium mb-2">{{ t.style }}</div>
      <div class="flex flex-wrap gap-4 text-sm text-gray-700">
        <label class="inline-flex items-center gap-2"><input type="radio" value="友好" v-model="style" /> {{ t.friendly }}</label>
        <label class="inline-flex items-center gap-2"><input type="radio" value="中性" v-model="style" /> {{ t.neutral }}</label>
        <label class="inline-flex items-center gap-2"><input type="radio" value="严格" v-model="style" /> {{ t.strict }}</label>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue';
const props = defineProps<{ t:any }>();
const emit = defineEmits<{ (e:'change', v:{duration:number, role:string, style:string}): void }>();
const duration = ref(30);
const role = ref('业务负责人');
const style = ref('中性');
watch([duration, role, style], () => emit('change', { duration: Number(duration.value), role: role.value, style: style.value }), { immediate: true });
</script>