<template>
  <div class="border rounded-lg p-4 flex flex-col min-h-[70vh]">
    <div class="text-sm text-gray-600 mb-2">
      风格: {{ style }} <span class="mx-1 text-gray-300">|</span> 状态: 提问中
    </div>

    <!-- 可滚动消息区：flex-1 + min-h-0 -->
    <div ref="scrollArea" class="flex-1 min-h-0 overflow-auto space-y-4 pr-1">
      <!-- 历史按顺序渲染：面试官 -> 我 的一组视为一轮 -->
      <template v-for="item in history" :key="item.id">
        <div class="space-y-1">
          <div class="text-gray-600 text-sm">面试官</div>
          <div class="bg-gray-100 p-3 rounded-md whitespace-pre-line leading-relaxed">{{ item.question }}</div>
        </div>
        <div v-if="item.answer" class="space-y-1">
          <div class="text-gray-600 text-sm">我</div>
          <div class="bg-blue-50 p-3 rounded-md whitespace-pre-line leading-relaxed">{{ item.answer }}</div>
        </div>
      </template>

      <!-- 当前题（如果还未被加入历史里或未回答） -->
      <div v-if="question && (history.length === 0 || history[history.length-1]?.questionId !== question.id)">
        <div class="text-gray-600 text-sm mb-1">面试官</div>
        <div class="bg-gray-100 p-3 rounded-md whitespace-pre-line leading-relaxed">{{ question.text }}</div>
      </div>
    </div>

    <div class="mt-3 flex gap-2">
      <input
        v-model="input"
        :disabled="sending"
        class="flex-1 border rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-gray-900/10 disabled:opacity-60"
        placeholder="请输入你的回答（建议≤300字，尽量量化指标）"
        @keydown.enter.exact.prevent="send"
      />
      <button
        class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-md disabled:opacity-60"
        :disabled="sending || !input.trim()"
        @click="send"
      >
        {{ sending ? '发送中…' : '发送' }}
      </button>
      <button class="bg-gray-700 hover:bg-gray-800 text-white px-3 py-2 rounded-md" @click="$emit('finish')">结束面试</button>
    </div>

    <div class="text-xs text-gray-500 mt-2">进度: 第 {{ current }}/{{ total }} 题</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { useApp } from '../stores/app';

const props = defineProps<{ style: string; total: number; current: number; question: any }>();
const emit = defineEmits<{ (e: 'answered'): void; (e: 'finish'): void }>();

const store = useApp();
const input = ref('');
const sending = ref(false);

// 每轮问答的历史（仅用于前端展示，不影响后端数据）
type Turn = { id: string; questionId: string; question: string; answer?: string };
const history = ref<Turn[]>([]);
const scrollArea = ref<HTMLDivElement | null>(null);

// 当问题变化时，把新问题追加到历史（避免覆盖）
watch(
  () => props.question?.id,
  async (id) => {
    if (!id || !props.question) return;
    const last = history.value[history.value.length - 1];
    if (!last || last.questionId !== props.question.id) {
      history.value.push({
        id: `${props.question.id}`,
        questionId: props.question.id,
        question: props.question.text
      });
      await nextTick();
      autoScroll();
    }
  },
  { immediate: true }
);

function autoScroll() {
  const el = scrollArea.value;
  if (el) el.scrollTop = el.scrollHeight;
}

async function send() {
  if (sending.value) return;
  const text = input.value.trim();
  if (!text) return;
  sending.value = true;
  try {
    // 前端先显示我的回答
    const last = history.value[history.value.length - 1];
    if (last && !last.answer) {
      last.answer = text;
    } else {
      // 兜底：若没有当前题，也追加一条“未知题”的回答
      history.value.push({ id: String(Date.now()), questionId: store.question?.id || '', question: store.question?.text || '（题目）', answer: text });
    }
    autoScroll();

    await store.submitAnswer(text, 1);
    input.value = '';

    // 若已经为最后一题，自动结束并进入报告
    if (store.current >= store.total) {
      emit('finish');
    } else {
      emit('answered');
    }
  } finally {
    sending.value = false;
    await nextTick();
    autoScroll();
  }
}
</script>