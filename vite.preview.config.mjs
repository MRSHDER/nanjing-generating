// 仅供本机实时预览使用（DeepSeek 2026-10-13 02:25）。
// 目的：忽略 scripts/ 与 out/ 目录，避免编辑器写 .tmpdir 临时文件时 Vite 的 FSWatcher 抛 EBUSY 整进程退出
//（02:20 曾因此把用户的预览服务打掉）。不影响构建、不覆盖任何人的配置文件。
export default {
  server: {
    watch: {
      ignored: ['**/scripts/**', '**/out/**', '**/*.tmpdir/**', '**/backup-2026-10-13/**'],
    },
  },
};
