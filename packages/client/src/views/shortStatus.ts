/**
 * 对手座位头顶的状态文案：只保留关键公开信息（动作 + 数字），去掉"张""·"等
 * 连接词与单位，避免默认视图被一整句 lastAction 挤满。
 * 完整语句仍保留在座位详情（点名字）与战报记录里，按需查看。
 */
export function shortStatus(lastAction: string): string {
  if (!lastAction) return '';
  return lastAction
    .replace(/同意结束/g, '同意摊牌')
    .replace(/不同意/g, '取消同意')
    .replace(/\s*张/g, '')
    .replace(/\s*·\s*/g, '·')
    .replace(/\s+/g, '')
    .trim();
}
