汇总整场面试，生成综合评分（0-10），一段核心总结，维度短评，以及逐题复盘（题目、候选人回答摘要、亮点、问题、AI参考回答示例）。
输出 JSON：{
overall: number,
summary: string,
dimensions: {
match: {score:number, comment:string},
structure: {score:number, comment:string},
depth: {score:number, comment:string},
communication: {score:number, comment:string},
reflection: {score:number, comment:string}
},
items: [{
question: string,
candidate_answer: string,
highlights: string[],
issues: string[],
ai_reference: string
}]
}