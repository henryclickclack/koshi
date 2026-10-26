// Clicking the toolbar icon opens the side panel.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

// Track which windows currently have the panel open. The panel connects a
// port on load; the port disconnects when the panel closes.
const openWindows = new Map(); // windowId -> port

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return;
  let windowId = null;
  port.onMessage.addListener((msg) => {
    if (msg.windowId != null) {
      windowId = msg.windowId;
      openWindows.set(windowId, port);
    }
  });
  port.onDisconnect.addListener(() => {
    if (windowId != null && openWindows.get(windowId) === port) openWindows.delete(windowId);
  });
});

// Ctrl+B → toggle the side panel. sidePanel.open() must run synchronously
// inside the command handler (it needs the user gesture), so no awaits before it.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'toggle-side-panel' || !tab) return;
  const port = openWindows.get(tab.windowId);
  if (port) {
    if (chrome.sidePanel.close) {
      chrome.sidePanel.close({ windowId: tab.windowId }).catch(() => port.postMessage({ close: true }));
    } else {
      port.postMessage({ close: true });
    }
  } else {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
  }
});
