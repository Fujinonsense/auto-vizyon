import { route, startRouter } from './ui/router.js';
import { buildTabbar } from './ui/chrome.js';
import { listScreen } from './ui/screens/list.js';
import { captureScreen } from './ui/screens/capture.js';
import { editScreen } from './ui/screens/folder-edit.js';
import { folderView } from './ui/screens/folder-view.js';
import { earningsScreen } from './ui/screens/earnings.js';
import { settingsScreen } from './ui/screens/settings.js';
import { maybeShowWelcome } from './ui/welcome.js';

buildTabbar();
route('/', listScreen);
route('/yeni', captureScreen);
route('/klasor/:id', folderView);
route('/kazanc', earningsScreen);
route('/ayarlar', settingsScreen);
route('/klasor/:id/duzenle', editScreen);
route('/klasor/:id/belge/:kind', editScreen);
startRouter();
maybeShowWelcome();

// No offline cache during local development, so edits show up on reload.
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && !local) navigator.serviceWorker.register('./sw.js');
navigator.storage?.persist?.();
