import 'src/common/browser';
import { injectContent, i18n } from 'src/common';
import { objectGet } from 'src/common/object';
import {
  checkUpdate,
  getOption, setOption, hookOptions, getAllOptions,
  initialize,
} from './utils';
import { newStyle } from './utils/style';
import {
  getStyles, removeStyle, getData, checkRemove, getStylesByURL,
  updateStyleInfo,
  getStylesByIds, parseStyle, getStyle,
} from './utils/db';

hookOptions(changes => {
  if ('isApplied' in changes) setIcon(changes.isApplied);
  browser.runtime.sendMessage({
    cmd: 'UpdateOptions',
    data: changes,
  });
});

function checkUpdateAll() {
  setOption('lastUpdate', Date.now());
  getStyles()
  .then(styles => {
    const toUpdate = styles.filter(item => objectGet(item, 'config.shouldUpdate'));
    return Promise.all(toUpdate.map(checkUpdate));
  });
}

let autoUpdating;
function autoUpdate() {
  if (autoUpdating) return;
  autoUpdating = true;
  check();
  function check() {
    new Promise((resolve, reject) => {
      if (!getOption('autoUpdate')) return reject();
      if (Date.now() - getOption('lastUpdate') >= 864e5) resolve(checkUpdateAll());
    })
    .then(() => setTimeout(check, 36e5), () => { autoUpdating = false; });
  }
}

const commands = {
  NewStyle: newStyle,
  RemoveStyle: removeStyle,
  CheckUpdateAll: checkUpdateAll,
  CheckUpdate(id) {
    getStyle({ id }).then(checkUpdate);
  },
  AutoUpdate: autoUpdate,
  GetAllOptions: getAllOptions,
  ConfirmInstall(desc) {
    return i18n('msgConfirmInstall', [desc]);
  },
  GetData() {
    return checkRemove()
    .then(() => getData());
  },
  GetInjected(url) {
    const data = {
      isApplied: getOption('isApplied'),
    };
    if (!data.isApplied) return data;
    return getStylesByURL(url)
    .then(styles => Object.assign(data, { styles }));
  },
  UpdateStyleInfo({ id, config }) {
    return updateStyleInfo(id, { config })
    .then(([style]) => {
      browser.runtime.sendMessage({
        cmd: 'UpdateStyle',
        data: {
          where: { id: style.props.id },
          update: style,
        },
      });
    });
  },
  ParseStyle: parseStyle,
  CheckStyle({ url }) {
    return getStyle({ url })
    .then(style => style && { id: style.id, meta: style.meta });
  },
  GetMetas(ids) {
    return getStylesByIds(ids);
  },
  SetBadge: setBadge,
};

initialize()
.then(() => {
  browser.runtime.onMessage.addListener((req, src) => {
    const func = commands[req.cmd];
    let res;
    if (func) {
      res = func(req.data, src);
      if (typeof res !== 'undefined') {
        // If res is not instance of native Promise, browser APIs will not wait for it.
        res = Promise.resolve(res)
        .then(data => ({ data }), error => {
          if (process.env.DEBUG) console.error(error);
          return { error };
        });
      }
    }
    return res || null;
  });
  setTimeout(autoUpdate, 2e4);
  checkRemove();
});

// REQUIRE tabId
const badges = {};
function setBadge({ number, reset }, src) {
  const srcTab = src.tab || {};
  let data = !reset && badges[srcTab.id];
  if (!data) {
    data = { number: 0 };
    badges[srcTab.id] = data;
  }
  data.number += number;
  if (getOption('showBadge')) {
    browser.browserAction.setBadgeText({
      tabId: srcTab.id,
      text: data.number || '',
    });
  }
}
browser.tabs.onRemoved.addListener(id => {
  delete badges[id];
});

function setIcon(isApplied) {
  browser.browserAction.setIcon(`icon${isApplied ? '' : 'w'}`);
}
setIcon(getOption('isApplied'));

function onTabUpdate(tabId) {
  // Maxthon sucks
  // When ON_NAVIGATE is fired, the old context is actually alive and the new context
  // is not ready yet, so we cannot do anything with the new context here.
  // file:/// URLs will not be injected on Maxthon 5

  injectContent(`window.setTabId(${JSON.stringify(tabId)})`, tabId);
}

browser.tabs.onUpdated.addListener(onTabUpdate);