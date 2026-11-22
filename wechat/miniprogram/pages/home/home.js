const config=require('../../config');
Page({
  data:{error:''},
  start(){
    if(!/^https:\/\/[^/?#]+(?:\/[^?#]*)?$/.test(config.analysisUrl)){
      this.setData({error:'服务尚未开放，请稍后再试。'});return;
    }
    wx.navigateTo({url:'/pages/analysis/analysis',fail:()=>this.setData({error:'暂时无法打开，请重试。'})});
  },
  onShareAppMessage(){return {title:'标鉴 · 标书关联线索分析',path:'/pages/home/home'}}
});
