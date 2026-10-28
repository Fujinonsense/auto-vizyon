import { route, startRouter } from './ui/router.js';
import { buildTabbar } from './ui/chrome.js';
import { listScreen } from './ui/screens/list.js';

buildTabbar();
route('/', listScreen);
startRouter();

// No offline cache during local development, so edits show up on reload.
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && !local) navigator.serviceWorker.register('./sw.js');
navigator.storage?.persist?.();
