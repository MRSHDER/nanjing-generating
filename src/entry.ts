import('./main').catch((error: unknown) => {
  const status = document.getElementById('status');
  if (status) status.textContent = String(error).includes('WebGL')
    ? '当前浏览器无法启用 WebGL。请使用支持 WebGL 的现代浏览器打开本片。'
    : '画面加载失败，请刷新页面重试。';
  console.error(error);
});
