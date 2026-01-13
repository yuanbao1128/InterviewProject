// 预留：若未来需要统一 axios 实例或拦截器，这里扩展
// frontend/src/utils/http.ts (如已存在可忽略)
export const API_BASE = (window as any).__API_BASE__ || import.meta.env.VITE_API_BASE || ''