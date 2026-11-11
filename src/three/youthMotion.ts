// 青年段镜头（Claude 2026-10-15 02:xx 第二版，用户 02:07：「太乱了，太晕，有点晕 3D；来来回回就那几个重复的镜头；节拍蛮多的，可以多切几个镜头」）。
//
// 改法：大桥段从「一路运动的跟拍 + 少量插切」改成「卡拍剪辑的一组不重复镜头」。
//   - 防晕：每个镜头要么完全固定，要么只做平移（机位和目标点同速平移，镜头本身不转），没有摇镜、没有呼吸式推拉、没有滚转。
//   - 不越轴：所有侧面镜头都在 +z 一侧，球在屏幕上始终从左往右；正面 / 背面镜头是中性方向。
//   - 不重复：10 个镜头各不相同，切点卡在拍子上（2 拍为主，个别 1 拍）。
//   - 隧道里（< 16.5 拍）与 33 秒同款居中跟拍不变；35.5 拍起交给航拍上升，与地形段交接不变。
import * as THREE from 'three';
import { BALL_ENTRY, BALL_RADIUS, rollingBallPose, YOUTH_PORTAL_BEAT } from './rollingBall';
import { youthGenAerial } from './youthGenTransition';

type BridgeShot = 'river' | 'low' | 'top' | 'dolly' | 'railing' | 'front' | 'lamp' | 'dollyHigh' | 'wide' | 'rear';

/** 大桥段剪辑表（段内拍）。导出给 youth.ts 的构图切换表 / 切点检查使用。 */
export const YOUTH_INSERTS: readonly { beat: number; duration: number; shot: BridgeShot }[] = [
  { beat: 16, duration: 4, shot: 'river' },     // 2026-10-17：提前到 16 拍（43.333 秒小节重拍）一拍切到大桥（用户 22:06）     // 江面远景：整座大桥横跨长江，小球拖着红线划过
  { beat: 20, duration: 1, shot: 'low' },       // 贴地固定机位：球呼啸而过
  { beat: 21, duration: 2, shot: 'top' },       // 正上方俯拍：桥面线条 + 一笔红尾迹
  { beat: 23, duration: 2, shot: 'dolly' },     // 侧面平移跟拍：球定在画面里，对面栏杆飞掠
  { beat: 25, duration: 1, shot: 'railing' },   // 栏杆外固定机位：球从栏杆后掠过
  { beat: 26, duration: 2, shot: 'front' },     // 前方固定机位：球迎面冲来，从画面右侧冲出
  { beat: 28, duration: 2, shot: 'lamp' },      // 高侧位固定：一排路灯通向远方，球向纵深跑远
  { beat: 30, duration: 2, shot: 'dollyHigh' }, // 高位平移跟拍：桥面、尾迹、栏杆一起入画
  { beat: 32, duration: 2, shot: 'wide' },      // 斜侧大远景：长桥、江面，球在减速
  { beat: 34, duration: 6, shot: 'rear' },      // 正后方平移：球沿桥面远去；35.5 拍起在此基础上过渡到航拍上升
];

const smooth = (value: number) => {
  const progress = Math.max(0, Math.min(1, value));
  return progress * progress * (3 - 2 * progress);
};

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** 隧道里的居中跟拍（与数据故障段 33 秒同款构图），穿出亮口后继续朝前冲到第一个切点。 */
function tunnelCamera(beat: number) {
  const pose = rollingBallPose(beat);
  // 2026-10-18 Claude（用户 00:30：球滚动这一段球小一点）：机位从球后 11.2 退到 15，高度略抬，球在画面里约小三成
  return { position: v(pose.x - 15, pose.ground + 1.45, 0.6), target: v(pose.x + 8, pose.ground + 3.55, 0), fov: 35 };
}

function bridgeCamera(shot: (typeof YOUTH_INSERTS)[number], beat: number) {
  const pose = rollingBallPose(beat);
  const deck = pose.y - BALL_RADIUS;
  const at = (fraction: number) => rollingBallPose(shot.beat + shot.duration * fraction).x; // 镜头期间某一刻球的位置
  switch (shot.shot) {
    case 'river': {
      const x = at(0.5) + 12;
      return { position: v(x, deck + 9, 72), target: v(x, deck - 4, 0), fov: 30 };
    }
    case 'low': {
      const x = at(0.55);
      return { position: v(x, deck + 0.6, 14), target: v(x - 0.5, deck + 1.3, 0), fov: 50 };
    }
    case 'top': {
      const x = at(0.5);
      const drift = 0.25 * (pose.x - x); // 极慢平移，不转
      return { position: v(x + drift, deck + 42, 7), target: v(x + drift, deck, 0), fov: 30 };
    }
    case 'dolly':
      return { position: v(pose.x - 1, deck + 1.4, 8.2), target: v(pose.x + 1, deck + 1.0, 0), fov: 38 };
    case 'railing': {
      const x = at(0.5);
      return { position: v(x, deck + 1.05, 16), target: v(x + 2, deck + 1.2, 0), fov: 52 };
    }
    case 'front': {
      const ahead = at(1) + 4;
      return { position: v(ahead, deck + 1.1, 3.6), target: v(at(0), deck + 1.3, -0.6), fov: 32 };
    }
    case 'lamp': {
      const x = at(0);
      return { position: v(x - 12, deck + 6.5, 11.5), target: v(x + 40, deck + 0.5, -2), fov: 40 };
    }
    case 'dollyHigh':
      return { position: v(pose.x - 4, deck + 7.5, 16), target: v(pose.x + 2, deck, 0), fov: 34 };
    case 'wide': {
      const x = at(0.5);
      return { position: v(x - 60, deck + 26, 48), target: v(x + 35, deck - 6, -10), fov: 36 };
    }
    case 'rear':
      return { position: v(pose.x - 14, deck + 3.4, 3.2), target: v(pose.x + 22, deck + 1.2, 0), fov: 36 };
  }
}

export function youthMotionCamera(beat: number) {
  let position: THREE.Vector3;
  let target: THREE.Vector3;
  let fov: number;

  const shot = beat >= YOUTH_PORTAL_BEAT ? YOUTH_INSERTS.find(item => beat >= item.beat && beat < item.beat + item.duration) : undefined;
  const view = shot ? bridgeCamera(shot, beat) : tunnelCamera(beat);
  position = view.position;
  target = view.target;
  fov = view.fov;

  // 0–1.5 拍：数据故障段最后镜头推到球几乎填满画面（倒映着梧桐）；青年段从同样填满画面的球身后拉出来，
  // 已经身在梧桐隧道里。只做平移后退 + 抬高，不转镜头（2026-10-15 Claude，用户 02:09）。
  if (beat < 1.5) {
    const pose = rollingBallPose(beat);
    const pull = smooth(beat / 1.5);
    const near = { position: v(pose.x - 3.2, pose.y + 0.1, 0.25), target: v(pose.x + 8, pose.y + 0.6, 0) };
    position = near.position.lerp(position, pull);
    target = near.target.lerp(target, pull);
  }
  void BALL_ENTRY;

  if (beat >= 35.5) {
    const aerial = youthGenAerial(beat);
    const ascent = smooth((beat - 35.5) / 4.5);
    position.lerp(aerial.position, ascent);
    target.lerp(aerial.target, ascent);
    fov += (36 - fov) * ascent;
  }
  return { position, target, fov, shot: beat >= 35.5 ? 'aerial' : shot?.shot ?? 'track' };
}
