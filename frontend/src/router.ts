import { createRouter, createWebHistory } from 'vue-router';
import Home from './pages/Home.vue';
import Setup from './pages/Setup.vue';
import Interview from './pages/Interview.vue';
import Report from './pages/Report.vue';
import History from './pages/History.vue';

const routes = [
  { path: '/', component: Home },
  { path: '/setup', component: Setup },
  { path: '/interview/:id', component: Interview, props: true },
  { path: '/report/:id', component: Report, props: true },
  { path: '/history', component: History }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

export default router;