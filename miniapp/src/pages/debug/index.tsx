
import { useEffect, useRef, useState } from 'react';
import { Button, Text, Textarea, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import MarkdownText from '@/components/MarkdownText';
import TraceTimeline from '@/components/TraceTimeline';
import { streamAdmission } from '@/services/admission';
import { generateId } from '@/utils/storage';
import type { AdmissionMessage, TraceEvent } from '@/types/admission';
import styles from './index.module.scss';

type Turn = {
  id: string;
  question: string;
  answer: string;
  events: TraceEvent[];
  status: 'running' | 'done' | 'error' | 'stopped';
  error?: string;
};

const STATUS: Record<Turn['status'], string> = {
  running: '运行中', done: '完成', error: '失败', stopped: '已停止',
};

export default function DebugPage() {
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [selected, setSelected] = useState<string>();
  const selectedTurn = turns.find((turn) => turn.id === selected);
  const active = turns.find((turn) => turn.status === 'running');
  const request = useRef<{ id: string; abort: () => void }>();
  useEffect(() => () => request.current?.abort(), []);

  const update = (id: string, apply: (turn: Turn) => Turn) => {
    setTurns((current) => current.map((turn) => turn.id === id ? apply(turn) : turn));
  };

  const stop = () => {
    const current = request.current;
    if (!current) return;
    current.abort();
    request.current = undefined;
    update(current.id, (turn) => ({ ...turn, status: 'stopped' }));
  };

  const send = () => {
    const question = input.trim();
    if (!question || request.current) return;
    const id = generateId();
    const history: AdmissionMessage[] = turns.filter((turn) => turn.status === 'done').slice(-6)
      .flatMap((turn) => [
        { role: 'user', content: turn.question },
        { role: 'assistant', content: turn.answer.slice(0, 12000) },
      ]);
    setTurns((previous) => [...previous, { id, question, answer: '', events: [], status: 'running' }]);
    setSelected(id);
    setInput('');
    const finish = (status: 'done' | 'error', error?: string) => {
      request.current = undefined;
      update(id, (turn) => ({ ...turn, status, error }));
    };
    try {
      request.current = {
        id,
        abort: streamAdmission(question, history, {
          onTrace: (event) => update(id, (turn) => ({ ...turn, events: [...turn.events, event] })),
          onAnswer: (answer) => update(id, (turn) => ({ ...turn, answer })),
          onDone: () => finish('done'),
          onError: (error) => finish('error', error.message),
        }, true),
      };
    } catch (error) {
      finish('error', error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <View className={styles.page}>
      <View className={styles.header}>
        <View>
          <Text className={styles.product}>武汉大学招生助手</Text>
          <Text className={styles.title}>ReAct 调试台</Text>
        </View>
        <Button className={styles.secondary} onClick={() => Taro.switchTab({ url: '/pages/chat/index' })}>
          <Text className={styles.secondaryLabel}>返回咨询</Text>
        </Button>
      </View>
      <View className={styles.layout}>
        <View className={styles.panel}>
          <View className={styles.panelHeader}>
            <Text className={styles.panelTitle}>会话</Text>
            <Button className={styles.secondary} disabled={!!active || !turns.length}
              onClick={() => { setTurns([]); setSelected(undefined); }}>
              <Text className={styles.secondaryLabel}>新会话</Text>
            </Button>
          </View>
          <View className={styles.conversation}>
            {!turns.length && <Text className={styles.placeholder}>发送问题后，选择一条提问查看对应的模型与工具记录。</Text>}
            {turns.map((turn) => (
              <View key={turn.id} className={styles.turn}>
                <Button className={turn.id === selected ? styles.selected : styles.question}
                  onClick={() => setSelected(turn.id)}>
                  <Text>{turn.question}</Text>
                  <Text className={styles.turnStatus}>{STATUS[turn.status]}</Text>
                </Button>
                {turn.answer && <MarkdownText content={turn.answer} />}
                {turn.error && <Text className={styles.error}>{turn.error}</Text>}
              </View>
            ))}
          </View>
          <View className={styles.composer}>
            <Textarea className={styles.input} value={input} maxlength={2000}
              placeholder="输入招生问题或追问" onInput={(event) => setInput(event.detail.value)}
              onConfirm={send} confirmType="send" />
            <Button className={styles.primary} onClick={active ? stop : send} disabled={!active && !input.trim()}>
              {active ? '停止' : '发送'}
            </Button>
          </View>
        </View>
        <View className={styles.panel}>
          <View className={styles.panelHeader}>
            <Text className={styles.panelTitle}>调用记录</Text>
            {selectedTurn && <Text className={styles.traceStatus}>{STATUS[selectedTurn.status]}</Text>}
          </View>
          <View className={styles.trace}>
            {selectedTurn?.events.length ? (
              <TraceTimeline key={selectedTurn.id} events={selectedTurn.events} running={selectedTurn.status === 'running'} debug />
            ) : (
              <Text className={styles.placeholder}>{selectedTurn?.status === 'running' ? '正在连接问答服务…' : '模型和工具调用会在这里显示。'}</Text>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}
