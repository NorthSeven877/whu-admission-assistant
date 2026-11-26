import { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Textarea, Button } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import classnames from 'classnames';
import { useChatStore } from '@/store/chatStore';
import MessageBubble from '@/components/MessageBubble';
import BrandMark from '@/components/BrandMark';
import { questions, QuestionItem } from '@/data/questions';
import styles from './index.module.scss';

const ALL_QUESTIONS = questions.flatMap((group) => group.items);
const QUICK_QUESTIONS = ['q1', 'q2', 'q14', 'q9', 'q12', 'q8']
  .map((id) => ALL_QUESTIONS.find((question) => question.id === id))
  .filter((question): question is QuestionItem => !!question);
const CATEGORIES = ['通知公告', '招生政策', '保送生', '艺术类招生', '高水平运动队', '高水平艺术团', '强基计划', '农村学生自强计划', '港澳台招生'];
const isWeb = process.env.TARO_ENV === 'h5';

function openSource(url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  if (isWeb) window.open(url, '_blank', 'noopener,noreferrer');
  else Taro.setClipboardData({ data: url });
}

export default function ChatPage() {
  const { current, sessions, streaming, sendMessage, cancel, newSession, openSession } = useChatStore();
  const [input, setInput] = useState('');
  const [leftOpen, setLeftOpen] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef(0);
  const messages = current?.messages || [];
  const latest = messages[messages.length - 1];
  const sources = (messages.find((message) => message.id === selectedId) ?? latest)?.sources || [];

  useEffect(() => {
    setScrollTop(++scrollRef.current * 100000);
  }, [current?.convUid, messages.length, latest?.content, latest?.trace?.length]);

  useDidShow(() => {
    if (useChatStore.getState().streaming) return;
    const pending = Taro.getStorageSync('whu_pending_question');
    if (pending?.text) {
      Taro.removeStorageSync('whu_pending_question');
      setSelectedId(undefined);
      sendMessage(pending.text);
    }
  });

  const ask = (text: string) => {
    const question = text.trim();
    if (!question || streaming) return;
    setInput('');
    setSelectedId(undefined);
    sendMessage(question);
  };

  const toggleDirectory = () => {
    const width = isWeb ? window.innerWidth : Taro.getSystemInfoSync().windowWidth;
    if (width >= 768) setLeftCollapsed(!leftCollapsed);
    else { setLeftOpen(!leftOpen); setRightOpen(false); }
  };

  const toggleSources = (messageId?: string) => {
    setLeftOpen(false);
    setSelectedId(messageId);
    setRightOpen(messageId ? true : !rightOpen);
  };

  return (
    <View className={classnames('whuChat', styles.page, { [styles.leftCollapsed]: leftCollapsed })}
      style={isWeb ? undefined : { height: Taro.getSystemInfoSync().windowHeight + 'px' }}>
      {(leftOpen || rightOpen) && (
        <View className={styles.backdrop} onClick={() => { setLeftOpen(false); setRightOpen(false); }} />
      )}
      <View className={classnames(styles.leftSidebar, { [styles.drawerOpen]: leftOpen })}>
        <View className={styles.brand}><BrandMark size={64} /><Text className={styles.brandTitle}>武大招生助手</Text></View>
        <Button className={styles.newChat} disabled={streaming} onClick={() => {
          newSession(); setSelectedId(undefined); setLeftOpen(false); setRightOpen(false); setInput('');
        }}>新对话</Button>
        <Text className={styles.sideHeading}>问题分类</Text>
        <ScrollView scrollY className={styles.sidebarScroll}>
          {CATEGORIES.map((name) => (
            <View key={name} className={styles.category} onClick={() => {
              setInput('请介绍武汉大学' + name + '的相关信息，并注明年份和来源。');
              setLeftOpen(false);
            }}>
              <Text>{name}</Text><Text className={styles.categoryArrow}>›</Text>
            </View>
          ))}
          <Text className={styles.sectionLabel}>最近对话</Text>
          {sessions.slice(0, 8).map((session) => (
            <View key={session.convUid}
              className={classnames(styles.session, { [styles.sessionActive]: current?.convUid === session.convUid })}
              onClick={() => {
                if (streaming) return;
                openSession(session.convUid);
                setSelectedId(undefined);
                setLeftOpen(false);
              }}>{session.title}</View>
          ))}
          {!sessions.length && <Text className={styles.emptyHistory}>暂无历史对话</Text>}
        </ScrollView>
        <View className={styles.sideFooter}>
          <Text onClick={() => Taro.switchTab({ url: '/pages/questions/index' })}>题库</Text>
          <Text onClick={() => Taro.switchTab({ url: '/pages/mine/index' })}>连接设置</Text>
        </View>
      </View>

      <View className={styles.workspace}>
        <View className={styles.topbar}>
          <View className={styles.titleGroup}>
            <Button className={styles.menuButton} onClick={toggleDirectory}>目录</Button>
            <Text className={styles.topTitle}>{current?.title || '招生咨询'}</Text>
          </View>
          <Button className={styles.sourcesToggle} onClick={() => toggleSources()}>
            参考资料{sources.length ? ' · ' + sources.length : ''}
          </Button>
        </View>

        {messages.length ? (
          <ScrollView scrollY className={styles.messageScroll} scrollTop={scrollTop} scrollWithAnimation>
            <View className={styles.messageList}>
              {messages.map((message, index) => (
                <MessageBubble key={message.id} message={message}
                  streaming={streaming && index === messages.length - 1 && message.role === 'assistant'}
                  onSourcesClick={toggleSources} />
              ))}
            </View>
          </ScrollView>
        ) : (
          <ScrollView scrollY className={styles.emptyScroll}>
            <View className={styles.welcome}>
              <Text className={styles.welcomeTitle}>武汉大学招生咨询</Text>
              <Text className={styles.welcomeDesc}>查询历年分数、位次与招生计划，了解招生政策和报考流程。</Text>
              <View className={styles.quickList}>
                {QUICK_QUESTIONS.map((question) => (
                  <Button key={question.id} className={styles.quickCard} onClick={() => ask(question.question)}>
                    <Text className={styles.cardQuestion}>{question.question}</Text>
                    <Text className={styles.cardArrow}>↗</Text>
                  </Button>
                ))}
              </View>
            </View>
          </ScrollView>
        )}

        <View className={styles.composerArea}>
          <View className={styles.composer}>
            <Textarea className={styles.textarea} value={input} onInput={(event) => setInput(event.detail.value)}
              placeholder="问问招生政策、分数位次或招生计划…" placeholderClass={styles.placeholder}
              autoHeight maxlength={1500} cursorSpacing={16} adjustPosition showConfirmBar={false}
              confirmType="send" onConfirm={() => ask(input)} />
            <View className={styles.composerBottom}>
              {streaming && <Text className={styles.composerHint}>正在生成回答…</Text>}
              <Button className={styles.sendBtn} disabled={!input.trim() && !streaming}
                onClick={() => streaming ? cancel() : ask(input)}>{streaming ? '停止' : '发送'}</Button>
            </View>
          </View>
        </View>
      </View>

      <View className={classnames(styles.rightSidebar, { [styles.rightExpanded]: rightOpen })}>
        <View className={styles.sourcesHead}>
          <Text>本轮检索资料</Text>
          <Button className={styles.closeSources} onClick={() => setRightOpen(false)}>收起</Button>
        </View>
        <ScrollView scrollY className={styles.evidenceScroll}>
          {sources.length ? sources.map((source, index) => (
            <View key={index} className={styles.sourceCard}>
              <Text className={styles.sourceTag}>{source.kind === 'database' ? '数据库查询' : '文档 ' + (index + 1)}</Text>
              <Text className={styles.sourceTitle}>{source.title}</Text>
              {!!source.date && <Text className={styles.sourceDate}>{source.date}</Text>}
              {!!source.text && <Text className={styles.sourceExcerpt}>{source.text}</Text>}
              {!!source.url && /^https?:\/\//i.test(source.url) && (
                <Button className={styles.sourceLink} onClick={() => openSource(source.url!)}>
                  {isWeb ? '查看原文' : '复制原文链接'}
                </Button>
              )}
            </View>
          )) : <Text className={styles.noSources}>本轮暂无检索资料</Text>}
        </ScrollView>
      </View>
    </View>
  );
}
