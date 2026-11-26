// 微信小程序 tabBar 仅支持 png/jpg 图标，H5 端继续使用 svg
const isWeapp = process.env.TARO_ENV === 'weapp';
const icon = (name: string) => `assets/tabbar/${name}.${isWeapp ? 'png' : 'svg'}`;

export default defineAppConfig({
  pages: [
    'pages/chat/index',
    'pages/questions/index',
    'pages/history/index',
    'pages/mine/index',
    ...(process.env.TARO_ENV === 'h5' ? ['pages/debug/index'] : []),
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#1b7a4d',
    navigationBarTitleText: '武大招生咨询',
    navigationBarTextStyle: 'white'
  },
  tabBar: {
    color: '#86909c',
    selectedColor: '#1b7a4d',
    backgroundColor: '#ffffff',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/chat/index',
        text: '咨询',
        iconPath: icon('chat'),
        selectedIconPath: icon('chat-selected')
      },
      {
        pagePath: 'pages/questions/index',
        text: '题库',
        iconPath: icon('question'),
        selectedIconPath: icon('question-selected')
      },
      {
        pagePath: 'pages/history/index',
        text: '历史',
        iconPath: icon('history'),
        selectedIconPath: icon('history-selected')
      },
      {
        pagePath: 'pages/mine/index',
        text: '我的',
        iconPath: icon('mine'),
        selectedIconPath: icon('mine-selected')
      }
    ]
  }
});
