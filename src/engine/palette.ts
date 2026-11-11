export const C = {
  ink: '#0A0A0B',
  inkSoft: '#131316',
  warm: '#F2EBDD',      // 暖白：主文字与主线条
  gold: '#EEE9DF',
  purple: '#343332',
  wall: '#85837F',
  plane: '#74716D',
  lamp: '#EEE9DF',
} as const;

export const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export const FONT = {
  serif: '"Noto Serif CJK SC","Source Han Serif SC","Songti SC","SimSun","STSong",serif',
  sans: '"Noto Sans CJK SC","Source Han Sans SC","Microsoft YaHei","PingFang SC",sans-serif',
  mono: '"IBM Plex Mono","Cascadia Mono",Consolas,"Courier New",monospace',
};
