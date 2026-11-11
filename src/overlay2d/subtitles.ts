// 中英双语版式文字（Claude 2026-10-17）。
// 用户 20:47 定稿文案；21:45 修正：「不要写成字幕 / 台词的样子，要像做平面设计一样排版这些文字。」
// 比赛要求「完整中文字幕或中英文双语字幕」——本片没有台词，13 句文字作为每个画面的海报版式承担这一要求。
// 每张卡按画面留白选版式：
//   lb / rb：左下 / 右下，对齐 96px 边距线；编号 → 中文粗体大字（逗号处断行）→ 短细线 → 英文全大写小字
//   vr / vl：竖排，中文自上而下、逗号处换列、列从右往左；英文转 90° 贴在列旁（像落款）
// 卡在拍子上硬切进出；颜色走海报前层 foreground 遮罩（米白段墨色、黑底段米白）。
import { BEAT } from '../engine/beat';

type Layout = 'lb' | 'rb' | 'vr' | 'vl';
export interface SubtitleCue { start: number; end: number; zh: string; en: string; layout: Layout; size: number; plated: boolean }

const snap = (seconds: number) => Math.round(seconds / BEAT) * BEAT;
// 用户 22:04 / 22:06：「希望每个节拍开始的时候字就出现」「感觉文字排版都接不上节拍」。
// → 每张卡的起点和终点都落在小节重拍上（bar 号；1 bar = 4 拍 ≈ 1.667 秒），换卡就是换小节，和鼓点、镜头切点同步。
const BAR = BEAT * 4;
const cue = (startBar: number, endBar: number, zh: string, en: string, layout: Layout, size = 60): SubtitleCue =>
  ({ start: startBar * BAR, end: endBar * BAR, zh, en, layout, size, plated: startBar >= 16 && endBar <= 31 });
// plated：只有 05–08 号卡（26.7–51.7 秒，数据故障 + 青年段）用「深灰中文 + 红色编号/英文/短横 + 半透明米白底托」（用户 22:32–22:43）；
// 用户 23:09：「垫色块的只用在我说的这一段，其他段不用改」——其余卡仍走海报前层 foreground（米白段墨色、黑底段米白）。
void snap;

export const SUBTITLES: SubtitleCue[] = [
  // 01 左下，1–3 小节：右下是开场的 118.79°E，5 秒后左下又会升起 NANJING（用户 22:04：「第一段这个文字挡住了之前的文字」）
  cue(1, 3, '北纬 32 度，一座城正在生成', '32°N — a city is being generated', 'lb'),
  cue(4, 8, '我从很远的地方，落到这里', 'I came from far away, and landed here', 'lb'),            //  6.667 锁定段第一拍
  cue(8, 12, '城墙六百年，每块砖上都刻着名字', 'Six hundred years of wall, a name on every brick', 'rb'), // 13.333 城墙段第一拍
  cue(12, 16, '我也想，做其中的一块', 'I want to be one of them', 'vr', 64),                     // 20.000
  cue(16, 19, '算法看过，一千遍南京', 'The algorithm has seen Nanjing a thousand times', 'lb'),   // 26.667 数据故障段第一拍
  cue(19, 22, '可它，没有走过这些路', 'But it has never walked these streets', 'vr', 64),        // 31.667
  cue(22, 26, '梧桐、大桥、江风', 'Plane trees, the bridge, the river wind', 'lb'),             // 36.667 青年段第一拍
  cue(26, 31, '在这里，年轻人跑得很快', 'Here, the young run fast', 'rb'),                      // 43.333 一拍切到大桥
  cue(32, 36, '这座城，给我留了位置', 'This city saved a place for me', 'lb'),                  // 53.333 紫金山第一拍
  cue(36, 40, '我也想，为它留下点什么', 'I want to leave something for it, too', 'rb'),          // 60.000 蓄力第一拍
  cue(40, 47, '双向奔赴', 'Meeting each other halfway', 'vr', 112),                           // 66.667 双向奔赴第一拍
  cue(47, 50, '在这里，遇见同路的人', 'Here, I met people on the same road', 'rb'),           // 78.333 两球相遇
  cue(50, 54, '南京，我想留下来', 'Nanjing, I want to stay', 'rb'),                            // 83.333 片尾第一拍
];

/** 预加载字体用：所有版式文字里出现过的字。 */
export const SUBTITLE_GLYPHS = SUBTITLES.map(item => item.zh + item.en + item.en.toUpperCase()).join('') + '0123456789/ ';

export function subtitleAt(t: number) {
  return SUBTITLES.find(item => t >= item.start && t < item.end) ?? null;
}

const LEFT = 96, RIGHT = 1824, TOP = 196, FOOT = 930;
const ZH = (size: number) => `900 ${size}px "Noto Sans SC", sans-serif`;
const EN = '500 15px "Noto Sans SC", sans-serif';
const TAG = '500 13px Consolas, monospace';
type Spaced = CanvasRenderingContext2D & { letterSpacing: string };
const spacing = (context: CanvasRenderingContext2D, value: string) => { if ('letterSpacing' in context) (context as Spaced).letterSpacing = value; };

function horizontal(context: CanvasRenderingContext2D, rule: CanvasRenderingContext2D, item: SubtitleCue, index: string) {
  const right = item.layout === 'rb';
  const x = right ? RIGHT : LEFT;
  const lines = item.zh.split('，');
  const lead = item.size * 1.14;
  const lastBaseline = FOOT - 46;
  context.textAlign = right ? 'right' : 'left'; rule.textAlign = context.textAlign;
  // 用户 22:43：编号、英文、短横保持红色，只有中文大字深灰
  rule.font = TAG; spacing(rule, '2px'); rule.globalAlpha = 0.9;
  rule.fillText(index, x, lastBaseline - (lines.length - 1) * lead - item.size - 18);
  rule.globalAlpha = 1;
  context.font = ZH(item.size); spacing(context, '0px'); context.globalAlpha = 1;
  lines.forEach((line, row) => context.fillText(line, x, lastBaseline - (lines.length - 1 - row) * lead));
  rule.lineWidth = 2;
  rule.beginPath(); rule.moveTo(x, FOOT - 24); rule.lineTo(right ? x - 120 : x + 120, FOOT - 24); rule.stroke();
  rule.font = EN; spacing(rule, '3px'); rule.globalAlpha = 0.95;
  rule.fillText(item.en.toUpperCase(), x, FOOT);
}

function vertical(context: CanvasRenderingContext2D, rule: CanvasRenderingContext2D, item: SubtitleCue, index: string) {
  const columns = item.zh.split('，');
  const step = item.size * 1.06, gap = item.size * 1.22;
  const rightmost = item.layout === 'vr' ? RIGHT - item.size / 2 : LEFT + item.size / 2 + (columns.length - 1) * gap;
  context.textAlign = 'center'; context.textBaseline = 'top';
  rule.textAlign = 'center'; rule.textBaseline = 'top';
  rule.font = TAG; spacing(rule, '2px'); rule.globalAlpha = 0.9;
  rule.fillText(index, rightmost, TOP - 28);
  rule.globalAlpha = 1;
  context.font = ZH(item.size); spacing(context, '0px'); context.globalAlpha = 1;
  columns.forEach((column, c) => Array.from(column).forEach((character, r) => {
    context.fillText(character, rightmost - c * gap, TOP + r * step);
  }));
  const tallest = Math.max(...columns.map(column => Array.from(column).length));
  const leftEdge = rightmost - (columns.length - 1) * gap - item.size / 2;
  rule.lineWidth = 2;
  rule.beginPath(); rule.moveTo(leftEdge - 22, TOP); rule.lineTo(leftEdge - 22, TOP + Math.min(120, tallest * step)); rule.stroke();
  rule.save();
  rule.translate(leftEdge - 34, TOP);
  rule.rotate(Math.PI / 2);
  rule.textAlign = 'left'; rule.textBaseline = 'alphabetic';
  rule.font = EN; spacing(rule, '3px'); rule.globalAlpha = 0.95;
  rule.fillText(item.en.toUpperCase(), 0, 0);
  rule.restore();
}

// ---------- 底托（用户 22:39：「改成红色还是看不清，想个招」；22:42：半透明） ----------
// 每张卡的文字外接框外扩 PAD，铺一块半透明米白底托，像海报上文字压在一块留白色块上。
const PAD = 26;

function plateRect(measure: CanvasRenderingContext2D, item: SubtitleCue): [number, number, number, number] {
  measure.font = EN; spacing(measure, '3px');
  const enWidth = measure.measureText(item.en.toUpperCase()).width;
  if (item.layout === 'lb' || item.layout === 'rb') {
    const lines = item.zh.split('，');
    measure.font = ZH(item.size); spacing(measure, '0px');
    const zhWidth = Math.max(...lines.map(line => measure.measureText(line).width));
    const width = Math.max(zhWidth, enWidth, 120);
    const lead = item.size * 1.14;
    const top = FOOT - 46 - (lines.length - 1) * lead - item.size - 18 - 13;
    const left = item.layout === 'rb' ? RIGHT - width : LEFT;
    return [left - PAD, top - PAD, width + PAD * 2, FOOT + 6 - top + PAD * 2];
  }
  const columns = item.zh.split('，');
  const step = item.size * 1.06, gap = item.size * 1.22;
  const rightmost = item.layout === 'vr' ? RIGHT - item.size / 2 : LEFT + item.size / 2 + (columns.length - 1) * gap;
  const leftEdge = rightmost - (columns.length - 1) * gap - item.size / 2;
  const tallest = Math.max(...columns.map(column => Array.from(column).length));
  const left = leftEdge - 34 - 6, right = rightmost + item.size / 2;
  const top = TOP - 28 - 4, bottom = Math.max(TOP + tallest * step, TOP + enWidth);
  return [left - PAD, top - PAD, right - left + PAD * 2, bottom - top + PAD * 2];
}

/**
 * 版式文字的三张独立遮罩（Claude 2026-10-17 用户 22:42：「文字改成深灰色，下面铺的底改成半透明」）。
 * 合成器在所有其他图层之上依次叠：plate → 米白（半透明底托）、rule → 点缀红（短细线）、text → 深灰（文字）。
 * 不再走前层 foreground / signal，所以不会随黑底段反色，也不怕双向奔赴段的浅色闪回。调用方负责每帧清空三张画布。
 */
/** 非底托卡：画在海报前层 foreground 遮罩上（随段落明暗自动墨色 / 米白），编号、英文、短横同色。 */
export function drawSubtitle(context: CanvasRenderingContext2D, t: number) {
  const item = subtitleAt(t);
  if (!item || item.plated) return;
  const index = `${String(SUBTITLES.indexOf(item) + 1).padStart(2, '0')} / ${String(SUBTITLES.length).padStart(2, '0')}`;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = '#ffffff'; context.strokeStyle = '#ffffff';
  context.textBaseline = 'alphabetic';
  if (item.layout === 'lb' || item.layout === 'rb') horizontal(context, context, item, index);
  else vertical(context, context, item, index);
  context.restore();
}

export function drawSubtitleLabels(plate: CanvasRenderingContext2D, text: CanvasRenderingContext2D, rule: CanvasRenderingContext2D, t: number) {
  const item = subtitleAt(t);
  if (!item || !item.plated) return;
  const index = `${String(SUBTITLES.indexOf(item) + 1).padStart(2, '0')} / ${String(SUBTITLES.length).padStart(2, '0')}`;
  for (const context of [plate, text, rule]) {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#ffffff'; context.strokeStyle = '#ffffff';
    context.textBaseline = 'alphabetic';
  }
  const [x, y, w, h] = plateRect(plate, item);
  plate.globalAlpha = 0.5; // 用户 00:12：底托再透明一点（0.72 → 0.5），中文再深一点（compositor 里深灰 0.28 → 0.1）
  plate.fillRect(x, y, w, h);
  if (item.layout === 'lb' || item.layout === 'rb') horizontal(text, rule, item, index);
  else vertical(text, rule, item, index);
  for (const context of [plate, text, rule]) context.restore();
}
