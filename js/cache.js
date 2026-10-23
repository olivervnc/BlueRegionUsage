/**
 * 本地缓存层（localStorage）
 * ===============================================================
 * 目的：网关 403（Key 因超量被临时封禁）等异常时，面板仍能展示
 * 最近一次成功获取的数据（目录 / consumer / 各端点用量快照），
 * 并标注快照时间；正常在线时作为请求结果落库点，几乎零成本。
 *
 * 结构（按网关地址隔离，换网关自动失效）：
 *   catalog  模型目录 [{id, credit, creditHistory}]（无 TTL，长期有效）
 *   consumer 消费者 ID（无 TTL）
 *   usage    各端点响应快照 { <key>: { at, data } }（key = period:endpoint）
 *
 * 读写均容错：localStorage 不可用/内容损坏时静默返回 null。
 */
(function () {
  'use strict';

  var STORE_KEY = 'blueregion-usage.snapshot.v1';
  var MAX_AGE_DAYS = 30; // 超过 30 天的快照视为陈旧，不再用于降级展示

  /** 读取原始存储（校验网关一致），损坏/不匹配返回 null */
  function readStore(gatewayBaseUrl) {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object' || obj.gatewayBaseUrl !== gatewayBaseUrl) return null;
      return obj;
    } catch (e) { return null; }
  }

  /** 修改并落盘（mutator 收到 store 引用就地修改；失败静默） */
  function updateStore(gatewayBaseUrl, mutator) {
    try {
      var store = readStore(gatewayBaseUrl) || {
        gatewayBaseUrl: gatewayBaseUrl,
        catalog: null,
        consumer: '',
        usage: {}
      };
      mutator(store);
      window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) { /* localStorage 不可用时静默跳过 */ }
  }

  // ---- 模型目录 ----
  function saveCatalog(gatewayBaseUrl, models) {
    updateStore(gatewayBaseUrl, function (s) {
      s.catalog = { models: models, at: Date.now() };
    });
  }

  function readCatalog(gatewayBaseUrl) {
    var c = readStore(gatewayBaseUrl) && readStore(gatewayBaseUrl).catalog;
    return c ? { models: c.models, syncedAt: c.at } : null;
  }

  // ---- consumer ----
  function saveConsumer(gatewayBaseUrl, consumer) {
    if (!consumer) return;
    updateStore(gatewayBaseUrl, function (s) { s.consumer = consumer; });
  }

  function readConsumer(gatewayBaseUrl) {
    var s = readStore(gatewayBaseUrl);
    return (s && s.consumer) || '';
  }

  // ---- 用量快照（period 维度） ----
  /** 保存某周期某端点响应。kind = 'usage' 固定前缀, key = period:endpoint */
  function saveUsage(gatewayBaseUrl, period, endpoint, data) {
    updateStore(gatewayBaseUrl, function (s) {
      s.usage = s.usage || {};
      s.usage[period + ':' + endpoint] = { at: Date.now(), data: data };
    });
  }

  /** 读取某周期某端点快照，返回 { data, at } | null；超过 MAX_AGE_DAYS 丢弃 */
  function readUsage(gatewayBaseUrl, period, endpoint) {
    var s = readStore(gatewayBaseUrl);
    var snap = s && s.usage && s.usage[period + ':' + endpoint];
    if (!snap) return null;
    if (Date.now() - snap.at > MAX_AGE_DAYS * 86400 * 1000) return null;
    return { data: snap.data, at: snap.at };
  }

  /** 清空某网关全部缓存（切换网关/退出时用） */
  function clear(gatewayBaseUrl) {
    try {
      var store = readStore(gatewayBaseUrl);
      if (!store) return;
      window.localStorage.removeItem(STORE_KEY);
    } catch (e) { /* ignore */ }
  }

  window.BRU = window.BRU || {};
  window.BRU.cache = {
    saveCatalog: saveCatalog,
    readCatalog: readCatalog,
    saveConsumer: saveConsumer,
    readConsumer: readConsumer,
    saveUsage: saveUsage,
    readUsage: readUsage,
    clear: clear,
    MAX_AGE_DAYS: MAX_AGE_DAYS
  };
})();
