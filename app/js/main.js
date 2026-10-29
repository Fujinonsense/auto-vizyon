import { route, startRouter } from './ui/router.js';
import { buildTabbar } from './ui/chrome.js';
import { listScreen } from './ui/screens/list.js';
import { captureScreen } from './ui/screens/capture.js';
import { editScreen } from './ui/screens/folder-edit.js';

buildTabbar();
route('/', listScreen);
route('/yeni', captureScreen);
route('/klasor/:id/duzenle', editScreen);
route('/klasor/:id/belge/:kind', editScreen);
startRouter();

// No offline cache during local development, so edits show up on reload.
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && !local) navigator.serviceWorker.register('./sw.js');
navigator.storage?.persist?.();
