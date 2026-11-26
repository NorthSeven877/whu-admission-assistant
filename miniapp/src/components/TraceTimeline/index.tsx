
import { useState } from 'react';
import { Button, Text, View } from '@tarojs/components';
import type { TraceEvent } from '@/types/admission';
import styles from './index.module.scss';

type Round = {
  number: number;
  start?: Extract<TraceEvent, { type: 'model.start' }>;
  result?: Extract<TraceEvent, { type: 'model.result' }>;
  tools: {
    start: Extract<TraceEvent, { type: 'tool.start' }>;
    result?: Extract<TraceEvent, { type: 'tool.result' }>;
  }[];
};

function fold(events: TraceEvent[]): Round[] {
  const rounds = new Map<number, Round>();
  for (const event of events) {
    let round = rounds.get(event.round);
    if (!round) {
      round = { number: event.round, tools: [] };
      rounds.set(event.round, round);
    }
    if (event.type === 'model.start') round.start = event;
    if (event.type === 'model.result') round.result = event;
    if (event.type === 'tool.start') round.tools.push({ start: event });
    if (event.type === 'tool.result') {
      const tool = round.tools.find(({ start }) => start.id === event.id);
      if (tool) tool.result = event;
    }
  }
  return Array.from(rounds.values());
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`;
const pretty = (data: unknown) => JSON.stringify(data, null, 2);

function Disclosure({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <View className={styles.disclosure}>
      <Button className={styles.toggle} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Text className={styles.caret}>{open ? '▾' : '▸'}</Text>
        <Text>{title}</Text>
      </Button>
      {open && <View className={styles.details}>{children}</View>}
    </View>
  );
}

function DataBlock({ label, value }: { label: string; value: string }) {
  return (
    <View className={styles.block}>
      <Text className={styles.label}>{label}</Text>
      <Text className={styles.payload} selectable>{value}</Text>
    </View>
  );
}

export default function TraceTimeline({ events, running, debug = false }: {
  events: TraceEvent[];
  running: boolean;
  debug?: boolean;
}) {
  const rounds = fold(events);
  if (!rounds.length) return null;
  if (!debug) {
    const summaries = rounds.filter(({ result }) => result?.summary);
    if (!summaries.length && !running) return null;
    return (
      <View className={styles.compact}>
        {summaries.map(({ number, result }) => (
          <Text className={styles.summary} key={number}>{result?.summary}</Text>
        ))}
        {!summaries.length && <Text className={styles.meta}>正在规划任务…</Text>}
      </View>
    );
  }
  return (
    <View className={styles.timeline}>
      {rounds.map(({ number, start, result, tools }) => (
        <View className={styles.round} key={number}>
          <Text className={styles.heading}>第 {number} 轮 · {number === 1 ? '规划任务' : '检查资料与决定下一步'}</Text>
          {result?.summary && <Text className={styles.summary}>{result.summary}</Text>}
          {result?.error && <Text className={styles.failure}>{result.error}</Text>}
          {!result && <Text className={styles.meta}>{running ? '等待模型输出' : '调用已结束'}</Text>}
          {start?.messages && (
            <Disclosure title={`模型输入 · ${start.model} · ${start.messages.length} 条消息`}>
              {start.messages.map((message, index) => (
                <DataBlock key={index} label={`${index + 1} · ${message.role}`} value={message.content} />
              ))}
            </Disclosure>
          )}
          {result && (
            <Disclosure title={`模型输出 · ${seconds(result.elapsed_ms)}${result.finish_reason ? ` · ${result.finish_reason}` : ''}`}>
              <DataBlock label="公开输出" value={result.output || result.error || '空输出'} />
            </Disclosure>
          )}
          {result?.reasoning ? (
            <Disclosure title="内部推理">
              <DataBlock label="模型服务返回的推理内容" value={result.reasoning} />
            </Disclosure>
          ) : result && <Text className={styles.meta}>本轮未返回原生推理内容</Text>}
          {tools.map(({ start: call, result: observation }) => {
            const title = call.tool === 'sql_query' ? '查询 PostgreSQL' : '检索 GraphRAG';
            const outcome = observation ? (observation.result.error ? '失败' : '完成') : running ? '运行中' : '已结束';
            return (
              <Disclosure key={call.id} title={`${title} · ${outcome}${observation ? ` · ${seconds(observation.elapsed_ms)}` : ''}`}>
                <DataBlock label={call.tool === 'sql_query' ? '模型提交的 SQL' : '检索词'} value={call.input} />
                {call.command !== call.input && <DataBlock label="执行语句" value={call.command} />}
                {observation && (
                  <DataBlock label={observation.executed ? '工具返回' : '校验结果'}
                    value={observation.result.saved === false ? '结果正文仅在当次运行中可展开。' : pretty(observation.result)} />
                )}
              </Disclosure>
            );
          })}
        </View>
      ))}
    </View>
  );
}
