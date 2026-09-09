// Mirrors what the Aside extension does for daemon-driven tabs: open
// background tabs and put them in a group titled "Agent Tabs".
async function setup() {
  const [w] = await chrome.windows.getAll({windowTypes: ['normal']});
  const t1 = await chrome.tabs.create({windowId: w.id, url: 'https://example.org/?agent=1', active: false});
  const t2 = await chrome.tabs.create({windowId: w.id, url: 'https://example.net/?agent=2', active: false});
  const groupId = await chrome.tabs.group({tabIds: [t1.id, t2.id], createProperties: {windowId: w.id}});
  await chrome.tabGroups.update(groupId, {title: 'Agent Tabs'});
}
chrome.runtime.onInstalled.addListener(() => setTimeout(setup, 1500));
