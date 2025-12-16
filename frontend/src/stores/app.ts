import { defineStore } from 'pinia';
import axios from 'axios';

export const useApp = defineStore('app', {
  state: () => ({
    interviewId: '' as string,
    total: 0,
    current: 1,
    question: null as any,
    loading: false,
    baseUrl: '' // 默认空，Vercel 同域
  }),
  actions: {
    async upload(file: File) {
      const form = new FormData();
      form.append('file', file);
      const { data } = await axios.post(`${this.baseUrl}/api/upload`, form);
      return data.data.fileUrl as string;
    },
    async start(payload: any) {
      const { data } = await axios.post(`${this.baseUrl}/api/start-interview`, payload);
      this.interviewId = data.data.interviewId;
      this.total = data.data.total;
      this.current = 1;
    },
    async fetchQuestion() {
      const { data } = await axios.get(`${this.baseUrl}/api/next-question`, { params: { interviewId: this.interviewId, orderNo: this.current } });
      this.question = data.data.question;
    },
    async submitAnswer(content: string, turnNo = 1) {
      await axios.post(`${this.baseUrl}/api/submit-answer`, { interviewId: this.interviewId, questionId: this.question.id, turnNo, content });
      // 简化：每题仅一轮回答，随后进入下一题
      this.current += 1;
    },
    async finish() {
      await axios.post(`${this.baseUrl}/api/finish`, { interviewId: this.interviewId });
    },
    async getReport() {
      const { data } = await axios.get(`${this.baseUrl}/api/report`, { params: { interviewId: this.interviewId } });
      return data.data;
    }
  }
});