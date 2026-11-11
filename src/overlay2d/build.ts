// 蓄力段二维层（16 拍，墨黑底）。Claude 新增（2026-10-12）。
// 隧道铺满整个画面，背景板不会露出来；按用户“少文字”的方向不放计数和百分比，所以这里什么都不画。
import { createStage } from './stage';

export function createBuildOverlay() {
  const stage = createStage();
  return { masks: stage.masks, render: () => stage.clear() };
}
