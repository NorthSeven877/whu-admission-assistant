import Taro from '@tarojs/taro';
import { Button, View, Text } from '@tarojs/components';
import classnames from 'classnames';
import { ChatMessage } from '@/types/chat';
import MarkdownText from '@/components/MarkdownText';
import BrandMark from '@/components/BrandMark';
import TraceTimeline from '@/components/TraceTimeline';
import styles from './index.module.scss';

interface Props {
  message: ChatMessage;
  streaming?: boolean;
  onSourcesClick?: (messageId: string) => void;
}

export default function MessageBubble({ message, streaming, onSourcesClick }: Props) {
  // 系统提示：居中浅色小胶囊（模式切换等）
  if (message.role === 'system') {
    return (
      <View className={styles.noticeRow}>
        <Text className={styles.noticeText}>{message.content}</Text>
      </View>
    );
  }

  const isUser = message.role === 'user';

  return (
    <View
      className={classnames(styles.messageRow, {
        [styles.userRow]: isUser,
        [styles.assistantRow]: !isUser,
      })}
    >
      {!isUser && (
        <View className={styles.avatarSlot}>
          <BrandMark size={64} />
        </View>
      )}

      <View className={styles.bubbleWrap}>
        <View
          className={classnames(styles.bubble, {
            [styles.userBubble]: isUser,
            [styles.assistantBubble]: !isUser,
            [styles.errorBubble]: message.error,
          })}
        >
          {isUser ? (
            <Text className={styles.userText}>{message.content}</Text>
          ) : (
            <View className={styles.assistantContent}>
              {!!message.trace?.length && (
                <TraceTimeline events={message.trace} running={!!streaming} />
              )}
              {message.content ? (
                <MarkdownText content={message.content} />
              ) : streaming && !message.trace?.length ? (
                <View className={styles.typing}>
                  <View className={styles.dot} />
                  <View className={styles.dot} />
                  <View className={styles.dot} />
                  <Text className={styles.typingHint}>
                    正在连接问答服务…
                  </Text>
                </View>
              ) : null}
              {streaming && !!message.content && (
                <View className={styles.cursor} />
              )}
            </View>
          )}
        </View>
        {!isUser && !!message.content && !message.error && !streaming && (
          <View className={styles.answerActions}>
            <Button className={styles.answerAction}
              onClick={() => Taro.setClipboardData({ data: message.content })}>复制回答</Button>
            {!!message.sources?.length && onSourcesClick && (
              <Button className={styles.answerAction} onClick={() => onSourcesClick(message.id)}>
                查看 {message.sources.length} 条资料
              </Button>
            )}
            {typeof message.seconds === 'number' && <Text>{message.seconds} 秒</Text>}
          </View>
        )}
      </View>

      {isUser && (
        <View className={classnames(styles.avatar, styles.avatarUser)}>
          <Text className={styles.avatarText}>我</Text>
        </View>
      )}
    </View>
  );
}
