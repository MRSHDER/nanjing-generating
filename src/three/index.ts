// 三维层注册表（负责人：Claude）。Codex 的合成器通过 getLayer3D(段落) 取得三维层。
import type * as THREE from 'three';
import type { Frame, SectionId } from '../engine/beat';
import type { PostParams } from '../engine/post';

/** I1：折射段落由 Codex 每帧提供后层海报（线性 RGB、不透明、1920×1080 逻辑比例）。由调用方创建与释放，三维层只读。 */
export interface Layer3DContext {
  poster?: THREE.Texture;
  presentationTime?: number;
  camera?: THREE.PerspectiveCamera;
  portal?: THREE.Texture;
}

export interface Layer3D {
  /** 预计算（几何、纹理等）。只调用一次。 */
  init(r: THREE.WebGLRenderer): Promise<void>;
  /** 渲染这一帧的三维层到 out（必须完全覆盖 out），可返回本帧的后期参数。 */
  render(r: THREE.WebGLRenderer, f: Frame, out: THREE.WebGLRenderTarget, ctx?: Layer3DContext): PostParams | void;
  /**
   * （可选）三维物体在屏幕上的位置，单位为逻辑像素（1920×1080，y 向下），供二维层对齐。
   * 例如 boot 段：{ horizon, pillarBase, pillarTop }。不可见时为 null。
   */
  anchors?(f: Frame): Record<string, [number, number] | null>;
  backgroundCamera?(frame: Frame): THREE.PerspectiveCamera;
  protagonist?(): THREE.Object3D | null;
  recapSpace?(): { camera: THREE.PerspectiveCamera; occluders: THREE.Object3D[] };
}

const LOADERS: Partial<Record<SectionId, () => Promise<{ default: new () => Layer3D }>>> = {
  boot: () => import('./boot'), // 备选素材：正式开场用 Codex 的二维版本，播放器不要自动叠加
  lock: () => import('./lock'),
  drop1: () => import('./drop1'),
  glitch: () => import('./glitch'),
  youth: () => import('./youth'),
  gen: () => import('./gen'), // Codex 负责
  build: () => import('./build'),
  drop2: () => import('./drop2'),
  outro: () => import('./outro'),
};

const cache = new Map<SectionId, Promise<Layer3D | null>>();

/** 没有三维内容（或尚未实现）的段落返回 null。同一段落只初始化一次。 */
export function getLayer3D(id: SectionId, r: THREE.WebGLRenderer): Promise<Layer3D | null> {
  if (!cache.has(id)) {
    const load = LOADERS[id];
    cache.set(
      id,
      load
        ? load().then(async (m) => {
            const layer = new m.default();
            await layer.init(r);
            return layer;
          })
        : Promise.resolve(null),
    );
  }
  return cache.get(id)!;
}

/** 已实现三维层的段落列表。 */
export const IMPLEMENTED_3D = Object.keys(LOADERS) as SectionId[];
