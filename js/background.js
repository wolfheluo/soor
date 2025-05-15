// 全局變數
let isMonitoring = false;
let monitoringInterval = null;
let autoCheckoutEnabled = false;
let monitoredProducts = [];

// 監聽來自彈出視窗的訊息
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.type === 'startMonitoring') {
    startMonitoring(message.settings);
    sendResponse({success: true});
  } else if (message.type === 'stopMonitoring') {
    stopMonitoring();
    sendResponse({success: true});
  } else if (message.type === 'setAutoCheckout') {
    setAutoCheckout(message.enabled);
    sendResponse({success: true});
  } else if (message.type === 'addProductToMonitor') {
    addProductToMonitor(message.product);
    sendResponse({success: true});
  } else if (message.type === 'checkMonitoringStatus') {
    // 新增一個檢查監控狀態的處理
    sendResponse({
      isMonitoring: isMonitoring,
      autoCheckout: autoCheckoutEnabled
    });
  } else if (message.type === 'productRemoved') {
    // 處理產品被移除的事件
    loadMonitoredProducts();
    sendResponse({success: true});
  }
  
  // 回傳true表示將非同步回應
  return true;
});

// 啟動庫存監控
function startMonitoring(settings) {
  if (isMonitoring) {
    stopMonitoring();
  }
  
  isMonitoring = true;
  
  // 保存監控狀態和設置
  if (settings) {
    autoCheckoutEnabled = settings.autoCheckout || false;
    
    // 儲存刷新間隔
    if (settings.refreshInterval) {
      chrome.storage.sync.set({ refreshInterval: settings.refreshInterval });
    }
  }
  
  // 儲存監控狀態
  saveMonitoringState();
  
  // 獲取刷新間隔
  const refreshInterval = settings?.refreshInterval || 30;
  
  // 通知所有開啟的標籤頁開始監控
  chrome.tabs.query({}, function(tabs) {
    for (let tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'startPageMonitoring',
        autoCheckout: autoCheckoutEnabled,
        refreshInterval: refreshInterval
      }, function(response) {
        // 忽略回應錯誤，有些頁面可能沒有內容腳本
      });
    }
  });
  
  // 通知狀態更新
  sendStatusUpdate('庫存監控已啟動，當前頁面將進行輪詢刷新');
}

// 停止庫存監控
function stopMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
  
  isMonitoring = false;
  
  // 儲存監控狀態
  saveMonitoringState();
  
  // 通知所有開啟的標籤頁停止監控
  chrome.tabs.query({}, function(tabs) {
    for (let tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'stopPageMonitoring'
      }, function(response) {
        // 忽略回應錯誤，有些頁面可能沒有內容腳本
      });
    }
  });
  
  // 通知狀態更新
  sendStatusUpdate('庫存監控已停止');
}

// 設置自動結帳功能
function setAutoCheckout(enabled) {
  autoCheckoutEnabled = enabled;
  
  // 儲存狀態
  chrome.storage.sync.set({autoCheckout: autoCheckoutEnabled});
  
  // 通知狀態更新
  sendStatusUpdate(`自動結帳功能已${enabled ? '啟用' : '停用'}`);
}

// 添加產品到監控列表
function addProductToMonitor(product) {
  // 檢查產品是否已經在監控列表中
  const existingIndex = monitoredProducts.findIndex(p => p.url === product.url);
  
  if (existingIndex >= 0) {
    // 更新現有產品資訊
    monitoredProducts[existingIndex] = {...monitoredProducts[existingIndex], ...product};
  } else {
    // 添加新產品
    monitoredProducts.push(product);
  }
  
  // 儲存監控產品列表
  saveMonitoredProducts();
  
  // 通知狀態更新
  sendStatusUpdate(`已將產品添加到監控列表: ${product.name}`);
}

// 檢查所有產品庫存
function checkAllProductsStock() {
  // 已不再使用，保留為兼容舊版本
  sendStatusUpdate(`監控方式已更新，使用頁面輪詢方式`);
}

// 檢查單個產品庫存
function checkProductStock(product) {
  // 已不再使用，保留為兼容舊版本
}

// 保存監控狀態
function saveMonitoringState() {
  chrome.storage.sync.set({
    isMonitoring: isMonitoring
  });
}

// 保存監控產品列表
function saveMonitoredProducts() {
  chrome.storage.sync.set({monitoredProducts: monitoredProducts});
}

// 載入監控產品列表
function loadMonitoredProducts(callback) {
  chrome.storage.sync.get(['monitoredProducts'], function(data) {
    monitoredProducts = data.monitoredProducts || [];
    if (callback && typeof callback === 'function') {
      callback();
    }
  });
}

// 發送狀態更新訊息
function sendStatusUpdate(message) {
  chrome.runtime.sendMessage({
    type: 'statusUpdate',
    message: message
  });
}

// 初始化: 載入設定和監控狀態
function initialize() {
  // 載入監控產品列表
  loadMonitoredProducts(function() {
    // 監控狀態和自動結帳始終從關閉狀態開始，不再從儲存空間恢復
    isMonitoring = false;
    autoCheckoutEnabled = false;
    
    // 確保儲存的狀態也是關閉的
    chrome.storage.sync.set({
      isMonitoring: false,
      autoCheckout: false
    });
  });
}

// 啟動初始化
initialize();