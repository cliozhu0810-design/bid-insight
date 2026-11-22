const config=require('../../config');
Page({
 data:{src:'',failed:false},
 onLoad(){
  if(!/^https:\/\/[^/?#]+(?:\/[^?#]*)?$/.test(config.analysisUrl)){this.setData({failed:true});return}
  this.setData({src:config.analysisUrl+'?edition=free'});
 },
 failed(){this.setData({failed:true,src:''})},
 back(){wx.navigateBack({fail:()=>wx.reLaunch({url:'/pages/home/home'})})}
});
