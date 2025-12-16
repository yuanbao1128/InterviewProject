import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { prettyJSON } from 'hono/pretty-json';
import upload from './routes/upload';
import parseResume from './routes/parse-resume';
import startInterview from './routes/start-interview';
import nextQuestion from './routes/next-question';
import submitAnswer from './routes/submit-answer';
import finish from './routes/finish';
import report from './routes/report';
import metrics from './routes/metrics';

const app = new Hono();

app.use('*', cors());
app.use('*', prettyJSON());

app.route('/api', upload);
app.route('/api', parseResume);
app.route('/api', startInterview);
app.route('/api', nextQuestion);
app.route('/api', submitAnswer);
app.route('/api', finish);
app.route('/api', report);
app.route('/api', metrics);

export default app;