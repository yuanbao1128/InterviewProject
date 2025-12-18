<template>
  <div class="container">
    <div class="text-center py-12 md:py-16">
      <h1 class="text-3xl md:text-4xl font-bold tracking-tight">AI 面试练习助手</h1>
      <p class="text-gray-600 mt-3 text-lg">开启你的 AI 模拟面试之旅</p>
      <p class="text-gray-500 mt-1">针对转岗与跨行业求职者，提供接近真实的面试演练与专业反馈。</p>
      <button
        class="mt-8 inline-flex items-center rounded-md bg-gray-900 hover:bg-black text-white px-5 py-3"
        @click="$router.push('/setup')"
      >
        开始练习
      </button>
    </div>
  </div>
</template>