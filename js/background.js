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
  
  // 儲存監控狀態
  saveMonitoringState();
  
  // 每30秒檢查一次庫存
  monitoringInterval = setInterval(checkAllProductsStock, 30000);
  
  // 立即執行一次庫存檢查
  checkAllProductsStock();
  
  // 通知狀態更新
  sendStatusUpdate('庫存監控已啟動');
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
  if (!isMonitoring || monitoredProducts.length === 0) {
    return;
  }
  
  sendStatusUpdate(`開始檢查 ${monitoredProducts.length} 個產品的庫存狀態`);
  
  // 對每個產品，開啟標籤頁檢查庫存
  monitoredProducts.forEach(product => {
    checkProductStock(product);
  });
}

// 檢查單個產品庫存
function checkProductStock(product) {
  // 創建一個隱藏的標籤頁
  chrome.tabs.create({
    url: product.url,
    active: false
  }, function(tab) {
    // 等待頁面加載完成
    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        
        // 向內容腳本發送檢查庫存的請求
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, {
            type: 'checkStock',
            product: product,
            autoCheckout: autoCheckoutEnabled
          }, function(response) {
            // 關閉標籤頁
            chrome.tabs.remove(tab.id);
          });
        }, 2000); // 等待2秒，確保頁面完全載入
      }
    });
  });
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

// 發送狀態更新訊息
function sendStatusUpdate(message) {
  chrome.runtime.sendMessage({
    type: 'statusUpdate',
    message: message
  });
}

// 初始化: 載入設定和監控狀態
function initialize() {
  chrome.storage.sync.get(['monitoredProducts'], function(data) {
    // 載入監控產品列表
    monitoredProducts = data.monitoredProducts || [];
    
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