import { useState } from 'react';
import { View, Text, ScrollView, Input, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { getBaseUrl, setBaseUrl } from '@/services/dbgpt';
import { useChatStore } from '@/store/chatStore';
import styles from './index.module.scss';

const DATA_SCOPE = [
  { label: '湖北一分一段表', value: '2018-2025 年' },
  { label: '湖北分专业招生计划', value: '2021-2025 年' },
  { label: '湖北录取分数线', value: '2023-2024 年' },
  { label: '招生政策知识库', value: '620 篇官方文档' },
];

export default function MinePage() {
  const clearAll = useChatStore((s) => s.clearAll);
  const sessions = useChatStore((s) => s.sessions);
  const [baseUrl, setBaseUrlState] = useState(getBaseUrl());

  const handleSaveUrl = () => {
    const url = baseUrl.trim();
    if (!url) {
      Taro.showToast({ title: '地址不能为空', icon: 'none' });
      return;
    }
    setBaseUrl(url);
    Taro.showToast({ title: '已保存', icon: 'success' });
  };

  const handleResetUrl = () => {
    setBaseUrlState('http://127.0.0.1:15670');
    setBaseUrl('http://127.0.0.1:15670');
    Taro.showToast({ title: '已重置为默认', icon: 'success' });
  };

  const handleClearAll = () => {
    Taro.showModal({
      title: '清空历史',
      content: '确定清空所有历史会话吗？此操作不可恢复。',
      confirmColor: '#f53f3f',
      success: (res) => {
        if (res.confirm) {
          clearAll();
          Taro.showToast({ title: '已清空', icon: 'success' });
        }
      },
    });
  };

  return (
    <ScrollView scrollY className={styles.page}>
      <View className={styles.profile}>
        <View className={styles.avatarCircle}>
          <Text className={styles.avatarText}>武</Text>
        </View>
        <Text className={styles.appName}>武大招生咨询</Text>
        <Text className={styles.appDesc}>珞珈山下 · 等你而来</Text>
      </View>

      <View className={styles.section}>
        <Text className={styles.sectionTitle}>服务设置</Text>
        <View className={styles.card}>
          <View className={styles.fieldRow}>
            <Text className={styles.fieldLabel}>后端服务地址</Text>
            <Input
              className={styles.fieldInput}
              value={baseUrl}
              onInput={(e) => setBaseUrlState(e.detail.value)}
              placeholder="http://127.0.0.1:15670"
              placeholderClass={styles.placeholder}
            />
          </View>
          <View className={styles.btnRow}>
            <Button className={styles.primaryBtn} onClick={handleSaveUrl}>
              <Text className={styles.primaryBtnText}>保存</Text>
            </Button>
            <Button className={styles.ghostBtn} onClick={handleResetUrl}>
              <Text className={styles.ghostBtnText}>重置默认</Text>
            </Button>
          </View>
          <Text className={styles.fieldHint}>
            需先启动问答后端（默认端口 15670）
          </Text>
          {process.env.TARO_ENV === 'h5' && (
            <Button className={styles.ghostBtn} onClick={() => Taro.navigateTo({ url: '/pages/debug/index' })}>
              <Text className={styles.ghostBtnText}>打开 ReAct 调试台</Text>
            </Button>
          )}
        </View>
      </View>

      <View className={styles.section}>
        <Text className={styles.sectionTitle}>数据说明</Text>
        <View className={styles.card}>
          {DATA_SCOPE.map((item, idx) => (
            <View
              key={item.label}
              className={`${styles.dataRow} ${idx === DATA_SCOPE.length - 1 ? styles.lastRow : ''}`}
            >
              <Text className={styles.dataLabel}>{item.label}</Text>
              <Text className={styles.dataValue}>{item.value}</Text>
            </View>
          ))}
          <Text className={styles.dataHint}>
            当前数据仅覆盖湖北省，其他省份与年份数据持续补录中
          </Text>
        </View>
      </View>

      <View className={styles.section}>
        <Text className={styles.sectionTitle}>存储管理</Text>
        <View className={styles.card}>
          <View className={styles.storageRow}>
            <View className={styles.storageInfo}>
              <Text className={styles.dataLabel}>历史会话</Text>
              <Text className={styles.dataValue}>{sessions.length} 个会话保存在本机</Text>
            </View>
            <Button className={styles.dangerBtn} onClick={handleClearAll}>
              <Text className={styles.dangerBtnText}>清空历史</Text>
            </Button>
          </View>
        </View>
      </View>

      <View className={styles.footer}>
        <Text className={styles.footerText}>v1.0.0</Text>
        <Text className={styles.footerText}>Powered by DB-GPT + DeepSeek</Text>
      </View>
    </ScrollView>
  );
}
