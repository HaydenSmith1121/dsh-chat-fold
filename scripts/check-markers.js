(() => {
  // Simulate what the plugin's disposer must do, by checking current markers
  const owned = document.querySelectorAll('[data-chatfold-owned]').length;
  const bars = document.querySelectorAll('[data-chatfold-turnbar]').length;
  const toggles = document.querySelectorAll('[data-chatfold-toggle]').length;
  const hiddenByUs = Array.from(document.querySelectorAll('[data-chatfold-owned][hidden]')).length;
  const styles = Array.from(document.querySelectorAll('style[data-plugin-css="dsh-chat-fold"]')).length;
  return JSON.stringify({ owned, bars, toggles, hiddenByUs, styles });
})()
