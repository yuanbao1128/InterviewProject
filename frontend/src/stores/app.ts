import { defineStore } from 'pinia';
import axios from 'axios';

type ProgressState = {
  current: number;
  total: number;
  followups_left?: number;
};

export const useApp = defineStore('app', {
  state: () => ({
    interviewId: '' as string,
    total: 0,
    current: 1,
    question: null as any,
    loading: false,
    role: '业务负责人' as string,
    style: '中性' as string,
    duration: 30 as number,
    startedAt: '' as string,
    baseUrl: '', // 同域
    timerSec: 0,
    timerHandle: 0 as any,

    // 全局保存上传后的 Storage 对象键（私有路径）
    resumeFileUrl: '' as string
  }),
  actions: {
    setResumeFileUrl(path: string) {
      this.resumeFileUrl = path || '';
    },
    clearResumeFile() {
      this.resumeFileUrl = '';
    },

    startTimer() {
      if (this.timerHandle) return;
      this.timerHandle = setInterval(() => {
        this.timerSec += 1;
      }, 1000);
    },
    stopTimer() {
      if (this.timerHandle) {
        clearInterval(this.timerHandle);
        this.timerHandle = 0;
      }
    },
    timeDisplay() {
      const mm = String(Math.floor(this.timerSec / 60)).padStart(2, '0');
      const ss = String(this.timerSec % 60).padStart(2, '0');
      return `${mm}:${ss}`;
    },

    async upload(file: File) {
      const form = new FormData();
      form.append('file', file);
      const { data } = await axios.post(`${this.baseUrl}/api/upload`, form);
      if (!data?.ok) throw new Error(data?.error || '上传失败');

      const filePath = data?.data?.filePath as string;
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('上传成功但未返回文件路径 filePath');
      }
      this.setResumeFileUrl(filePath);
      return filePath;
    },

    async start(payload: any) {
      // 保存配置到本地状态
      this.role = payload.role;
      this.style = payload.style;
      this.duration = payload.duration;

      const body: any = {
        targetCompany: payload.targetCompany ?? null,
        targetRole: payload.targetRole ?? null,
        jdText: payload.jdText ?? null,
        role: payload.role,
        style: payload.style,
        duration: payload.duration
      };
      if (typeof this.resumeFileUrl === 'string' && this.resumeFileUrl.trim().length > 0) {
        body.resumeFileUrl = this.resumeFileUrl.trim();
      }

      const { data } = await axios.post(`${this.baseUrl}/api/start-interview`, body);
      if (!data?.ok) throw new Error(data?.error || '启动失败');
      this.interviewId = data.data.interviewId;
      this.total = data.data.total;
      this.current = 1;
      this.startedAt = new Date().toLocaleTimeString();
      this.timerSec = 0;
      this.startTimer();
    },

    async fetchQuestion() {
      const { data } = await axios.get(`${this.baseUrl}/api/next-question`, {
        params: { interviewId: this.interviewId }
      });
      if (!data?.ok) throw new Error(data?.error || '获取题目失败');
      this.question = data.data.question;
      this.current = data.data.question.orderNo;
      this.total = data.data.total || this.total;
    },

    async submitAnswer(content: string, turnNo = 1) {
      const payload = {
        interviewId: this.interviewId,
        questionId: this.question.id,
        turnNo,
        content
      };
      const { data } = await axios.post(`${this.baseUrl}/api/submit-answer`, payload);
      if (!data?.ok) throw new Error(data?.error || '提交失败');
    },

    async finish() {
      this.stopTimer();
      await axios.post(`${this.baseUrl}/api/finish`, { interviewId: this.interviewId });
    },

    async getReport() {
      const { data } = await axios.get(`${this.baseUrl}/api/report`, {
        params: { interviewId: this.interviewId }
      });
      if (!data?.ok) throw new Error(data?.error || '报告获取失败');
      return data.data;
    }
  }
});