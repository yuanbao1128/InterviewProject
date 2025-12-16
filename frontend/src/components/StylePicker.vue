<template>
  <div class="grid gap-4">
    <div>
      <div class="font-medium mb-1">{{ t.duration }}</div>
      <div class="flex gap-3">
        <label><input type="radio" value="15" v-model="duration" /> 15 分钟</label>
        <label><input type="radio" value="30" v-model="duration" /> 30 分钟</label>
      </div>
    </div>
    <div>
      <div class="font-medium mb-1">{{ t.interviewerRole }}</div>
      <div class="flex gap-3">
        <label><input type="radio" value="HR" v-model="role" /> {{ t.hr }}</label>
        <label><input type="radio" value="业务负责人" v-model="role" /> {{ t.biz }}</label>
      </div>
    </div>
    <div>
      <div class="font-medium mb-1">{{ t.style }}</div>
      <div class="flex gap-3">
        <label><input type="radio" value="友好" v-model="style" /> {{ t.friendly }}</label>
        <label><input type="radio" value="中性" v-model="style" /> {{ t.neutral }}</label>
        <label><input type="radio" value="严格" v-model="style" /> {{ t.strict }}</label>
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